// 字型子集化建置（T-B3）：自架 Noto Serif TC
//
// 背景：Google Fonts 版的 Noto Serif TC 兩個字重共 36 個分片 2245KB，
// 佔行動版首頁總傳輸量 96%，是 PageSpeed FCP/LCP/SI 的唯一真兇。
//
// 三層分片（unicode-range 互斥，瀏覽器只下載頁面實際用到的分片）：
//   core    首頁內容 + UI 文案 + 保底符號 —— 首屏就會用到，單一分片
//   content 內頁 D1 內容用字 —— 進了內頁才會下載，切成數片
//   lazy    字型其餘全部字符 —— 罕字保底。涵蓋「admin 新增內容帶入新字、
//           尚未重跑建置」的空窗：新字仍由 Noto Serif TC 繪製，只是多一次請求
//
// 來源字型用可變字型 instancing（glyf），不用官方 CFF 靜態版——
// harfbuzz 子集化 CFF 會去子程序化，同字集實測 1007KB vs 686KB，CFF 反而更肥。
//
// 重跑時機：內容大量新增後先跑 scan-used-chars.mjs 再跑本腳本，
// 新字會併入 core/content 分片。輸出檔名帶內容雜湊，重跑後舊快取自然失效。
//
// 輸出：
//   apps/uep/public/fonts/noto-serif-tc/*.woff2
//   apps/uep/src/styles/fonts-noto-serif-tc.css（@font-face 宣告，由 DesignLayout 匯入）
//
// 用法：node scripts/build-font-subsets.mjs
//   來源字型 scripts/font-subset/src/NotoSerifTC-vf.ttf 若不存在，
//   從 google/fonts GitHub 下載：
//   https://raw.githubusercontent.com/google/fonts/main/ofl/notoseriftc/NotoSerifTC%5Bwght%5D.ttf

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';
import * as fontkit from 'fontkit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SRC_FONT = join(__dirname, 'font-subset', 'src', 'NotoSerifTC-vf.ttf');
const USED_CHARS = join(__dirname, 'font-subset', 'used-chars.json');
const OUT_FONT_DIR = join(
  ROOT,
  'apps',
  'uep',
  'public',
  'fonts',
  'noto-serif-tc'
);
// CSS 放 public 與 woff2 同層，由 DesignLayout 以非阻斷 <link> 載入
// （不 import 進 Astro bundle——那會把幾十 KB 的 unicode-range 塞進
// render-blocking CSS，重蹈「字型 CSS preload 擠壓 FCP」的坑）
const OUT_CSS = join(OUT_FONT_DIR, 'fonts.css');

const WEIGHTS = [400, 600];
// 每個 content／lazy 分片的字符數。太小→請求數爆炸；太大→為一個罕字下載一大包。
const SLICE_SIZE = 800;

if (!existsSync(SRC_FONT)) {
  console.error(`找不到來源字型：${SRC_FONT}`);
  console.error('請先下載（見檔頭註解）');
  process.exit(1);
}
if (!existsSync(USED_CHARS)) {
  console.error(
    `找不到用字清單：${USED_CHARS}，請先跑 node scripts/scan-used-chars.mjs`
  );
  process.exit(1);
}

const srcBuffer = readFileSync(SRC_FONT);
const usedData = JSON.parse(readFileSync(USED_CHARS, 'utf8'));

// 字型實際支援的 codepoint（fontkit 讀 cmap）
const font = fontkit.create(srcBuffer);
const supported = new Set(font.characterSet);

const toCps = (chars) => new Set([...chars].map((c) => c.codePointAt(0)));
const coreCpsAll = toCps(usedData.coreChars);
const contentCpsAll = toCps(usedData.contentChars);

const coreCps = [...coreCpsAll]
  .filter((cp) => supported.has(cp))
  .sort((a, b) => a - b);
const contentCps = [...contentCpsAll]
  .filter((cp) => supported.has(cp))
  .sort((a, b) => a - b);
const missing =
  coreCpsAll.size + contentCpsAll.size - coreCps.length - contentCps.length;

const lazyCps = [...supported]
  .filter((cp) => cp >= 0x20 && !coreCpsAll.has(cp) && !contentCpsAll.has(cp))
  .sort((a, b) => a - b);

console.log(`字型支援 ${supported.size} 個 codepoint`);
console.log(
  `core ${coreCps.length} 字 / content ${contentCps.length} 字（${missing} 字不在字型內，回退系統字）`
);
console.log(
  `lazy ${lazyCps.length} 字 → ${Math.ceil(lazyCps.length / SLICE_SIZE)} 片/字重`
);

/** codepoint 陣列（已排序）→ 合併後的 unicode-range 字串 */
function toUnicodeRange(codepoints) {
  const parts = [];
  let start = codepoints[0];
  let prev = codepoints[0];
  const flush = () => {
    parts.push(
      start === prev
        ? `U+${start.toString(16).toUpperCase()}`
        : `U+${start.toString(16).toUpperCase()}-${prev.toString(16).toUpperCase()}`
    );
  };
  for (let i = 1; i < codepoints.length; i++) {
    const cp = codepoints[i];
    if (cp === prev + 1) {
      prev = cp;
    } else {
      flush();
      start = prev = cp;
    }
  }
  flush();
  return parts.join(',');
}

const cpsToText = (cps) => cps.map((cp) => String.fromCodePoint(cp)).join('');

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// 重新產出：清空舊檔（檔名帶雜湊，不清會累積殭屍檔）
rmSync(OUT_FONT_DIR, { recursive: true, force: true });
mkdirSync(OUT_FONT_DIR, { recursive: true });

const slices = [
  { name: 'core', cps: coreCps },
  ...chunk(contentCps, SLICE_SIZE).map((cps, i) => ({
    name: `c${String(i + 1).padStart(2, '0')}`,
    cps,
  })),
  ...chunk(lazyCps, SLICE_SIZE).map((cps, i) => ({
    name: `z${String(i + 1).padStart(2, '0')}`,
    cps,
  })),
];

const faces = [];
let totalBytes = 0;

for (const weight of WEIGHTS) {
  for (const slice of slices) {
    const buf = await subsetFont(srcBuffer, cpsToText(slice.cps), {
      targetFormat: 'woff2',
      variationAxes: { wght: weight },
    });
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 8);
    const filename = `nst-${weight}-${slice.name}.${hash}.woff2`;
    writeFileSync(join(OUT_FONT_DIR, filename), buf);
    totalBytes += buf.length;
    // lazy 分片用連續區段（含洞）壓縮 CSS 體積；洞裡的字由後宣告的
    // core/content 精確 range 蓋過（見下方 CSS 產出的順序契約）
    const isLazy = slice.name.startsWith('z');
    const range = isLazy
      ? `U+${slice.cps[0].toString(16).toUpperCase()}-${slice.cps[slice.cps.length - 1].toString(16).toUpperCase()}`
      : toUnicodeRange(slice.cps);
    faces.push({
      weight,
      filename,
      range,
      bytes: buf.length,
      tier: slice.name,
    });
  }
  const wf = faces.filter((f) => f.weight === weight);
  const sum = (fs) => Math.round(fs.reduce((s, f) => s + f.bytes, 0) / 1024);
  console.log(
    `wght ${weight}：core ${sum(wf.filter((f) => f.tier === 'core'))}KB · content ${sum(wf.filter((f) => f.tier.startsWith('c') && f.tier !== 'core'))}KB · lazy ${sum(wf.filter((f) => f.tier.startsWith('z')))}KB`
  );
}

// 產出 @font-face CSS。
// ⚠️ 宣告順序是契約：lazy → content → core。
// lazy 分片的 range 是連續區段（含洞），會與 core/content 重疊——
// CSS 規範對同 family/weight 的多個 @font-face 以「後宣告者勝」解析，
// 所以 core/content 必須排在 lazy 之後，精確 range 才會蓋過 lazy 的粗 range。
// （這是常見的 unicode-range override 模式；若改成互斥精確 range，
// lazy 會碎成上千段，CSS gzip 後 56KB，跟當初 Google 那支 68KB 一樣肥。）
const cssLines = [
  '/* 自動產生，勿手改。來源：scripts/build-font-subsets.mjs（T-B3 字型子集化）',
  ` * 產生時間：${new Date().toISOString()}`,
  ` * core：首頁+UI 用字 ${coreCps.length} 字；content：內頁用字 ${contentCps.length} 字；`,
  ' * lazy：字型其餘字符（罕字保底，涵蓋 admin 新增內容的空窗）。',
  ' * 內容大量新增後：重跑 scan-used-chars.mjs → build-font-subsets.mjs',
  ' */',
  '',
];
const order = { z: 0, c: 1, core: 2 };
const tierKey = (t) => (t === 'core' ? 'core' : t[0]);
for (const face of [...faces].sort(
  (a, b) => order[tierKey(a.tier)] - order[tierKey(b.tier)]
)) {
  cssLines.push(
    '@font-face {',
    "  font-family: 'Noto Serif TC';",
    '  font-style: normal;',
    `  font-weight: ${face.weight};`,
    '  font-display: swap;',
    `  src: url('/fonts/noto-serif-tc/${face.filename}') format('woff2');`,
    `  unicode-range: ${face.range};`,
    '}',
    ''
  );
}
writeFileSync(OUT_CSS, cssLines.join('\n'), 'utf8');

console.log('────────');
console.log(
  `輸出 ${faces.length} 個 woff2，共 ${Math.round(totalBytes / 1024)}KB`
);
console.log(`CSS：${OUT_CSS}`);
