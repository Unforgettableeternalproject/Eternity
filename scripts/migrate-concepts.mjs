/**
 * 遷移腳本：將 Concepts 區域的 MD 檔案匯入到 Content API (D1)
 * 支援層級結構（homepage → stack → type → subcategory → context）
 *
 * 使用方式：
 *   node scripts/migrate-concepts.mjs [--remote] [--clean]
 *
 * --remote: 匯入到遠端 Worker（預設為 localhost:8788）
 * --clean:  先清除現有 concepts 資料再匯入
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
const API_TOKEN = process.env.API_TOKEN ?? '';

const CONTENT_ROOT = join(
  import.meta.dirname,
  '..',
  '..',
  'U.E.P-s-Imaginary-Space'
);
const SUMMARY_PATH = join(CONTENT_ROOT, 'SUMMARY.md');

console.log(`\n⬡ Concepts 內容遷移工具`);
console.log(`  目標: ${API_BASE}`);
console.log(`  清除模式: ${CLEAN ? '是' : '否'}\n`);

// === 首頁區塊定義 ===
const HOMEPAGE_BLOCKS = [
  {
    id: 'c1',
    type: 'zone-header',
    content: JSON.stringify({
      title: '概念調整房',
      subtitle:
        '世界觀、設定文件。一切關於這個世界「為什麼是這樣」的解答都在這裡，如果你找得到的話。',
    }),
    attrs: {},
  },
  {
    id: 'c2',
    type: 'uep-dialogue',
    content: JSON.stringify([
      {
        text: '嘿~這裡是「概念調整房」! 有點複雜對吧? (｡•̀ᴗ-)✧',
        side: 'left',
        effects: [],
      },
      {
        text: '簡單來說就是...這邊存放著所有關於這個世界的「設定」和「規則」! 像是角色是怎麼運作的之類的~',
        side: 'right',
        effects: ['shimmer'],
      },
    ]),
    attrs: {},
  },
  // c-rich 會在主程式中插入（server.md 的敘事內容）
  {
    id: 'c3',
    type: 'terminal-module-table',
    content: JSON.stringify({
      headerLabel: '// concepts.modules — listing',
      modules: [
        {
          id: '01',
          name: '永續紀錄主機',
          en: 'persistent_log_server',
          state: 'sync',
          records: 124,
        },
        {
          id: '02',
          name: '個性瀏覽器',
          en: 'identity_browser',
          state: 'sync',
          records: 38,
        },
        {
          id: '03',
          name: '原質震盪時鐘',
          en: 'essence_oscillator',
          state: 'sync',
          records: 9,
        },
        {
          id: '04',
          name: '認知對照平台',
          en: 'cognition_compare',
          state: 'idle',
          records: 14,
        },
      ],
    }),
    attrs: {},
  },
];

// === 判斷頁面類型 ===
function detectPageType(entry, allEntries) {
  // depth 0: server.md → homepage（已在主程式中特殊處理）
  if (entry.depth === 0) return 'homepage';
  // depth 1: 四個 stack（records, browser, time_logs, translation）
  if (entry.depth === 1) return 'stack';
  // 判斷是否有子項
  const hasChildren = allEntries.some((e) => e.parentId === entry.id);
  if (hasChildren) {
    // 有子項的容器：depth 2 → type, depth 3+ → subcategory
    return entry.depth === 2 ? 'type' : 'subcategory';
  }
  // 葉節點：context
  return 'context';
}

// === 解析 SUMMARY.md 取得 Concepts 區域的結構（含縮排層級）===
function parseSummaryForConcepts() {
  const summary = readFileSync(SUMMARY_PATH, 'utf-8');
  const lines = summary.split('\n');

  let inConcepts = false;
  const entries = [];
  let sortOrder = 0;
  const parentStack = [];

  for (const line of lines) {
    if (line.includes('概念調整房') || line.includes('#concepts')) {
      inConcepts = true;
      continue;
    }
    if (inConcepts && line.startsWith('## ')) break;
    if (!inConcepts) continue;

    const match = line.match(/^(\s*)\*\s+\[(.+?)\]\((.+?)\)/);
    if (!match) continue;

    const [, indent, title, filePath] = match;
    if (!filePath.startsWith('concepts/')) continue;

    const fullPath = join(CONTENT_ROOT, filePath);
    if (!existsSync(fullPath)) {
      console.log(`  ⚠ 跳過（不存在）: ${filePath}`);
      continue;
    }

    // 縮排深度（每 2 空格為一層）
    const depth = Math.floor(indent.length / 2);

    // 產生 slug：移除 concepts/ 前綴、.md 後綴、/README 後綴
    let slug = filePath
      .replace(/^concepts\//, '')
      .replace(/\.md$/, '')
      .replace(/\/README$/, '');

    // server.md → homepage
    const isHomepage = slug === 'server';
    if (isHomepage) slug = 'homepage';

    const id = `concepts/${slug}`;

    // 找 parent：往回找比自己淺一層的
    while (
      parentStack.length > 0 &&
      parentStack[parentStack.length - 1].depth >= depth
    ) {
      parentStack.pop();
    }
    const parentId =
      parentStack.length > 0 ? parentStack[parentStack.length - 1].id : null;

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
      isHomepage,
    });
  }

  return entries;
}

// === MD → HTML 轉換（與 migrate-history.mjs 共用邏輯）===
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

    // GitBook 語法行 — 保留（由 convertGitBookBlocks 處理）
    if (
      trimmed.match(
        /^\{%\s*(hint|endhint|tabs|endtabs|tab|endtab|file|endfile)/
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
      trimmed.startsWith('<details') ||
      trimmed.startsWith('</details') ||
      trimmed.startsWith('<summary') ||
      trimmed.startsWith('</summary')
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
    if (line.match(/^\s*[\*\-]\s+/)) {
      const text = line.replace(/^\s*[\*\-]\s+/, '');
      htmlParts.push(`<li>${processInline(text)}</li>`);
      continue;
    }

    // 一般段落
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

  // Tabs
  html = html.replace(
    /\{%\s*tabs\s*%\}\s*\n?([\s\S]*?)\n?\{%\s*endtabs\s*%\}/g
    ,
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

  // Card tables
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

  // GitBook image paths
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

// === 建立首頁 ===
async function createHomepage(homepageEntry) {
  console.log('📄 建立 Concepts 首頁...');

  const raw = readFileSync(homepageEntry.fullPath, 'utf-8');
  const { html } = mdToHtml(raw);

  // 在 uep-dialogue 和 terminal-module-table 之間插入敘事內容
  const blocks = [
    HOMEPAGE_BLOCKS[0], // zone-header
    HOMEPAGE_BLOCKS[1], // uep-dialogue
    {
      id: 'c-rich',
      type: 'rich-text',
      content: JSON.stringify({ html }),
      attrs: {},
    },
    HOMEPAGE_BLOCKS[2], // terminal-module-table
  ];

  const url = `${API_BASE}/api/content/concepts/homepage`;
  const body = {
    title: '概念調整房 首頁',
    content: blocks,
    pageType: 'homepage',
    parentId: null,
    depth: 0,
  };

  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.ok) {
      console.log(`  ✅ 首頁已建立（${blocks.length} 個區塊）`);
    } else {
      console.error(`  ❌ 首頁建立失敗: ${json.error}`);
    }
  } catch (e) {
    console.error(`  ❌ 連線錯誤: ${e.message}`);
  }
}

// === 清除現有資料 ===
async function cleanConcepts() {
  console.log('🗑️  清除現有 Concepts 資料...');
  const res = await fetch(`${API_BASE}/api/content/concepts`);
  const json = await res.json();
  if (json.ok && json.data) {
    for (const page of json.data) {
      await fetch(`${API_BASE}/api/content/${page.id}`, { method: 'DELETE' });
    }
    console.log(`   已刪除 ${json.data.length} 筆\n`);
  }
}

// === 匯入內容頁到 API ===
async function importToApi(pages) {
  console.log(`\n📤 匯入 ${pages.length} 個內容頁面...\n`);

  const payload = {
    pages: pages.map((p) => ({
      id: p.id,
      area: 'concepts',
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

  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

  try {
    const res = await fetch(`${API_BASE}/api/content/sync/import`, {
      method: 'POST',
      headers,
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
  if (CLEAN) await cleanConcepts();

  const entries = parseSummaryForConcepts();
  console.log(`📖 解析出 ${entries.length} 個 Concepts 頁面\n`);

  // 分離出首頁和內容頁
  const homepageEntry = entries.find((e) => e.isHomepage);
  const contentEntries = entries.filter((e) => !e.isHomepage);

  // 為每個 entry 設定 pageType（需要所有 entries 來判斷是否有子項）
  // 首頁的 parentId 是 null，內容頁的 parentId 要把 homepage 的 parentId 移除
  // （因為 stacks 的 parent 在 SUMMARY.md 中是 server.md，但 server.md 變成了 homepage）
  for (const entry of contentEntries) {
    // 如果 parentId 指向 homepage，改為 concepts/homepage
    if (entry.parentId === 'concepts/homepage') {
      entry.parentId = 'concepts/homepage';
    }
    entry.pageType = detectPageType(entry, contentEntries);
  }

  // 印出樹狀結構
  const typeIcons = {
    homepage: '🏠',
    stack: '📦',
    type: '📂',
    subcategory: '📁',
    context: '📄',
  };

  if (homepageEntry) {
    console.log(`🏠 ${homepageEntry.title} [homepage]`);
  }
  for (const e of contentEntries) {
    const indent = '  '.repeat(e.depth);
    const icon = typeIcons[e.pageType] || '📄';
    console.log(
      `${indent}${icon} ${e.title} [${e.pageType}]${e.parentId ? ` ← ${e.parentId}` : ''}`
    );
  }

  // 1. 建立首頁
  if (homepageEntry) {
    await createHomepage(homepageEntry);
  }

  // 2. 轉換內容頁並匯入
  const pages = [];
  for (const entry of contentEntries) {
    try {
      const raw = readFileSync(entry.fullPath, 'utf-8');
      const { html, frontmatter } = mdToHtml(raw);
      const hash = contentHash(html);

      // 將 frontmatter 轉為 metadata
      const metadata = {};
      if (frontmatter.icon) metadata.icon = frontmatter.icon;
      if (frontmatter.description) metadata.description = frontmatter.description;
      if (frontmatter.hidden === true) metadata.hidden = true;

      pages.push({ ...entry, html, hash, metadata });
    } catch (e) {
      console.error(`  ✗ ${entry.slug} — ${e.message}`);
    }
  }

  if (pages.length > 0) {
    await importToApi(pages);
  }

  console.log(`\n⬡ 遷移完成`);
}

main().catch(console.error);
