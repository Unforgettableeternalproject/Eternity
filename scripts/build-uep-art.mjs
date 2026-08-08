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
  { src: 'Lazy.png', out: 'rest-lazy.webp' },
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

    const scale = entry.scale ?? 1;
    items.push({
      ...entry,
      buf,
      box,
      source: { width: info.width, height: info.height, bytes: buf.length },
      // 套用個別尺度後的邏輯尺寸，群組係數以此為準
      scaledEdge: Math.max(box.width, box.height) * scale,
      scale,
    });
  }

  // 2. 決定每張的最終縮放係數。
  //    同群組共用一個係數——各自縮到自己的長邊上限，會把刻意校準過的相對大小抹掉。
  const groupEdge = new Map();
  for (const it of items) {
    if (!it.group) continue;
    groupEdge.set(
      it.group,
      Math.max(groupEdge.get(it.group) ?? 0, it.scaledEdge)
    );
  }

  for (const it of items) {
    const limit = it.maxEdge ?? MAX_EDGE;
    const refEdge = it.group ? groupEdge.get(it.group) : it.scaledEdge;
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
        `  ×${it.finalScale.toFixed(3)}${it.group ? `  [${it.group}]` : ''}`
    );
  }
  console.log('');

  if (DRY_RUN) {
    console.log('   DRY RUN 結束。\n');
    return;
  }

  // 3. 裁切 → 縮放 → 編碼
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
