/**
 * 遷移腳本：將 History 區域的 MD 檔案匯入到 Content API (D1)
 * 支援層級結構（zone → chapter → arc → section）
 *
 * 使用方式：
 *   node scripts/migrate-history.mjs [--remote] [--clean]
 *
 * --remote: 匯入到遠端 Worker（預設為 localhost:8788）
 * --clean:  先清除現有 history 資料再匯入
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
  '..',
  'U.E.P-s-Imaginary-Space'
);
const SUMMARY_PATH = join(CONTENT_ROOT, 'SUMMARY.md');

console.log(`\n📚 History 內容遷移工具（含層級結構）`);
console.log(`   目標: ${API_BASE}`);
console.log(`   清除模式: ${CLEAN ? '是' : '否'}\n`);

// === 判斷頁面類型 ===
function detectPageType(filePath, depth) {
  // depth 0: 根層（passage, note）
  // depth 1: 區間 zone（unforgettable_story, epoch_of_eternity）
  // depth 2: 章節 chapter（chpt.-1, chpt.01）
  // depth 3: 篇 arc（arc.00, arc.01）
  // depth 4: 小節 section（sect.01）

  const basename = filePath
    .split('/')
    .pop()
    .replace('.md', '')
    .replace('/README', '');

  if (
    filePath.includes('/passage/') &&
    !filePath.includes('unforgettable_story') &&
    !filePath.includes('epoch_of_eternity') &&
    !filePath.includes('project_4267') &&
    filePath.endsWith('README.md')
  ) {
    return 'page'; // 三向通道本身
  }

  if (basename.startsWith('sect.') || basename.startsWith('sect'))
    return 'section';
  if (basename.startsWith('arc.') || basename.startsWith('arc')) return 'arc';
  if (basename.startsWith('chpt.') || basename.startsWith('chpt'))
    return 'chapter';

  // 區間級別
  if (
    filePath.includes('unforgettable_story/README') ||
    filePath.includes('epoch_of_eternity') ||
    filePath.includes('project_4267')
  ) {
    return 'zone';
  }

  // 章節 README
  if (filePath.includes('/chpt.') && filePath.endsWith('README.md')) {
    return 'chapter';
  }

  return 'page';
}

// === 解析 SUMMARY.md 取得 History 區域的結構（含縮排層級） ===
function parseSummaryForHistory() {
  const summary = readFileSync(SUMMARY_PATH, 'utf-8');
  const lines = summary.split('\n');

  let inHistory = false;
  const entries = [];
  let sortOrder = 0;

  // 用來追蹤每一層的最後一個 ID（用於建立 parent 關係）
  const parentStack = []; // [{id, depth}]

  for (const line of lines) {
    if (line.includes('歷史典藏庫') || line.includes('#history')) {
      inHistory = true;
      continue;
    }
    if (inHistory && line.startsWith('## ')) break;
    if (!inHistory) continue;

    const match = line.match(/^(\s*)\*\s+\[(.+?)\]\((.+?)\)/);
    if (!match) continue;

    const [, indent, title, filePath] = match;
    if (!filePath.startsWith('history/')) continue;

    const fullPath = join(CONTENT_ROOT, filePath);
    if (!existsSync(fullPath)) {
      console.log(`  ⚠ 跳過（不存在）: ${filePath}`);
      continue;
    }

    // 縮排深度（每 2 空格為一層）
    const depth = Math.floor(indent.length / 2);

    let slug = filePath
      .replace(/^history\//, '')
      .replace(/\.md$/, '')
      .replace(/\/README$/, '');

    const id = `history/${slug}`;
    const pageType = detectPageType(filePath, depth);

    // 找 parent：往回找比自己淺一層的
    while (
      parentStack.length > 0 &&
      parentStack[parentStack.length - 1].depth >= depth
    ) {
      parentStack.pop();
    }
    const parentId =
      parentStack.length > 0 ? parentStack[parentStack.length - 1].id : null;

    // 自己入棧
    parentStack.push({ id, depth });

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
  // 解析並移除 frontmatter
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  let body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const frontmatter = fmMatch ? parseFrontmatter(fmMatch[1]) : {};

  // 移除第一個 h1 標題
  body = body.replace(/^\s*#\s+.+\r?\n/, '');

  // 第一步：逐行轉換基本 markdown
  let html = convertLines(body);

  // 第二步：在完成的 HTML 上做 GitBook 區塊轉換
  html = convertGitBookBlocks(html);

  return { html, frontmatter };
}

/** 逐行轉換 Markdown → HTML */
function convertLines(body) {
  const lines = body.split('\n');
  const htmlParts = [];
  let inCodeBlock = false;
  let codeContent = '';
  let inTable = false;
  let tableRows = [];
  let inHtmlBlock = false;
  let htmlBlockContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 程式碼區塊
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

    // GitBook 語法行 — 原封不動保留（之後由 convertGitBookBlocks 處理）
    if (
      trimmed.match(
        /^\{%\s*(hint|endhint|tabs|endtabs|tab|endtab|file|endfile)/
      )
    ) {
      htmlParts.push(line);
      continue;
    }

    // HTML 區塊（<table, <div, <img 等）— 原封不動保留
    if (
      trimmed.startsWith('<table') ||
      trimmed.startsWith('<div') ||
      trimmed.startsWith('<img')
    ) {
      // 如果是單行 HTML，直接保留
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

    // 水平線
    if (trimmed === '***' || trimmed === '---' || trimmed.match(/^[❇︎]+$/)) {
      htmlParts.push('<hr>');
      continue;
    }

    // 標題
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      htmlParts.push(
        `<h${level}>${processInline(headingMatch[2])}</h${level}>`
      );
      continue;
    }

    // 引言
    if (trimmed.startsWith('> ')) {
      htmlParts.push(
        `<blockquote><p>${processInline(trimmed.slice(2))}</p></blockquote>`
      );
      continue;
    }

    // 列表（無序）
    if (line.match(/^\s*\*\s+/)) {
      const text = line.replace(/^\s*\*\s+/, '');
      htmlParts.push(`<li>${processInline(text)}</li>`);
      continue;
    }

    // 一般段落
    const processed = processInline(trimmed);
    if (processed) htmlParts.push(`<p>${processed}</p>`);
  }

  if (inTable && tableRows.length) htmlParts.push(buildTable(tableRows));

  // 把連續的 <li> 包在 <ul> 裡
  let html = htmlParts.join('\n');
  html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>\n$1</ul>');

  return html;
}

/** 在最終 HTML 上轉換 GitBook 區塊語法 */
function convertGitBookBlocks(html) {
  // --- Hints ---
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
      // content 已經被轉成 HTML 了（<p> 標籤等），直接用
      const cleaned = content.replace(/<\/?p>/g, '').trim();
      return `<div class="hint hint-${style}" style="border-left:3px solid ${color};background:${color}15;padding:0.75rem 1rem;border-radius:6px;margin:0.5rem 0;"><p>${cleaned}</p></div>`;
    }
  );

  // --- Tabs ---
  html = html.replace(
    /\{%\s*tabs\s*%\}\s*\n?([\s\S]*?)\n?\{%\s*endtabs\s*%\}/g,
    (_, tabsContent) => {
      const tabMatches = [
        ...tabsContent.matchAll(
          /\{%\s*tab\s+title="(.+?)"\s*%\}\s*\n?([\s\S]*?)(?=\n?\{%\s*endtab\s*%\})/g
        ),
      ];
      if (!tabMatches.length) return '';
      const tabs = tabMatches.map((m, i) => {
        const title = m[1];
        const content = m[2].trim();
        return `<div class="tab-panel" data-tab="${i}" ${i === 0 ? '' : 'style="display:none"'}>
          ${content}
        </div>`;
      });
      const tabButtons = tabMatches
        .map(
          (m, i) =>
            `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${i}">${m[1]}</button>`
        )
        .join('');
      return `<div class="tabs-container">
        <div class="tabs-header">${tabButtons}</div>
        <div class="tabs-body">${tabs.join('\n')}</div>
      </div>`;
    }
  );

  // --- Card tables ---
  html = html.replace(
    /<table data-view="cards">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>\s*<\/table>/g,
    (_, tbody) => {
      const rows = [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
      const cards = rows.map((row) => {
        const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
        const label = cells[0]?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
        const linkMatch = row[1].match(/<a\s+href="([^"]+)"/);
        const href = linkMatch?.[1]?.replace(/\/$/, '') || '';
        if (href) {
          return `<div class="content-card" data-nav-ref="${href}"><strong>${label}</strong></div>`;
        }
        return `<div class="content-card"><strong>${label}</strong></div>`;
      });
      return `<div class="card-grid">${cards.join('\n')}</div>`;
    }
  );

  // --- GitBook image paths → absolute ---
  // Convert relative .gitbook/assets paths to /resources/
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

/** 簡單解析 YAML frontmatter 為物件 */
function parseFrontmatter(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      let value = match[2].trim();
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

// === 清除現有 history 資料 ===
async function cleanHistory() {
  console.log('🗑️  清除現有 History 資料...');
  // 透過 list 取得所有 history 頁面，逐一刪除
  const res = await fetch(`${API_BASE}/api/content/history`);
  const json = await res.json();
  if (json.ok && json.data) {
    for (const page of json.data) {
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
      area: 'history',
      title: p.title,
      slug: p.slug,
      sortOrder: p.sortOrder,
      content: [{ id: 'content', type: 'rich_text', content: p.html }],
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
  if (CLEAN) await cleanHistory();

  const entries = parseSummaryForHistory();
  console.log(`📖 解析出 ${entries.length} 個 History 頁面\n`);

  // 印出樹狀結構
  const typeIcons = {
    zone: '🌐',
    chapter: '📖',
    arc: '📄',
    section: '📃',
    page: '📋',
  };
  for (const e of entries) {
    const indent = '  '.repeat(e.depth);
    const icon = typeIcons[e.pageType] || '📋';
    console.log(
      `${indent}${icon} ${e.title} [${e.pageType}]${e.parentId ? ` ← ${e.parentId}` : ''}`
    );
  }

  const pages = [];
  for (const entry of entries) {
    try {
      const raw = readFileSync(entry.fullPath, 'utf-8');
      const { html, frontmatter } = mdToHtml(raw);
      const hash = contentHash(html);
      pages.push({ ...entry, html, hash, metadata: frontmatter });
    } catch (e) {
      console.error(`  ✗ ${entry.slug} — ${e.message}`);
    }
  }

  await importToApi(pages);
}

main().catch(console.error);
