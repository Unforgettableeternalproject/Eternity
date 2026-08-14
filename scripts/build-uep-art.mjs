#!/usr/bin/env node
/**
 * U.E.P 立繪素材轉檔：原稿 PNG → 去透明邊 → 縮放 → WebP。
 *
 * 原稿放在 Eternity-Design（`assets/uep-art/`），不進本 repo 的版控——
 * 十張 A4 300dpi 的 PNG 合計 18.8MB，而 `public/` 底下的東西會原樣部署上線。
 *
 * 用法：
 *   node scripts/build-uep-art.mjs --dry-run     # 只列出計畫
 *   node scripts/build-uep-art.mjs               # 實際轉檔
 *   node scripts/build-uep-art.mjs --src=<path>  # 指定原稿目錄
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const DEFAULT_SRC = path.resolve(
  REPO_ROOT,
  '../Eternity-Design/assets/uep-art'
);
const OUT_DIR = path.join(REPO_ROOT, 'apps/uep/public/uep/art');

/** 輸出長邊上限。實際顯示約 300~600px，這個尺寸連 2x 螢幕都有餘裕 */
const MAX_EDGE = 1200;
const WEBP = { quality: 80, effort: 6 };

/**
 * 每張素材的來源、輸出名與尺度。
 *
 * `group` 相同的會共用一個縮放係數，`scale` 定義的相對大小因此能保留到輸出。
 * 首頁那組（Float 亮色／Drop 暗色）是同一個動畫的兩種主題，本體必須等大：
 * 以小腿寬校準（Float 約 100px、Drop 約 275px），Drop 需縮到 0.36。
 * 小腿是兩張裡唯一不隨姿勢改變的共通量——臉會被眼鏡切開、頭髮會鋪散。
 *
 * `frames` 相同的更嚴格：**共用同一個裁切框**（取各自 bbox 的聯集）。
 * 同一個構圖的多幀若各自依 bbox 裁切，畫面上的東西會因為裁切框不同而
 * 整體位移——切換差分時人物會跳一下，串成動畫則是逐幀抖動。
 * 共用裁切框的組自然也共用縮放係數。
 */
const ART = [
  { src: 'History.png', out: 'zone-history.webp' },
  { src: 'Echoes.png', out: 'zone-echoes.webp' },
  { src: 'Visuals.png', out: 'zone-visuals.webp' },
  { src: 'Concept.png', out: 'zone-concepts.webp' },
  { src: 'Storage.png', out: 'zone-storage.webp' },
  { src: 'Float.png', out: 'home-float.webp', group: 'home' },
  { src: 'Drop.png', out: 'home-drop.webp', group: 'home', scale: 0.36 },
  // 滿版覆蓋在 AFK 遮罩上，會鋪到整個視窗，長邊給得比其他張寬裕
  { src: 'Fade.png', out: 'afk-fade.webp', maxEdge: 1600 },
  { src: 'No.png', out: 'protect-no.webp' },
  // 休息提醒的兩個差分：同一個躺姿，Invite 手上多一杯茶。兩張在卡片上
  // 是原地替換的，裁切框一旦不同她就會跳位
  { src: 'Lazy.png', out: 'rest-lazy.webp', frames: 'rest' },
  { src: 'Invite.png', out: 'rest-invite.webp', frames: 'rest' },
  // 茶會頁：舉杯與喝下去兩幀（之後要串成循環）
  { src: 'Tea.png', out: 'tea-raise.webp', frames: 'teatime' },
  { src: 'Drinking.png', out: 'tea-sip.webp', frames: 'teatime' },
  // 桌子的兩種樣子：她在時茶壺在桌上，她不在時連茶壺都收走了。
  // 同組共用裁切框，桌子本體在畫面上的位置與大小才會一模一樣——各自 trim
  // 的話少了茶壺的那張會整個放大（高度變矮、按高度縮放就等比撐大），
  // 兩種情境的桌子看起來會是兩張不同的桌子
  { src: 'Table.png', out: 'teatime-table.webp', frames: 'teatime-table' },
  {
    src: 'Empty Table.png',
    out: 'teatime-table-empty.webp',
    frames: 'teatime-table',
  },
];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SRC_DIR = path.resolve(
  args.find((a) => a.startsWith('--src='))?.split('=')[1] ?? DEFAULT_SRC
);

const KB = (n) => `${(n / 1024).toFixed(0)}KB`;

/**
 * 掃出不透明像素的邊界框。
 *
 * sharp 的 `trim()` 是比對邊角顏色，對「四角剛好也透明」的圖能用，但門檻語意
 * 不直觀且無法回報實際裁掉多少。這裡直接讀 alpha 通道自己算，順便讓 dry-run
 * 印得出裁切量。
 */
function alphaBounds(data, width, height, channels) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * channels;
    for (let x = 0; x < width; x++) {
      if (data[row + x * channels + channels - 1] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

async function main() {
  console.log('\n🎨 U.E.P 立繪轉檔\n');
  console.log(`   原稿  ${SRC_DIR}`);
  console.log(`   輸出  ${OUT_DIR}`);
  if (DRY_RUN) console.log('   模式  DRY RUN（不會寫入任何檔案）');
  console.log('');

  // 1. 讀原稿並量出裁切後的實際尺寸
  const items = [];
  for (const entry of ART) {
    const file = path.join(SRC_DIR, entry.src);
    const buf = await readFile(file).catch(() => null);
    if (!buf) {
      throw new Error(
        `找不到原稿 ${entry.src}\n   原稿在 Eternity-Design/assets/uep-art/，或用 --src= 指定`
      );
    }
    const img = sharp(buf).ensureAlpha();
    const { data, info } = await img
      .raw()
      .toBuffer({ resolveWithObject: true });
    const box = alphaBounds(data, info.width, info.height, info.channels);
    if (!box) throw new Error(`${entry.src} 整張都是透明的`);

    items.push({
      ...entry,
      buf,
      box,
      source: { width: info.width, height: info.height, bytes: buf.length },
      scale: entry.scale ?? 1,
    });
  }

  // 2. 同一組多幀共用裁切框：取聯集，任何一幀的內容都不會被裁掉，而且
  //    每一幀的座標系完全一致（換幀時畫面上的東西不會整體位移）。
  const frameBox = new Map();
  for (const it of items) {
    if (!it.frames) continue;
    const cur = frameBox.get(it.frames);
    frameBox.set(
      it.frames,
      cur
        ? {
            left: Math.min(cur.left, it.box.left),
            top: Math.min(cur.top, it.box.top),
            right: Math.max(cur.left + cur.width, it.box.left + it.box.width),
            bottom: Math.max(cur.top + cur.height, it.box.top + it.box.height),
          }
        : {
            ...it.box,
            right: it.box.left + it.box.width,
            bottom: it.box.top + it.box.height,
          }
    );
    const u = frameBox.get(it.frames);
    u.width = u.right - u.left;
    u.height = u.bottom - u.top;
  }
  for (const it of items) {
    if (!it.frames) continue;
    const u = frameBox.get(it.frames);
    it.box = { left: u.left, top: u.top, width: u.width, height: u.height };
  }

  // 套用個別尺度後的邏輯尺寸，群組係數以此為準
  for (const it of items) {
    it.scaledEdge = Math.max(it.box.width, it.box.height) * it.scale;
  }

  // 3. 決定每張的最終縮放係數。
  //    同群組共用一個係數——各自縮到自己的長邊上限，會把刻意校準過的相對大小抹掉。
  const groupEdge = new Map();
  for (const it of items) {
    const key = it.group ?? it.frames;
    if (!key) continue;
    groupEdge.set(key, Math.max(groupEdge.get(key) ?? 0, it.scaledEdge));
  }

  for (const it of items) {
    const limit = it.maxEdge ?? MAX_EDGE;
    const groupKey = it.group ?? it.frames;
    const refEdge = groupKey ? groupEdge.get(groupKey) : it.scaledEdge;
    const fit = Math.min(1, limit / refEdge);
    it.finalScale = it.scale * fit;
    it.outWidth = Math.max(1, Math.round(it.box.width * it.finalScale));
    it.outHeight = Math.max(1, Math.round(it.box.height * it.finalScale));
  }

  for (const it of items) {
    const trimmed =
      100 -
      ((it.box.width * it.box.height) / (it.source.width * it.source.height)) *
        100;
    console.log(
      `   ${it.out.padEnd(20)} ${String(it.source.width + 'x' + it.source.height).padStart(10)}` +
        ` → 裁 ${String(it.box.width + 'x' + it.box.height).padStart(10)} (-${trimmed.toFixed(0)}%)` +
        ` → ${String(it.outWidth + 'x' + it.outHeight).padStart(10)}` +
        `  ×${it.finalScale.toFixed(3)}` +
        (it.group ? `  [${it.group}]` : '') +
        (it.frames ? `  [frames:${it.frames}]` : '')
    );
  }
  console.log('');

  if (DRY_RUN) {
    console.log('   DRY RUN 結束。\n');
    return;
  }

  // 4. 裁切 → 縮放 → 編碼
  await mkdir(OUT_DIR, { recursive: true });
  let before = 0;
  let after = 0;
  for (const it of items) {
    const outPath = path.join(OUT_DIR, it.out);
    const outBuf = await sharp(it.buf)
      .ensureAlpha()
      .extract(it.box)
      .resize(it.outWidth, it.outHeight, { fit: 'fill', kernel: 'lanczos3' })
      .webp(WEBP)
      .toBuffer();
    await writeFile(outPath, outBuf);
    before += it.source.bytes;
    after += outBuf.length;
    console.log(
      `   ✓ ${it.out.padEnd(20)} ${KB(it.source.bytes).padStart(8)} → ${KB(outBuf.length).padStart(7)}`
    );
  }

  console.log(
    `\n   ${items.length} 張，${KB(before)} → ${KB(after)}  (省 ${(100 - (after / before) * 100).toFixed(1)}%)\n`
  );
}

main().catch((e) => {
  console.error(`\n[ERROR] ${e.message}\n`);
  process.exitCode = 1;
});
