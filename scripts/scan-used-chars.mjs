// 站內用字掃描：收集文件站所有會被 Noto Serif TC 繪製的字符
//
// 用途：字型子集化（T-B3）的「熱分片」依據。站內內容持續新增，
// 本腳本可重複執行——重跑後再跑 build-font-subsets.mjs 重新產出分片即可。
//
// 來源：
//   1. 正式 content-api 的六大區域全部頁面（title + content + metadata）
//   2. /api/homepage 全部 sections
//   3. apps/uep/src 與 packages/ui/src 原始碼內的字串（UI 文案）
//
// 輸出：scripts/font-subset/used-chars.json
//   { generatedAt, counts, chars }  — chars 是排序後的不重複字符字串
//
// 用法：
//   node scripts/scan-used-chars.mjs
//   node scripts/scan-used-chars.mjs --api=https://...   # 換資料來源

import {
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const apiArg = args.find((a) => a.startsWith('--api='));
const API_BASE = apiArg
  ? apiArg.slice('--api='.length)
  : 'https://eternity-content-api.ptyc4076.workers.dev';

const AREAS = ['history', 'echoes', 'visuals', 'concepts', 'storage', 'portal'];

const SOURCE_DIRS = [
  join(ROOT, 'apps', 'uep', 'src'),
  join(ROOT, 'packages', 'ui', 'src'),
];
const SOURCE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.astro',
  '.css',
  '.md',
  '.mdx',
  '.json',
]);

// 必收的保底字符（不依賴掃描結果）：
//   - ASCII 可見字元：--font-serif-tc 的 stack 以 Noto Serif TC 開頭，
//     中文段落裡夾雜的英數會由它繪製，缺了會混入 fallback 的字形
//   - CJK 標點（U+3000-303F）與全形符號（U+FF00-FF65）：整段收，體積極小
//   - 常見引號／破折號／省略號等排版符號
const BASELINE_CHARS = (() => {
  let s = '';
  for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c);
  for (let c = 0x3000; c <= 0x303f; c++) s += String.fromCharCode(c);
  for (let c = 0xff00; c <= 0xff65; c++) s += String.fromCharCode(c);
  // 排版符號：引號（U+2018-201D）、破折號、省略號、項目符號等
  for (let c = 0x2018; c <= 0x201d; c++) s += String.fromCharCode(c);
  s += '‧•…—–―‥〝〞·※§';
  s += '〈〉《》「」『』【】〔〕';
  s += '○●◎△▲▽▼☆★◇◆□■';
  return s;
})();

/** 從任意字串收集字符進 set（會先解開 \uXXXX escape） */
function collect(set, text) {
  if (!text || typeof text !== 'string') return;
  // JSON 內容可能以 \uXXXX 形式儲存中文，先還原
  const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  for (const ch of decoded) {
    const code = ch.codePointAt(0);
    if (code < 0x20) continue; // 控制字元
    set.add(ch);
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

/** 遞迴走訪 JSON 值，收集所有字串內容 */
function collectDeep(set, value) {
  if (typeof value === 'string') return collect(set, value);
  if (Array.isArray(value)) return value.forEach((v) => collectDeep(set, v));
  if (value && typeof value === 'object')
    return Object.values(value).forEach((v) => collectDeep(set, v));
}

async function scanContent(set) {
  let pageCount = 0;
  for (const area of AREAS) {
    const list = await fetchJson(
      `${API_BASE}/api/content/${area}?include_deleted=true`
    );
    const pages = list?.ok ? list.data || [] : [];
    for (const page of pages) {
      const full = await fetchJson(
        `${API_BASE}/api/content/${area}/${page.slug}?include_deleted=true`
      );
      if (full?.ok && full.data) {
        collectDeep(set, full.data);
        pageCount++;
      }
    }
    console.log(`  ${area}: ${pages.length} 頁`);
  }
  return pageCount;
}

async function scanHomepage(set) {
  try {
    const json = await fetchJson(`${API_BASE}/api/homepage`);
    const data = json?.ok ? json.data || {} : {};
    collectDeep(set, data);
    const sectionCount = Object.keys(data).length;
    console.log(`  homepage: ${sectionCount} sections`);
    return sectionCount;
  } catch (err) {
    console.warn(`  homepage 讀取失敗（${err.message}），略過`);
    return 0;
  }
}

function walkDir(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      walkDir(full, out);
    } else if (SOURCE_EXTS.has(extname(name))) {
      out.push(full);
    }
  }
}

/**
 * 粗略剝除程式註解（// 、跨行註解、HTML 註解）。
 * 目的只是別把大量中文註解算進「會渲染的 UI 文案」——剝過頭也無妨，
 * 漏收的字會落入懶載分片，仍由 Noto Serif TC 繪製，只是多一次請求。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

function scanSources(set) {
  let fileCount = 0;
  for (const dir of SOURCE_DIRS) {
    const files = [];
    walkDir(dir, files);
    for (const f of files) {
      collect(set, stripComments(readFileSync(f, 'utf8')));
      fileCount++;
    }
  }
  return fileCount;
}

const sortChars = (set) =>
  [...set].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('');

async function main() {
  // 分兩層收集：
  //   core = 首頁內容 + UI 文案（原始碼字串）+ 保底符號 —— 每個訪客首屏就會用到
  //   content = 六大區域的 D1 內容 —— 進了內頁才需要
  // 子集化時 core 獨立成分片，首頁（PageSpeed 量測對象）不必下載全站用字。
  const coreSet = new Set();
  const contentSet = new Set();
  collect(coreSet, BASELINE_CHARS);
  const baselineCount = coreSet.size;

  console.log(`資料來源：${API_BASE}`);
  console.log('掃描 D1 內容…');
  const pageCount = await scanContent(contentSet);
  const sectionCount = await scanHomepage(coreSet);

  console.log('掃描前端原始碼…');
  const fileCount = scanSources(coreSet);

  // content 層剔除 core 已涵蓋的字，兩層互斥
  for (const ch of coreSet) contentSet.delete(ch);

  const countCjk = (s) =>
    [...s].filter((c) => {
      const code = c.codePointAt(0);
      return (
        (code >= 0x3400 && code <= 0x9fff) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0x20000 && code <= 0x3134f)
      );
    }).length;

  const outDir = join(__dirname, 'font-subset');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'used-chars.json');
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apiBase: API_BASE,
        counts: {
          core: coreSet.size,
          content: contentSet.size,
          baseline: baselineCount,
          coreCjk: countCjk(coreSet),
          contentCjk: countCjk(contentSet),
          pages: pageCount,
          homepageSections: sectionCount,
          sourceFiles: fileCount,
        },
        coreChars: sortChars(coreSet),
        contentChars: sortChars(contentSet),
      },
      null,
      2
    ),
    'utf8'
  );

  console.log('────────');
  console.log(
    `core（首頁+UI+保底）：${coreSet.size} 字（CJK ${countCjk(coreSet)}）`
  );
  console.log(
    `content（內頁內容）：${contentSet.size} 字（CJK ${countCjk(contentSet)}）`
  );
  console.log(`輸出：${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
