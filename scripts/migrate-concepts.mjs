/**
 * 遷移腳本：將 Concepts 區域的 MD 檔案匯入到 Content API (D1)
 * 解析 GitBook 語法為結構化 JSON（Dossier / Browser / Chrono / Diff）
 *
 * 使用方式：
 *   node scripts/migrate-concepts.mjs [--remote] [--clean]
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

const CONTENT_ROOT = join(import.meta.dirname, '..', '..', 'U.E.P-s-Imaginary-Space');

console.log(`\n⬡ Concepts 內容遷移工具（結構化 JSON）`);
console.log(`  目標: ${API_BASE}`);
console.log(`  清除模式: ${CLEAN ? '是' : '否'}\n`);

// === Stack 定義 ===
// records (dossier) 採用多 variant 結構：每個 type 一個 D1 頁面，內含多個 variant；
// 其他 stack 維持單一 file 對單一頁面。
const STACKS = {
  records: {
    slug: 'server/records', style: 'dossier', label: '永續紀錄主機',
    // 每個 type 一個項目，variants 列出該 type 在各 era 的來源檔
    types: [
      {
        slug: 'character_list', typeGroup: 'character_list',
        variants: [
          { id: 'u', label: 'U', src: 'concepts/server/records/character_list_u.md' },
        ],
      },
      {
        slug: 'inversa', typeGroup: 'inversa',
        variants: [
          { id: 'u', label: 'U', src: 'concepts/server/records/inversa_u.md' },
        ],
      },
      {
        slug: 'location_list', typeGroup: 'location_list',
        variants: [
          { id: 'u', label: 'U', src: 'concepts/server/records/location_list_u.md' },
        ],
      },
      {
        slug: 'hostile_creatures', typeGroup: 'hostile_creatures',
        variants: [
          { id: 'u', label: 'U', src: 'concepts/server/records/hostile_creatures_u.md' },
        ],
      },
      {
        slug: 'vestera', typeGroup: 'vestera',
        variants: [
          { id: 'u', label: 'U', src: 'concepts/server/records/vestera_u.md' },
        ],
      },
      {
        slug: 'special_rules', typeGroup: 'special_rules',
        variants: [
          { id: 'u', label: 'U', src: 'concepts/server/records/special_rules_u.md' },
        ],
      },
      {
        slug: 'truth', typeGroup: 'truth',
        variants: [
          { id: 'u', label: 'U', src: 'concepts/server/records/truth_u.md' },
        ],
      },
    ],
  },
  browser: {
    slug: 'server/browser', style: 'browser', label: '個性瀏覽器',
    files: [
      { src: 'concepts/server/browser/charateristics.md', typeGroup: 'characteristics', era: 'u' },
      { src: 'concepts/server/browser/final_analysis.md', typeGroup: 'final_analysis', era: 'u' },
      { src: 'concepts/server/browser/entitled.md', typeGroup: 'entitled', era: 'u' },
    ],
  },
  oscillator: {
    slug: 'server/time_logs', style: 'chrono', label: '原質震盪時鐘',
    files: [
      { src: 'concepts/server/time_logs/chronicles.md', typeGroup: 'chronicles', era: 'u' },
      { src: 'concepts/server/time_logs/spoilers.md', typeGroup: 'spoilers', era: 'u' },
    ],
  },
  compare: {
    slug: 'server/translation', style: 'diff', label: '認知對照平台',
    files: [
      { src: 'concepts/server/translation/explainations.md', typeGroup: 'explanations', era: 'default' },
      { src: 'concepts/server/translation/multilingual.md', typeGroup: 'multilingual', era: 'default' },
      { src: 'concepts/server/translation/fake_name.md', typeGroup: 'fake_name', era: 'default' },
    ],
  },
};

// === Frontmatter 解析 ===
function parseFrontmatter(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      let value = match[2].trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      result[match[1]] = value;
    }
  }
  return result;
}

function readMd(filePath) {
  const full = join(CONTENT_ROOT, filePath);
  if (!existsSync(full)) return null;
  const raw = readFileSync(full, 'utf-8');
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  const frontmatter = fmMatch ? parseFrontmatter(fmMatch[1]) : {};
  // 移除第一個 h1 標題
  const cleaned = body.replace(/^\s*#\s+.+\r?\n/, '');
  return { body: cleaned, frontmatter, title: body.match(/^#\s+(.+)/m)?.[1]?.trim() || '' };
}

// === Hint 解析 → 轉為 intro_html ===
function extractIntroHtml(body) {
  const hints = [];
  const regex = /\{%\s*hint\s+style="(\w+)"\s*%\}\s*\n?([\s\S]*?)\n?\{%\s*endhint\s*%\}/g;
  let m;
  while ((m = regex.exec(body))) {
    hints.push(`<p>${m[2].trim()}</p>`);
  }
  return hints.length > 0 ? hints.join('\n') : undefined;
}

// === Tab 解析 ===
function extractTabs(body) {
  const tabsMatch = body.match(/\{%\s*tabs\s*%\}([\s\S]*?)\{%\s*endtabs\s*%\}/);
  if (!tabsMatch) return [];
  const tabRegex = /\{%\s*tab\s+title="(.+?)"\s*%\}\s*\n?([\s\S]*?)(?=\n?\{%\s*endtab\s*%\})/g;
  const tabs = [];
  let m;
  while ((m = tabRegex.exec(tabsMatch[1]))) {
    tabs.push({ label: m[1], content: m[2].trim() });
  }
  return tabs;
}

// === Dossier 解析（records stack） ===
function parseDossier(body) {
  const intro_html = extractIntroHtml(body);
  const tabs = extractTabs(body);
  const subcategories = tabs.map((tab) => {
    const groups = parseGroups(tab.content);
    return { label: tab.label, groups };
  });
  return { ...(intro_html ? { intro_html } : {}), subcategories };
}

function parseGroups(content) {
  // 用 ### 或 #### 切分群組
  const groupRegex = /^#{3,4}\s+\**(.+?)\**\s*$/gm;
  const groups = [];
  let lastIdx = 0;
  let lastLabel = null;
  const matches = [...content.matchAll(groupRegex)];

  for (let i = 0; i < matches.length; i++) {
    if (lastLabel !== null) {
      const sectionContent = content.slice(lastIdx, matches[i].index).trim();
      groups.push({ label: lastLabel, entries: parseEntries(sectionContent, lastLabel) });
    }
    lastLabel = matches[i][1].trim();
    lastIdx = matches[i].index + matches[i][0].length;
  }
  if (lastLabel !== null) {
    const sectionContent = content.slice(lastIdx).trim();
    groups.push({ label: lastLabel, entries: parseEntries(sectionContent, lastLabel) });
  }

  // 如果沒有 group heading，把整段當一個 group
  if (groups.length === 0 && content.trim()) {
    groups.push({ label: '', entries: parseEntries(content, '') });
  }

  return groups;
}

function parseEntries(text, groupLabel) {
  const entries = [];

  // 模式 A：列表項 "* 中文名 English ✮能力"（character_list 風格）
  const listItems = text.match(/^\*\s+.+$/gm);
  if (listItems) {
    for (const item of listItems) {
      const line = item.replace(/^\*\s+/, '').trim();

      // 解析各部分組成 content_html
      const titleMatch = line.match(/【(.+?)】/);
      const abilityMatch = line.match(/✮\s*(.+?)$/);
      const nameClean = line
        .replace(/【.+?】\s*/, '')
        .replace(/✮.*$/, '')
        .trim();

      const parts = [];
      if (titleMatch) parts.push(`【${titleMatch[1]}】`);
      if (abilityMatch) parts.push(`✮ ${abilityMatch[1].trim()}`);
      const content_html = parts.length > 0 ? `<p>${parts.join(' ')}</p>` : undefined;

      entries.push({ name: nameClean, ...(content_html ? { content_html } : {}) });
    }
    return entries;
  }

  // 模式 B：段落描述（hostile_creatures 風格 — group 標題即為名稱，後面是描述）
  const desc = text
    .replace(/^\*{3}\s*$/gm, '')
    .replace(/^\s*\n/gm, '')
    .trim();
  if (desc && !desc.startsWith('#')) {
    entries.push({ name: groupLabel, content_html: `<p>${desc}</p>` });
  }

  return entries;
}

// === Inversa 特殊解析（每個角色是 #### heading + 描述） ===
function parseInversa(body) {
  const intro_html = extractIntroHtml(body);
  const tabs = extractTabs(body);
  const subcategories = tabs.map((tab) => {
    const groups = [];
    const entryRegex = /^####\s+\**(.+?)\**\s*$/gm;
    const matches = [...tab.content.matchAll(entryRegex)];

    for (let i = 0; i < matches.length; i++) {
      const label = matches[i][1].trim();
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : tab.content.length;
      const sectionContent = tab.content.slice(start, end).trim();

      // 提取列表項作為 content_html
      const lines = [];
      const listItems = sectionContent.match(/^\*\s+.+$/gm);
      if (listItems) {
        for (const item of listItems) {
          lines.push(item.replace(/^\*\s+/, '').trim());
        }
      }

      // 解析「角色名 — [能力]」
      const nameAbility = label.match(/^(.+?)\s*—\s*(?:\\)?\[(.+?)\]$/);
      const name = nameAbility ? nameAbility[1].trim() : label;
      const parts = [];
      if (nameAbility) parts.push(`✮ ${nameAbility[2].trim()}`);
      if (lines.length > 0) parts.push(...lines.map(l => l));
      const content_html = parts.length > 0 ? parts.map(p => `<p>${p}</p>`).join('\n') : undefined;

      groups.push({ label: name, entries: [{ name, ...(content_html ? { content_html } : {}) }] });
    }

    return { label: tab.label, groups };
  });
  return { ...(intro_html ? { intro_html } : {}), subcategories };
}

// === Browser 解析（charateristics） ===
function parseBrowser(body) {
  const intro_html = extractIntroHtml(body);
  const profiles = [];

  // 提取 blockquote 區段標題
  const sectionTitleRegex = /^>\s*###\s+\**(.+?)\**\s*$/gm;
  const sectionTitles = [...body.matchAll(sectionTitleRegex)].map(m => m[1].trim());

  // 提取 <details> 區段
  const detailsRegex = /<details>\s*\n\s*<summary><strong>(.+?)<\/strong><\/summary>([\s\S]*?)<\/details>/g;
  let m;
  while ((m = detailsRegex.exec(body))) {
    const name = m[1].trim();
    const content = m[2].trim();

    // 檢查是否為佔位符
    if (content.length < 100 && !content.includes('###')) {
      profiles.push({ name, placeholder: true, sectionTitle: sectionTitles[0] || '' });
      continue;
    }

    const profile = { name };
    const sections = [];

    // 解析基本資料（key-value 短欄位）
    const basic = {};
    const basicFields = content.match(/\*\*(.+?):\*\*\s*(.+)/g);
    if (basicFields) {
      for (const field of basicFields) {
        const fm = field.match(/\*\*(.+?):\*\*\s*(.+)/);
        if (fm) basic[fm[1].trim()] = fm[2].trim();
      }
    }
    if (Object.keys(basic).length > 0) profile.basic = basic;

    // 解析各 ### 區段 → 轉為自定義 sections
    const sectionRegex = /###\s+\**(.+?)\**([\s\S]*?)(?=###|$)/g;
    let sm;
    while ((sm = sectionRegex.exec(content))) {
      const label = sm[1].trim();
      const sectionBody = sm[2].trim();
      if (!sectionBody) continue;

      // 轉為 HTML
      const htmlParts = [];
      const lines = sectionBody.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('* ')) {
          htmlParts.push(`<li>${trimmed.slice(2)}</li>`);
        } else if (trimmed.match(/^\*\*.+:\*\*/)) {
          const kvMatch = trimmed.match(/^\*\*(.+?):\*\*\s*(.+)/);
          if (kvMatch) htmlParts.push(`<p><strong>${kvMatch[1]}:</strong> ${kvMatch[2]}</p>`);
          else htmlParts.push(`<p>${trimmed}</p>`);
        } else {
          htmlParts.push(`<p>${trimmed}</p>`);
        }
      }
      // 把連續的 <li> 包成 <ul>
      let html = htmlParts.join('\n').replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
      if (html) sections.push({ label, content_html: html });
    }

    if (sections.length > 0) profile.sections = sections;
    profiles.push(profile);
  }

  return { ...(intro_html ? { intro_html } : {}), profiles };
}

// === Chrono 解析 ===
// icon → fieldDef id 對應表
const CHRONO_ICON_TO_DEF = { '☀': 'main', '🏞': 'regional', '👤': 'character' };
const CHRONO_DEFAULT_FIELD_DEFS = [
  { id: 'main', icon: '☀', label: '主線事件 / 核心敘事', style: 'flat' },
  { id: 'regional', icon: '🏞', label: '區域動態 / 地區歷史', style: 'grouped' },
  { id: 'character', icon: '👤', label: '角色關鍵點', style: 'flat' },
];

function parseChrono(body) {
  const intro_html = extractIntroHtml(body);
  const periods = [];
  const placeholders = [];
  // 收集所有出現的 fieldDef（從預設開始，遇到未知 icon 時追加）
  const fieldDefs = [...CHRONO_DEFAULT_FIELD_DEFS];
  const knownIcons = new Set(Object.keys(CHRONO_ICON_TO_DEF));

  // 提取 blockquote 佔位符
  const phRegex = /^>\s*###\s+\**(.+?)\**\s*$/gm;
  let phm;
  while ((phm = phRegex.exec(body))) {
    placeholders.push(phm[1].trim());
  }

  // 提取 <details> 時間段
  const detailsRegex = /<details>\s*\n\s*<summary><strong>(.+?)<\/strong><\/summary>([\s\S]*?)<\/details>/g;
  let m;
  while ((m = detailsRegex.exec(body))) {
    const year = m[1].trim();
    const content = m[2].trim();

    // 標題（#### 開頭，選填）
    const titleMatch = content.match(/^####\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].replace(/[「」]/g, '').trim() : undefined;

    // 解析時期與年份數字
    let era = 'ad', yearNum = 1;
    const preAdM = year.match(/AD前\s*(\d+)/);
    const faM = year.match(/FA\s*(\d+)/);
    const nwM = year.match(/NW\s*(\d+)/);
    const adM = year.match(/AD\s*(\d+)/);
    if (preAdM) { era = 'pre-ad'; yearNum = parseInt(preAdM[1]) || 1; }
    else if (faM) { era = 'fa'; yearNum = parseInt(faM[1]) || 1; }
    else if (nwM) { era = 'nw'; yearNum = parseInt(nwM[1]) || 1; }
    else if (adM) { era = 'ad'; yearNum = parseInt(adM[1]) || 1; }

    // 解析事件區段
    const fields = {};
    const sectionRegex = /\*\*([☀🏞👤◇].+?)\*\*/g;
    const sectionMatches = [...content.matchAll(sectionRegex)];

    for (let i = 0; i < sectionMatches.length; i++) {
      const fullLabel = sectionMatches[i][1].trim();
      const icon = fullLabel.match(/^[☀🏞👤◇]/)?.[0] || '·';
      const label = fullLabel.replace(/^[☀🏞👤◇]\s*/, '').trim();

      // 判斷 fieldDef id
      let defId = CHRONO_ICON_TO_DEF[icon];
      if (!defId) {
        // 未知 icon → 建立新 fieldDef
        defId = label.replace(/[\s/]/g, '_').toLowerCase();
        if (!knownIcons.has(icon)) {
          knownIcons.add(icon);
          fieldDefs.push({ id: defId, icon, label, style: 'flat' });
        }
      }

      const start = sectionMatches[i].index + sectionMatches[i][0].length;
      const end = i + 1 < sectionMatches.length ? sectionMatches[i + 1].index : content.length;
      const sectionContent = content.slice(start, end);

      // 提取事件列表
      const events = [];
      const eventItems = sectionContent.match(/^\*\s+(.+)$/gm);
      if (eventItems) {
        for (const ev of eventItems) events.push(ev.replace(/^\*\s+/, '').trim());
      }

      if (events.length > 0 || label) {
        const def = fieldDefs.find(d => d.id === defId);
        if (def && def.style === 'grouped') {
          // grouped 模式：MD 來源目前沒有區域分組，先放入「未分類」
          fields[defId] = { groups: [{ label: '未分類', items: events }] };
        } else {
          fields[defId] = { items: events };
        }
      }
    }

    periods.push({ era, yearNum, year, title, fields });
  }

  // 佔位符併入 intro_html
  const phParts = placeholders.map(ph => `<p><em>${ph}</em></p>`).join('\n');
  const combinedIntro = [intro_html, phParts].filter(Boolean).join('\n') || undefined;
  return { ...(combinedIntro ? { intro_html: combinedIntro } : {}), fieldDefs, periods };
}

// === Diff 解析（explainations — 術語定義） ===
function parseDiffExplanations(body) {
  const intro_html = extractIntroHtml(body);
  const tabs = extractTabs(body);
  const subcategories = tabs.map((tab) => {
    const sections = [];
    // 解析 ### group headings
    const groupRegex = /^###\s+\**(.+?)\**\s*$/gm;
    const matches = [...tab.content.matchAll(groupRegex)];

    for (let i = 0; i < matches.length; i++) {
      const label = matches[i][1].trim();
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : tab.content.length;
      const sectionContent = tab.content.slice(start, end).trim();

      const entries = [];
      // 解析 **term -** definition 格式
      const termRegex = /\*\*(.+?)\s*-\*\*\s*(.+)/g;
      let tm;
      while ((tm = termRegex.exec(sectionContent))) {
        entries.push({ term: tm[1].trim(), values: [tm[2].trim()] });
      }

      // 如果沒有 term-definition 格式，嘗試作為純文字
      if (entries.length === 0 && sectionContent.trim()) {
        const plainText = sectionContent.replace(/^\*{3}\s*$/gm, '').replace(/^✫\s*/gm, '').trim();
        if (plainText) {
          entries.push({ term: plainText, values: [] });
        }
      }

      sections.push({ label, entries });
    }

    // 無 group heading 的情況
    if (sections.length === 0 && tab.content.trim()) {
      const entries = [];
      const termRegex = /\*\*(.+?)\s*-\*\*\s*(.+)/g;
      let tm;
      while ((tm = termRegex.exec(tab.content))) {
        entries.push({ term: tm[1].trim(), values: [tm[2].trim()] });
      }
      if (entries.length > 0) {
        sections.push({ label: '', entries });
      }
    }

    return { label: tab.label, sections };
  });
  return { ...(intro_html ? { intro_html } : {}), subcategories };
}

// === Diff 解析（multilingual — 多欄對照表） ===
function parseDiffMultilingual(body) {
  const intro_html = extractIntroHtml(body);
  // 這裡沒有 tabs，直接解析 h3 + table
  const subcategories = [];
  const sectionRegex = /###\s+(.+)/g;
  const tableRegex = /\|(.+)\|\s*\n\|[-\s|]+\|\s*\n((?:\|.+\|\s*\n?)+)/g;
  const matches = [...body.matchAll(sectionRegex)];

  for (let i = 0; i < matches.length; i++) {
    const label = matches[i][1].replace(/\*\*/g, '').trim();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    const sectionContent = body.slice(start, end);

    // 解析 table
    const tMatch = tableRegex.exec(sectionContent);
    tableRegex.lastIndex = 0; // reset
    const tMatch2 = sectionContent.match(/\|(.+)\|\s*\n\|[-\s|]+\|\s*\n((?:\|.+\|\s*\n?)+)/);

    const entries = [];
    if (tMatch2) {
      const rows = tMatch2[2].trim().split('\n');
      for (const row of rows) {
        const cells = row.split('|').filter(c => c.trim()).map(c => c.trim());
        // 跳過分隔行
        if (cells.every(c => /^[-—]+$/.test(c))) continue;
        if (cells.length >= 2) {
          entries.push({ term: cells[0], values: cells.slice(1) });
        }
      }
    }

    if (entries.length > 0) {
      subcategories.push({ label, sections: [{ label: '', entries }] });
    }
  }

  return { ...(intro_html ? { intro_html } : {}), subcategories };
}

// === 頁面產出 ===
function contentHash(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

function buildPage(stackKey, fileDef, parsed, md) {
  const stack = STACKS[stackKey];
  const slug = fileDef.src
    .replace(/^concepts\//, '')
    .replace(/\.md$/, '')
    .replace(/\/README$/, '');
  const id = `concepts/${slug}`;

  // intro_html 從 parsed 中提取出來，放到獨立的 rich_text block
  const { intro_html, ...structData } = parsed;

  const contentBlocks = [];
  if (intro_html) {
    contentBlocks.push({ id: 'intro', type: 'rich_text', content: intro_html });
  }
  contentBlocks.push({
    id: 'content',
    type: stack.style === 'dossier' ? 'dossier'
        : stack.style === 'browser' ? 'browser_profile'
        : stack.style === 'chrono' ? 'chronograph'
        : 'diff_table',
    content: JSON.stringify(structData),
  });

  const metadata = {
    type_group: fileDef.typeGroup,
    era: fileDef.era,
    stack_style: stack.style,
  };
  if (md.frontmatter.icon) metadata.icon = md.frontmatter.icon;
  if (md.frontmatter.description) metadata.description = md.frontmatter.description;
  if (md.frontmatter.hidden === true) metadata.hidden = true;

  return {
    id,
    area: 'concepts',
    title: md.title || fileDef.typeGroup,
    slug,
    sortOrder: 0,
    content: contentBlocks,
    sourceFile: fileDef.src,
    contentHash: contentHash(JSON.stringify(structData)),
    parentId: `concepts/${stack.slug}`,
    depth: 2,
    pageType: 'type',
    metadata,
  };
}

// === Dossier 多 variant 頁面組裝 ===
function buildDossierPage(stackKey, typeDef) {
  const stack = STACKS[stackKey];
  const slug = `${stack.slug}/${typeDef.slug}`;
  const id = `concepts/${slug}`;

  const variants = [];
  let firstIntroHtml = '';
  let firstMd = null;
  let firstTitle = '';
  const sources = [];

  for (const v of typeDef.variants) {
    const md = readMd(v.src);
    if (!md) {
      console.log(`  ⚠ 跳過 variant ${v.id}（檔案不存在）: ${v.src}`);
      continue;
    }
    if (!firstMd) {
      firstMd = md;
      firstTitle = md.title || typeDef.typeGroup;
    }
    sources.push(v.src);

    const parsed = typeDef.typeGroup === 'inversa'
      ? parseInversa(md.body)
      : parseDossier(md.body);
    if (!parsed) continue;

    if (parsed.intro_html && !firstIntroHtml) firstIntroHtml = parsed.intro_html;

    variants.push({
      id: v.id,
      label: v.label || v.id.toUpperCase(),
      subcategories: parsed.subcategories || [],
    });
  }

  if (variants.length === 0) return null;

  const structData = { variants };
  const contentBlocks = [];
  if (firstIntroHtml) {
    contentBlocks.push({ id: 'intro', type: 'rich_text', content: firstIntroHtml });
  }
  contentBlocks.push({ id: 'content', type: 'dossier', content: JSON.stringify(structData) });

  const metadata = {
    type_group: typeDef.typeGroup,
    stack_style: 'dossier',
  };
  if (firstMd?.frontmatter?.icon) metadata.icon = firstMd.frontmatter.icon;
  if (firstMd?.frontmatter?.description) metadata.description = firstMd.frontmatter.description;
  if (firstMd?.frontmatter?.hidden === true) metadata.hidden = true;

  // 標題：用 typeDef.title 優先（如有），否則用第一個 variant 的標題去掉 (X) 後綴
  const titleRaw = typeDef.title || firstTitle;
  const title = titleRaw.replace(/\s*[（(][A-Za-z]+[)）]\s*$/, '').trim() || titleRaw;

  return {
    id,
    area: 'concepts',
    title,
    slug,
    sortOrder: 0,
    content: contentBlocks,
    sourceFile: sources.join(','),
    contentHash: contentHash(JSON.stringify(structData)),
    parentId: `concepts/${stack.slug}`,
    depth: 2,
    pageType: 'type',
    metadata,
    _variantCount: variants.length,
    _entryCount: variants.reduce((s, v) => s + v.subcategories.reduce((g, sc) => g + sc.groups.reduce((e, gr) => e + gr.entries.length, 0), 0), 0),
  };
}

// === 匯入 ===
async function importPages(pages) {
  console.log(`\n📤 匯入 ${pages.length} 個頁面...\n`);

  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

  const payload = { pages };
  try {
    const res = await fetch(`${API_BASE}/api/content/sync/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.ok) {
      console.log(`✅ 新增: ${json.data.imported}, 更新: ${json.data.updated}, 跳過: ${json.data.skipped}`);
    } else {
      console.error(`❌ API 錯誤: ${json.error}`);
    }
  } catch (e) {
    console.error(`❌ 連線錯誤: ${e.message}`);
  }
}

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

// === 首頁 ===
async function createHomepage() {
  console.log('📄 建立 Concepts 首頁...');

  const serverMd = readMd('concepts/server.md');
  const narrativeHtml = serverMd
    ? serverMd.body
        .replace(/^\s*\n/gm, '')
        .replace(/\*{3}/g, '<hr>')
        .replace(/<details>[\s\S]*?<\/details>/g, '')
        .split('\n')
        .filter(l => l.trim())
        .map(l => `<p>${l.trim()}</p>`)
        .join('\n')
    : '';

  const blocks = [
    {
      id: 'c1', type: 'zone-header',
      content: JSON.stringify({ title: '概念調整房', subtitle: '世界觀、設定文件。一切關於這個世界「為什麼是這樣」的解答都在這裡，如果你找得到的話。' }),
      attrs: {},
    },
    {
      id: 'c2', type: 'uep-dialogue',
      content: JSON.stringify([
        { text: '嘿~這裡是「概念調整房」! 有點複雜對吧? (｡•̀ᴗ-)✧', side: 'left', effects: [] },
        { text: '簡單來說就是...這邊存放著所有關於這個世界的「設定」和「規則」! 像是角色是怎麼運作的之類的~', side: 'right', effects: ['shimmer'] },
      ]),
      attrs: {},
    },
    {
      id: 'c-rich', type: 'rich-text',
      content: JSON.stringify({ html: narrativeHtml }),
      attrs: {},
    },
    {
      id: 'c3', type: 'terminal-module-table',
      content: JSON.stringify({
        headerLabel: '// concepts.modules — listing',
        modules: [
          { id: '01', name: '永續紀錄主機', en: 'persistent_log_server', state: 'sync', records: 124 },
          { id: '02', name: '個性瀏覽器', en: 'identity_browser', state: 'sync', records: 38 },
          { id: '03', name: '原質震盪時鐘', en: 'essence_oscillator', state: 'sync', records: 9 },
          { id: '04', name: '認知對照平台', en: 'cognition_compare', state: 'idle', records: 14 },
        ],
      }),
      attrs: {},
    },
  ];

  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

  const res = await fetch(`${API_BASE}/api/content/concepts/homepage`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ title: '概念調整房 首頁', content: blocks, pageType: 'homepage', parentId: null, depth: 0 }),
  });
  const json = await res.json();
  console.log(json.ok ? `  ✅ 首頁已建立` : `  ❌ ${json.error}`);
}

// === Stack 頁面 ===
async function createStackPages() {
  console.log('\n📦 建立 Stack 頁面...');
  const pages = [];
  const stackReadmes = {
    records: 'concepts/server/records/README.md',
    browser: 'concepts/server/browser/README.md',
    oscillator: 'concepts/server/time_logs/README.md',
    compare: 'concepts/server/translation/README.md',
  };

  let sortOrder = 1;
  for (const [key, stack] of Object.entries(STACKS)) {
    const md = readMd(stackReadmes[key]);
    const body = md?.body || '';
    // 提取純文字內容（去掉 hints 和結構語法）
    const prose = body
      .replace(/\{%[\s\S]*?%\}/g, '')
      .replace(/^\s*\n/gm, '')
      .trim();

    pages.push({
      id: `concepts/${stack.slug}`,
      area: 'concepts',
      title: md?.title || stack.label,
      slug: stack.slug,
      sortOrder: sortOrder++,
      content: [{ id: 'content', type: 'rich_text', content: prose }],
      sourceFile: stackReadmes[key],
      contentHash: contentHash(prose),
      parentId: 'concepts/homepage',
      depth: 1,
      pageType: 'stack',
      metadata: {
        icon: md?.frontmatter?.icon || '',
        description: md?.frontmatter?.description || '',
        stack_style: stack.style,
      },
    });
  }

  await importPages(pages);
}

// === 主程式 ===
async function main() {
  if (CLEAN) await cleanConcepts();

  await createHomepage();
  await createStackPages();

  // 解析各 stack 的內容頁
  const pages = [];
  let sortOrder = 10;

  for (const [stackKey, stack] of Object.entries(STACKS)) {
    console.log(`\n📂 解析 ${stack.label}...`);

    // Dossier (records) 走多 variant 流程：每個 type 一頁，含多 variant
    if (stack.style === 'dossier' && Array.isArray(stack.types)) {
      for (const typeDef of stack.types) {
        const page = buildDossierPage(stackKey, typeDef);
        if (!page) {
          console.log(`  ⚠ 跳過 type（無有效 variant）: ${typeDef.typeGroup}`);
          continue;
        }
        page.sortOrder = sortOrder++;
        const variantCount = page._variantCount;
        const entryCount = page._entryCount;
        delete page._variantCount; delete page._entryCount;
        pages.push(page);
        console.log(`  ✓ ${page.title} → ${variantCount} variant(s), ${entryCount} 筆條目`);
      }
      continue;
    }

    // 其他 stack 維持單一檔案結構
    for (const fileDef of stack.files) {
      const md = readMd(fileDef.src);
      if (!md) {
        console.log(`  ⚠ 跳過（不存在）: ${fileDef.src}`);
        continue;
      }

      let parsed;

      if (stack.style === 'browser') {
        parsed = parseBrowser(md.body);
      } else if (stack.style === 'chrono') {
        parsed = parseChrono(md.body);
      } else if (stack.style === 'diff') {
        if (fileDef.typeGroup === 'multilingual') {
          parsed = parseDiffMultilingual(md.body);
        } else {
          parsed = parseDiffExplanations(md.body);
        }
      }

      if (!parsed) {
        console.log(`  ⚠ 無法解析: ${fileDef.src}`);
        continue;
      }

      const page = buildPage(stackKey, fileDef, parsed, md);
      page.sortOrder = sortOrder++;
      pages.push(page);

      // 摘要
      const itemCount =
        parsed.subcategories?.reduce((s, sc) => s + (sc.groups?.reduce((g, gr) => g + (gr.entries?.length || 0), 0) || sc.sections?.reduce((g, sec) => g + (sec.entries?.length || 0), 0) || 0), 0) ||
        parsed.profiles?.length ||
        parsed.periods?.length ||
        0;
      console.log(`  ✓ ${md.title || fileDef.typeGroup} → ${itemCount} 筆結構化資料`);
    }
  }

  if (pages.length > 0) {
    await importPages(pages);
  }

  console.log(`\n⬡ 遷移完成`);
}

main().catch(console.error);
