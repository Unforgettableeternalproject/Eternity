/**
 * 遷移腳本：將 Echoes 區域的 MD 檔案匯入到 Content API (D1)
 *
 * 結構對照：
 *   GitBook SUMMARY.md 層級  →  D1 pageType
 *   ─────────────────────────────────────────
 *   plaza/README.md           →  page（Landing，不可編輯）
 *   photo.md                  →  page（褪色的相片，不可編輯）
 *   areas/README.md           →  chapter（集群）
 *   areas/ad_main.md          →  section（子分類）
 *     ### 歌曲標題             →  song（拆解自 section 檔案）
 *   characters/README.md      →  chapter
 *   characters/core_chara/README →  section
 *     protag.md               →  section（含多首歌 → 拆成 song）
 *   stories.md                →  chapter
 *     u.s..md                 →  section（含多首歌 → 拆成 song）
 *   special.md                →  chapter
 *     events.md               →  section（含多首歌 → 拆成 song）
 *
 * 使用方式：
 *   node scripts/migrate-echoes.mjs [--remote] [--clean] [--dry-run]
 *
 * --remote:  匯入到遠端 Worker（預設為 localhost:8788）
 * --clean:   先清除現有 echoes 資料再匯入
 * --dry-run: 只顯示結構，不實際匯入
 */

import { readFileSync, existsSync } from 'fs';
import { join, basename as pathBasename } from 'path';
import { createHash } from 'crypto';

// === 設定 ===
const USE_REMOTE = process.argv.includes('--remote');
const CLEAN = process.argv.includes('--clean');
const DRY_RUN = process.argv.includes('--dry-run');
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

console.log(`\n🎵 Echoes 內容遷移工具`);
console.log(`   目標: ${API_BASE}`);
console.log(`   清除模式: ${CLEAN ? '是' : '否'}`);
console.log(`   乾跑模式: ${DRY_RUN ? '是' : '否'}\n`);

// === 集群映射（用於 category 判定）===
const CLUSTER_CATEGORIES = {
  areas: 'area',
  characters: 'character',
  stories: 'story',
  special: 'special',
};

// === 判斷頁面類型 ===
function detectPageType(filePath, depth, parentPageType) {
  // 最頂層：plaza/README.md 和 photo.md → page (不可編輯)
  if (filePath === 'echos/plaza/README.md') return 'page';
  if (filePath === 'echos/photo.md') return 'page';

  // 第一層：4 大集群 → cluster
  // areas/README.md, characters/README.md, stories.md, special.md
  if (depth === 1) return 'cluster';

  // 第二層以下：子分類 → subcategory
  // ad_main.md, core_chara/README.md, protag.md, events.md 等
  if (depth >= 2) return 'subcategory';

  return 'subcategory';
}

// === 解析 SUMMARY.md 取得 Echoes 區域的結構 ===
function parseSummaryForEchoes() {
  const summary = readFileSync(SUMMARY_PATH, 'utf-8');
  const lines = summary.split('\n');

  let inEchoes = false;
  const entries = [];
  let sortOrder = 0;
  const parentStack = [];

  for (const line of lines) {
    if (line.includes('回音蒐藏間') || line.includes('#echos')) {
      inEchoes = true;
      continue;
    }
    if (inEchoes && line.startsWith('## ')) break;
    if (!inEchoes) continue;

    const match = line.match(/^(\s*)\*\s+\[(.+?)\]\((.+?)\)/);
    if (!match) continue;

    const [, indent, title, filePath] = match;
    if (!filePath.startsWith('echos/')) continue;

    const fullPath = join(CONTENT_ROOT, filePath);
    if (!existsSync(fullPath)) {
      console.log(`  ⚠ 跳過（不存在）: ${filePath}`);
      continue;
    }

    const depth = Math.floor(indent.length / 2);

    // 建立 slug：移除 echos/ 前綴、.md 後綴、/README
    let slug = filePath
      .replace(/^echos\//, '')
      .replace(/\.md$/, '')
      .replace(/\/README$/, '');

    // 簡化 slug：移除 plaza/ 前綴（plaza 是容器，不影響 ID 結構）
    slug = slug.replace(/^plaza\//, '');

    const id = `echoes/${slug}`;

    // 找 parent
    while (
      parentStack.length > 0 &&
      parentStack[parentStack.length - 1].depth >= depth
    ) {
      parentStack.pop();
    }
    const parentId =
      parentStack.length > 0 ? parentStack[parentStack.length - 1].id : null;
    const parentPageType =
      parentStack.length > 0
        ? parentStack[parentStack.length - 1].pageType
        : null;

    const pageType = detectPageType(filePath, depth, parentPageType);

    parentStack.push({ id, depth, pageType });

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

// === 從 MD 檔案中拆解歌曲 ===
function extractSongs(content, parentId, parentSlug, parentDepth) {
  const songs = [];

  // 用 ### 分割
  const sections = content.split(/(?=^###\s)/m);
  let songOrder = 0;

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed.startsWith('###')) continue;

    // 提取標題
    const titleLine = trimmed.split('\n')[0];
    // 移除 ### 和 markdown 格式符號
    let title = titleLine
      .replace(/^###\s+/, '')
      .replace(/\*\*/g, '')
      .replace(/\\?\*/g, '')
      .trim();

    // 跳過不是歌曲的 ### 標題（例如純文字分節）
    // 歌曲通常有 {% file %} 標籤
    const hasFile = /\{%\s*file\s/.test(trimmed);
    if (!hasFile) continue;

    // 提取音檔名
    const fileMatch = trimmed.match(
      /\{%\s*file\s+src="[^"]*\/([^"/]+\.wav)"\s*%\}/
    );
    const audioFile = fileMatch ? fileMatch[1] : null;

    // 提取字幕（{% file %} 和 {% endfile %} 之間的文字）
    const captionMatch = trimmed.match(
      /\{%\s*file\s[^%]*%\}\s*\n(.+?)\n\s*\{%\s*endfile\s*%\}/
    );
    const subtitle = captionMatch ? captionMatch[1].trim() : '';

    // 提取賞析/作者的話（#### 賞析: / 作者的話: / 敘述: 之後的段落）
    const appreciationMatch = trimmed.match(
      /####\s+\**(?:賞析|作者的話|敘述)[:\uff1a]?\**\s*\n([\s\S]*?)(?=\n\*\*\*|\n###|$)/
    );
    let appreciationRaw = appreciationMatch ? appreciationMatch[1].trim() : '';

    // 分段
    const appreciationParagraphs = appreciationRaw
      .split(/\n\n+/)
      .map((p) =>
        p
          .replace(/\*\*/g, '')
          .replace(/\\?\*/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/&#x20;/g, ' ')
          .trim()
      )
      .filter((p) => p.length > 0);

    // 判斷是否為鎖定狀態的賞析（placeholder 文字）
    const isLockedAppreciation =
      appreciationParagraphs.length === 1 &&
      (appreciationParagraphs[0].includes('你感到不解') ||
        appreciationParagraphs[0].includes('找不到') ||
        appreciationParagraphs[0].includes('沒有辦法理解') ||
        appreciationParagraphs[0].includes('找不到任何'));

    // 產生 slug（從音檔名或標題）
    let songSlug;
    if (audioFile) {
      songSlug = audioFile
        .replace(/\.wav$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    } else {
      songSlug = `song-${songOrder}`;
    }

    // 確定所屬 cluster（從 parentSlug 推導）
    let category = 'area';
    for (const [key, cat] of Object.entries(CLUSTER_CATEGORIES)) {
      if (parentSlug.includes(key) || parentId.includes(key)) {
        category = cat;
        break;
      }
    }

    // 判斷 spoiler level（基於 ◼︎ 遮蔽程度）
    let spoilerLevel = 0;
    const blockCount = (title.match(/◼/g) || []).length;
    if (blockCount > 0) {
      // 有遮蔽符號
      const totalChars = [...title].filter(
        (c) => !/[\s\-「」()\uff08\uff09]/u.test(c)
      ).length;
      const ratio = blockCount / totalChars;
      if (ratio > 0.6) spoilerLevel = 2;
      else spoilerLevel = 1;
    }

    const songId = `${parentId}/${songSlug}`;

    const metadata = {
      subtitle: subtitle || (audioFile ? audioFile.replace('.wav', '') : ''),
      category,
      spoilerLevel,
      gate: '',
      audioFile: audioFile || null,
      audioMeta: null,
      appreciation: isLockedAppreciation ? [''] : appreciationParagraphs,
      appreciationLocked: isLockedAppreciation ? appreciationParagraphs[0] : '',
    };

    songs.push({
      id: songId,
      title,
      slug: `${parentSlug}/${songSlug}`,
      sortOrder: songOrder++,
      depth: parentDepth + 1,
      parentId,
      pageType: 'song',
      sourceFile: null,
      html: '',
      hash: contentHash(JSON.stringify(metadata)),
      metadata,
    });
  }

  return songs;
}

// === MD → HTML 轉換（複用 migrate-history 的邏輯）===
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

    // GitBook 語法行原封不動保留
    if (
      trimmed.match(
        /^\{%\s*(hint|endhint|tabs|endtabs|tab|endtab|file|endfile)/
      )
    ) {
      htmlParts.push(line);
      continue;
    }

    // HTML 區塊原封保留
    if (
      trimmed.startsWith('<table') ||
      trimmed.startsWith('<div') ||
      trimmed.startsWith('<img')
    ) {
      htmlParts.push(line);
      continue;
    }

    if (trimmed === '') continue;

    // 水平線
    if (trimmed === '***' || trimmed === '---') {
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

    // 列表
    if (line.match(/^\s*\*\s+/)) {
      const text = line.replace(/^\s*\*\s+/, '');
      htmlParts.push(`<li>${processInline(text)}</li>`);
      continue;
    }

    // 一般段落
    const processed = processInline(trimmed);
    if (processed) htmlParts.push(`<p>${processed}</p>`);
  }

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

  // File embeds（轉為音訊提示）
  html = html.replace(
    /\{%\s*file\s+src="([^"]+)"\s*%\}[\s\S]*?\{%\s*endfile\s*%\}/g,
    (_, src) => {
      const fname = src.split('/').pop();
      return `<div class="audio-embed" data-src="${fname}">🎵 ${fname}</div>`;
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

  // GitBook 圖片路徑
  html = html.replace(
    /src="[^"]*\.gitbook\/assets\/([^"]+)"/g,
    'src="/resources/$1"'
  );

  return html;
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
  // 處理 GitBook 的 &#x20; 和 &#xFE0E;
  text = text.replace(/&#x20;/g, ' ');
  text = text.replace(/&#xFE0E;/g, '');
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

// === 判斷是否為含歌曲的 section 檔案 ===
function hasSongsInFile(content) {
  // 包含 ### 標題 + {% file %} 音檔嵌入
  return /^###\s/m.test(content) && /\{%\s*file\s/.test(content);
}

// === 清除現有 echoes 資料 ===
async function cleanEchoes() {
  console.log('🗑️  清除現有 Echoes 資料...');
  const res = await fetch(`${API_BASE}/api/content/echoes`);
  const json = await res.json();
  if (json.ok && json.data) {
    for (const page of json.data) {
      await fetch(`${API_BASE}/api/content/${page.id}`, { method: 'DELETE' });
    }
    console.log(`   已刪除 ${json.data.length} 筆\n`);
  }
}

// === 匯入到 API（分批，每批 20 筆）===
const BATCH_SIZE = 20;

async function importToApi(pages) {
  console.log(`\n📤 匯入 ${pages.length} 個頁面（每批 ${BATCH_SIZE} 筆）...\n`);

  let totalImported = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(pages.length / BATCH_SIZE);

    const payload = {
      pages: batch.map((p) => ({
        id: p.id,
        area: 'echoes',
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

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        console.error(
          `   ❌ 批次 ${batchNum}/${totalBatches} — 非 JSON 回應: ${text.slice(0, 100)}`
        );
        continue;
      }

      if (json.ok) {
        totalImported += json.data.imported || 0;
        totalUpdated += json.data.updated || 0;
        totalSkipped += json.data.skipped || 0;
        console.log(
          `   ✓ 批次 ${batchNum}/${totalBatches} — 新增: ${json.data.imported}, 更新: ${json.data.updated}, 跳過: ${json.data.skipped}`
        );
      } else {
        console.error(`   ❌ 批次 ${batchNum}/${totalBatches} — ${json.error}`);
      }
    } catch (e) {
      console.error(
        `   ❌ 批次 ${batchNum}/${totalBatches} — 連線錯誤: ${e.message}`
      );
    }
  }

  console.log(
    `\n✅ 匯入完成！新增: ${totalImported}, 更新: ${totalUpdated}, 跳過: ${totalSkipped}`
  );
}

// === 主程式 ===
async function main() {
  if (CLEAN && !DRY_RUN) await cleanEchoes();

  const entries = parseSummaryForEchoes();
  console.log(`📖 解析出 ${entries.length} 個 Echoes 頁面\n`);

  const typeIcons = {
    page: '📋',
    chapter: '📂',
    section: '📄',
    song: '🎵',
  };

  const pages = [];

  for (const entry of entries) {
    try {
      const raw = readFileSync(entry.fullPath, 'utf-8');
      const { html, frontmatter } = mdToHtml(raw);
      const hash = contentHash(html);

      const indent = '  '.repeat(entry.depth);
      const icon = typeIcons[entry.pageType] || '📋';
      console.log(
        `${indent}${icon} ${entry.title} [${entry.pageType}] → ${entry.id}`
      );

      pages.push({ ...entry, html, hash, metadata: frontmatter });

      // 對 subcategory 層級的檔案，嘗試拆解歌曲
      if (entry.pageType === 'subcategory' && hasSongsInFile(raw)) {
        const songs = extractSongs(raw, entry.id, entry.slug, entry.depth);
        for (const song of songs) {
          const songIndent = '  '.repeat(song.depth);
          console.log(`${songIndent}🎵 ${song.title} [song] → ${song.id}`);
          pages.push(song);
        }
        console.log(`${indent}   ↳ 拆解出 ${songs.length} 首歌曲`);
      }
    } catch (e) {
      console.error(`  ✗ ${entry.slug} — ${e.message}`);
    }
  }

  console.log(`\n📊 總計: ${pages.length} 筆`);
  console.log(
    `   page: ${pages.filter((p) => p.pageType === 'page').length}`,
    `| cluster: ${pages.filter((p) => p.pageType === 'cluster').length}`,
    `| subcategory: ${pages.filter((p) => p.pageType === 'subcategory').length}`,
    `| song: ${pages.filter((p) => p.pageType === 'song').length}`
  );

  if (DRY_RUN) {
    console.log('\n🏃 乾跑模式 — 不執行匯入\n');
    return;
  }

  await importToApi(pages);
}

main().catch(console.error);
