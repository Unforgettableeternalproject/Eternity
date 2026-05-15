/**
 * 遷移腳本：將 Visuals 區域的 MD 檔案匯入到 Content API (D1)
 * 支援層級結構（homepage / division / subcategory / gallery）
 *
 * 使用方式：
 *   node scripts/migrate-visuals.mjs [--remote] [--clean]
 *
 * --remote: 匯入到遠端 Worker（預設為 localhost:8788）
 * --clean:  先清除現有 visuals 資料再匯入
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

// === 設定 ===
const USE_REMOTE = process.argv.includes('--remote');
const CLEAN = process.argv.includes('--clean');
const API_BASE = USE_REMOTE
  ? 'https://eternity-content-api.ptyc4076.workers.dev'
  : 'http://localhost:8788';

const CONTENT_ROOT = join(
  import.meta.dirname,
  '..',
  '..',
  'U.E.P-s-Imaginary-Space'
);
const SUMMARY_PATH = join(CONTENT_ROOT, 'SUMMARY.md');

console.log(`\n🎨 Visuals 內容遷移工具（幻影重現室）`);
console.log(`   目標: ${API_BASE}`);
console.log(`   清除模式: ${CLEAN ? '是' : '否'}\n`);

// === slug 路徑轉換 ===
// 1. 去掉 visuals/ 前綴
// 2. 去掉 crossroad/ 中間層（crossroad 是首頁，不是結構層）
// 3. aiart → pixel
function normalizeSlug(filePath) {
  let slug = filePath.replace(/^visuals\//, '').replace(/\.md$/, '');

  // crossroad.md 本身 → homepage
  if (slug === 'crossroad') return 'homepage';

  // debris.md → debris
  if (slug === 'debris') return 'debris';

  // 去掉 crossroad/ 前綴
  slug = slug.replace(/^crossroad\//, '');

  // aiart → pixel
  slug = slug.replace(/^aiart(\/|$)/, 'pixel$1');

  return slug;
}

// === 判斷頁面類型 ===
function detectPageType(slug, depth) {
  // homepage — crossroad.md 是首頁
  if (slug === 'homepage') return 'homepage';
  // debris.md 的內容已合併到首頁區塊中，跳過
  if (slug === 'debris') return '_skip';

  // depth 0 在 SUMMARY 中 = crossroad 下的第一層 = division
  // depth 1 = 第二層
  // 但我們的 slug 已去掉 crossroad/，所以：
  const parts = slug.split('/');

  // 4 個 division
  if (
    parts.length === 1 &&
    ['profiles', 'illustrations', 'sketchs', 'pixel'].includes(parts[0])
  ) {
    return 'division';
  }

  // profiles 有 3 層結構：division / subcategory / gallery
  if (parts[0] === 'profiles' && parts.length === 2) return 'subcategory';
  if (parts[0] === 'profiles' && parts.length === 3) return 'gallery';

  // 其他 division 的子頁面 = subcategory（未來在下面加 gallery）
  if (parts.length === 2) return 'subcategory';

  // 更深的 = gallery
  if (parts.length >= 3) return 'gallery';

  return 'page';
}

// === 解析 SUMMARY.md 取得 Visuals 區域的結構 ===
function parseSummaryForVisuals() {
  const summary = readFileSync(SUMMARY_PATH, 'utf-8');
  const lines = summary.split('\n');

  let inVisuals = false;
  const entries = [];
  let sortOrder = 0;

  const parentStack = []; // [{id, depth}]

  for (const line of lines) {
    if (line.includes('幻影重現室') || line.includes('#visuals')) {
      inVisuals = true;
      continue;
    }
    if (inVisuals && line.startsWith('## ')) break;
    if (!inVisuals) continue;

    const match = line.match(/^(\s*)\*\s+\[(.+?)\]\((.+?)\)/);
    if (!match) continue;

    const [, indent, title, filePath] = match;
    if (!filePath.startsWith('visuals/')) continue;

    const fullPath = join(CONTENT_ROOT, filePath);
    if (!existsSync(fullPath)) {
      console.log(`  ⚠ 跳過（不存在）: ${filePath}`);
      continue;
    }

    // 縮排深度（每 2 空格一層）
    const summaryDepth = Math.floor(indent.length / 2);
    const slug = normalizeSlug(filePath);
    const id = `visuals/${slug}`;
    const pageType = detectPageType(slug, summaryDepth);

    // debris 已合併到首頁，跳過
    if (pageType === '_skip') continue;

    // 計算實際深度（基於 slug 層數）
    let depth;
    if (pageType === 'page') depth = 0;
    else if (pageType === 'division') depth = 0;
    else if (pageType === 'subcategory') depth = 1;
    else if (pageType === 'gallery') depth = 2;
    else depth = summaryDepth;

    // 找 parent
    let parentId = null;
    if (pageType === 'subcategory') {
      // parent 是 division
      const divSlug = slug.split('/')[0];
      parentId = `visuals/${divSlug}`;
    } else if (pageType === 'gallery') {
      // parent 是 subcategory
      const parts = slug.split('/');
      parentId = `visuals/${parts.slice(0, 2).join('/')}`;
    }
    // homepage 和 division 沒有 parent

    entries.push({
      id,
      title: title.trim(),
      sourceFile: filePath,
      fullPath,
      slug,
      sortOrder: sortOrder++,
      depth,
      parentId,
      pageType,
    });
  }

  return entries;
}

// === MD → HTML 轉換 ===
function mdToHtml(content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  let body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const frontmatter = fmMatch ? parseFrontmatter(fmMatch[1]) : {};

  // 移除第一個 h1 標題
  body = body.replace(/^\s*#\s+.+\r?\n/, '');

  let html = convertLines(body);
  html = convertGitBookBlocks(html);

  return { html, frontmatter };
}

function convertLines(body) {
  const lines = body.split('\n');
  const htmlParts = [];
  let inCodeBlock = false;
  let codeContent = '';
  let inTable = false;
  let tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        htmlParts.push(
          `<pre><code>${escapeHtml(codeContent.trim())}</code></pre>`
        );
        codeContent = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeContent += line + '\n';
      continue;
    }

    // GitBook 語法行 — 保留
    if (
      trimmed.match(
        /^\{%\s*(hint|endhint|tabs|endtabs|tab|endtab|file|endfile|stepper|endstepper|content-ref|endcontent-ref)/
      )
    ) {
      htmlParts.push(line);
      continue;
    }

    // HTML 區塊 — 保留
    if (
      trimmed.startsWith('<table') ||
      trimmed.startsWith('<div') ||
      trimmed.startsWith('<img') ||
      trimmed.startsWith('<a ') ||
      trimmed.startsWith('</a>') ||
      trimmed.startsWith('<figure')
    ) {
      htmlParts.push(line);
      continue;
    }

    // Markdown 表格
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (trimmed.match(/^\|[\s\-:]+\|$/)) continue;
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      const cells = trimmed
        .split('|')
        .filter((c) => c !== '')
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      htmlParts.push(buildTable(tableRows));
      inTable = false;
      tableRows = [];
    }

    if (trimmed === '') continue;

    if (trimmed === '***' || trimmed === '---' || trimmed.match(/^[❇︎]+$/)) {
      htmlParts.push('<hr>');
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      htmlParts.push(
        `<h${level}>${processInline(headingMatch[2])}</h${level}>`
      );
      continue;
    }

    if (trimmed.startsWith('> ')) {
      htmlParts.push(
        `<blockquote><p>${processInline(trimmed.slice(2))}</p></blockquote>`
      );
      continue;
    }

    if (line.match(/^\s*\*\s+/)) {
      const text = line.replace(/^\s*\*\s+/, '');
      htmlParts.push(`<li>${processInline(text)}</li>`);
      continue;
    }

    const processed = processInline(trimmed);
    if (processed) htmlParts.push(`<p>${processed}</p>`);
  }

  if (inTable && tableRows.length) htmlParts.push(buildTable(tableRows));

  let html = htmlParts.join('\n');
  html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>\n$1</ul>');

  return html;
}

function convertGitBookBlocks(html) {
  // Hints
  html = html.replace(
    /\{%\s*hint\s+style="(\w+)"\s*%\}\s*\n?([\s\S]*?)\n?\{%\s*endhint\s*%\}/g,
    (_, style, content) => {
      const colors = {
        info: '#06b6d4',
        warning: '#f59e0b',
        danger: '#ef4444',
        success: '#22c55e',
      };
      const color = colors[style] || colors.info;
      const cleaned = content.replace(/<\/?p>/g, '').trim();
      return `<div class="hint hint-${style}" style="border-left:3px solid ${color};background:${color}15;padding:0.75rem 1rem;border-radius:6px;margin:0.5rem 0;"><p>${cleaned}</p></div>`;
    }
  );

  // Stepper
  html = html.replace(
    /\{%\s*stepper\s*%\}\s*\n?([\s\S]*?)\n?\{%\s*endstepper\s*%\}/g,
    (_, content) => {
      return `<div class="stepper">${content}</div>`;
    }
  );

  // Content-ref
  html = html.replace(
    /\{%\s*content-ref\s+url="([^"]+)"\s*%\}\s*\n?[\s\S]*?\n?\{%\s*endcontent-ref\s*%\}/g,
    (_, url) => {
      return `<div class="content-ref" data-url="${url}"></div>`;
    }
  );

  // GitBook image paths → absolute
  html = html.replace(
    /src="[^"]*\.gitbook\/assets\/([^"]+)"/g,
    'src="/resources/$1"'
  );

  return html;
}

function buildTable(rows) {
  if (!rows.length) return '';
  const header = rows[0];
  const body = rows.slice(1);
  const ths = header.map((h) => `<th>${processInline(h)}</th>`).join('');
  const trs = body
    .map(
      (row) =>
        `<tr>${row.map((c) => `<td>${processInline(c)}</td>`).join('')}</tr>`
    )
    .join('\n');
  return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function processInline(text) {
  text = text.replace(/<br\s*\/?>\s*$/, '');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  text = text.replace(/`(.+?)`/g, '<code>$1</code>');
  text = text.replace(
    /<mark\s+style="color:([^"]+)">/g,
    '<mark style="color:$1">'
  );
  text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/!\[(.+?)\]\((.+?)\)/g, '<img src="$2" alt="$1" />');
  return text;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseFrontmatter(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      let value = match[2].trim();
      // 去除引號
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (/^\d+$/.test(value)) value = parseInt(value, 10);
      result[match[1]] = value;
    }
  }
  return result;
}

function contentHash(content) {
  return createHash('sha256')
    .update(content, 'utf-8')
    .digest('hex')
    .slice(0, 16);
}

// === 建構首頁結構化區塊 ===
function buildHomepageBlocks(html, frontmatter) {
  // 從 crossroad.md 的內容建構 HomepageBlock[]
  // 結構：zone-header → uep-dialogue → rich-text (敘事) → cross-road-grid → rich-text (debris)
  const blocks = [];

  // 1. zone-header
  blocks.push({
    id: 'blk-header',
    type: 'zone-header',
    content: JSON.stringify({
      title: '幻影重現室',
      subtitle:
        frontmatter.description ||
        '跟隨著幻影的腳步，你無意間來到了一個十字路口',
    }),
  });

  // 2. uep-dialogue — 使用 zones.ts 中定義的 3 句話
  blocks.push({
    id: 'blk-uep',
    type: 'uep-dialogue',
    content: JSON.stringify([
      {
        text: '小心不要跟錯人了喔，小U.E.P可是獨一無二的!',
        side: 'left',
        effects: ['shimmer', 'halo'],
      },
      {
        text: '這裡是世界的印象，每一個人都曾經存在於某一個時間當中。',
        side: 'left',
        effects: [],
      },
      {
        text: '他們是虛假幻象，但你是可以去接觸甚至仔細觀察他們的喔!',
        side: 'left',
        effects: [],
      },
    ]),
  });

  // 3. rich-text — 敘事段落（從 crossroad.md 的 HTML 取出）
  // 移除 stepper 等 GitBook 結構，只留敘事文字
  const narrativeHtml = html
    .replace(/<div class="stepper">[\s\S]*?<\/div>/g, '')
    .replace(/<div class="content-ref"[^>]*><\/div>/g, '')
    .trim();
  if (narrativeHtml) {
    blocks.push({
      id: 'blk-prose',
      type: 'rich-text',
      content: JSON.stringify({ html: narrativeHtml }),
    });
  }

  // 4. cross-road-grid — 四個方向
  blocks.push({
    id: 'blk-crossroad',
    type: 'cross-road-grid',
    content: JSON.stringify({
      roads: [
        {
          area: 'fwd',
          dir: '前方',
          name: '陳列走廊',
          hint: '前方隱約可見鏡面般的物體...',
          href: '/visuals?division=profiles',
        },
        {
          area: 'lft',
          dir: '左方',
          name: '鑲框室',
          hint: '相對而言這邊比較開闊',
          href: '/visuals?division=illustrations',
        },
        {
          area: 'rgt',
          dir: '右方',
          name: '抽象萃取間',
          hint: '可以看到人為修改過的痕跡',
          href: '/visuals?division=sketchs',
        },
        {
          area: 'bck',
          dir: '後方',
          name: '基底實驗室',
          hint: '感覺意外有動力',
          href: '/visuals?division=pixel',
        },
      ],
    }),
  });

  // 5. 讀取 debris.md 的內容作為額外 rich-text
  try {
    const debrisPath = join(CONTENT_ROOT, 'visuals', 'debris.md');
    if (existsSync(debrisPath)) {
      const debrisRaw = readFileSync(debrisPath, 'utf-8');
      const { html: debrisHtml } = mdToHtml(debrisRaw);
      if (debrisHtml.trim()) {
        blocks.push({
          id: 'blk-debris',
          type: 'rich-text',
          content: JSON.stringify({
            html: `<h3>扭曲的留言</h3>\n${debrisHtml}`,
          }),
        });
      }
    }
  } catch {
    /* ignore */
  }

  return blocks;
}

// === 清除現有 visuals 資料 ===
async function cleanVisuals() {
  console.log('🗑️  清除現有 Visuals 資料...');
  const res = await fetch(`${API_BASE}/api/content/visuals`);
  const json = await res.json();
  if (json.ok && json.data) {
    // 從最深的開始刪（避免 FK 問題）
    const sorted = json.data.sort((a, b) => b.depth - a.depth);
    for (const page of sorted) {
      await fetch(`${API_BASE}/api/content/${page.id}`, { method: 'DELETE' });
    }
    console.log(`   已刪除 ${json.data.length} 筆\n`);
  }
}

// === 匯入到 API ===
async function importToApi(pages) {
  console.log(`\n📤 匯入 ${pages.length} 個頁面...\n`);

  const payload = {
    pages: pages.map((p) => ({
      id: p.id,
      area: 'visuals',
      title: p.title,
      slug: p.slug,
      sortOrder: p.sortOrder,
      // homepage 用結構化區塊，其他用 rich_text
      content: p.homepageContent
        ? p.homepageContent
        : [{ id: 'content', type: 'rich_text', content: p.html }],
      sourceFile: p.sourceFile,
      contentHash: p.hash,
      parentId: p.parentId,
      depth: p.depth,
      pageType: p.pageType,
      metadata: p.metadata || {},
    })),
  };

  try {
    const res = await fetch(`${API_BASE}/api/content/sync/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (json.ok) {
      console.log(
        `✅ 完成！新增: ${json.data.imported}, 更新: ${json.data.updated}, 跳過: ${json.data.skipped}`
      );
    } else {
      console.error(`❌ API 錯誤: ${json.error}`);
    }
  } catch (e) {
    console.error(`❌ 連線錯誤: ${e.message}`);
  }
}

// === 主程式 ===
async function main() {
  if (CLEAN) await cleanVisuals();

  const entries = parseSummaryForVisuals();
  console.log(`🖼️  解析出 ${entries.length} 個 Visuals 頁面\n`);

  // 印出樹狀結構
  const typeIcons = {
    page: '📋',
    homepage: '🏠',
    division: '🏛️',
    subcategory: '📂',
    gallery: '🖼️',
  };
  for (const e of entries) {
    const indent = '  '.repeat(e.depth);
    const icon = typeIcons[e.pageType] || '📋';
    console.log(
      `${indent}${icon} ${e.title} [${e.pageType}] id=${e.id}${e.parentId ? ` ← ${e.parentId}` : ''}`
    );
  }

  const pages = [];
  for (const entry of entries) {
    try {
      const raw = readFileSync(entry.fullPath, 'utf-8');
      const { html, frontmatter } = mdToHtml(raw);
      const hash = contentHash(html);

      // 合併 frontmatter 到 metadata
      const metadata = { ...frontmatter };

      // homepage 類型：轉為結構化的 HomepageBlock[]
      if (entry.pageType === 'homepage') {
        const homepageContent = buildHomepageBlocks(html, frontmatter);
        pages.push({ ...entry, html: null, homepageContent, hash, metadata });
        continue;
      }

      // gallery 類型需要 images 陣列（初始為空，之後手動上傳）
      if (entry.pageType === 'gallery') {
        metadata.images = metadata.images || [];
        metadata.group = metadata.group || '';
        metadata.spoilerLevel = metadata.spoilerLevel || 0;
        metadata.gate = metadata.gate || '';
      }

      pages.push({ ...entry, html, hash, metadata });
    } catch (e) {
      console.error(`  ✗ ${entry.slug} — ${e.message}`);
    }
  }

  await importToApi(pages);
}

main().catch(console.error);
