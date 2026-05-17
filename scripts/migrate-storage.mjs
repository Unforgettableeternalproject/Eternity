/**
 * 遷移腳本：將 Storage 區域的內容匯入到 Content API (D1)
 * 來源：U.E.P-s-Imaginary-Space/storage/
 *
 * 使用方式：
 *   node scripts/migrate-storage.mjs [--remote] [--clean]
 *
 * --remote: 匯入到遠端 Worker（預設為 localhost:8788）
 * --clean:  先清除現有 storage 資料再匯入
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const USE_REMOTE = process.argv.includes('--remote');
const CLEAN = process.argv.includes('--clean');
const API_BASE = USE_REMOTE
  ? 'https://eternity-content-api.ptyc4076.workers.dev'
  : 'http://localhost:8788';

const CONTENT_ROOT = join(
  import.meta.dirname,
  '..',
  '..',
  'U.E.P-s-Imaginary-Space',
  'storage'
);

console.log(`\n🗄️  Storage 內容遷移工具`);
console.log(`   來源: ${CONTENT_ROOT}`);
console.log(`   目標: ${API_BASE}`);
console.log(`   清除模式: ${CLEAN ? '是' : '否'}\n`);

function hash(content) {
  return createHash('md5').update(JSON.stringify(content)).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════
// Markdown → HTML 轉換（同 migrate-history.mjs）
// ═══════════════════════════════════════════════════════════════════
function readMd(relativePath) {
  const fullPath = join(CONTENT_ROOT, relativePath);
  if (!existsSync(fullPath)) {
    console.warn(`   ⚠️ 找不到: ${fullPath}`);
    return { html: '', frontmatter: {} };
  }
  const raw = readFileSync(fullPath, 'utf-8');
  return mdToHtml(raw);
}

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
        htmlParts.push(`<pre><code>${escapeHtml(codeContent.trim())}</code></pre>`);
        codeContent = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) { codeContent += line + '\n'; continue; }

    // GitBook 語法行 — 保留
    if (trimmed.match(/^\{%\s*(hint|endhint|tabs|endtabs|tab|endtab|content-ref|endcontent-ref|stepper|endstepper|step|endstep|details|enddetails|file|endfile)/)) {
      htmlParts.push(line);
      continue;
    }

    // HTML 區塊
    if (trimmed.startsWith('<table') || trimmed.startsWith('<div') || trimmed.startsWith('<img')) {
      htmlParts.push(line);
      continue;
    }

    // Markdown 表格
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (trimmed.match(/^\|[\s\-:]+\|$/)) continue;
      if (!inTable) { inTable = true; tableRows = []; }
      const cells = trimmed.split('|').filter(c => c !== '').map(c => c.trim());
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
      htmlParts.push(`<h${level}>${processInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (trimmed.startsWith('> ')) {
      htmlParts.push(`<blockquote><p>${processInline(trimmed.slice(2))}</p></blockquote>`);
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
  // content-ref → 移除（clearing 頁面的子頁面連結由 tree 管理）
  html = html.replace(/\{%\s*content-ref\s+url="[^"]*"\s*%\}\s*\n?[\s\S]*?\n?\{%\s*endcontent-ref\s*%\}/g, '');
  // stepper / step
  html = html.replace(/\{%\s*stepper\s*%\}\s*\n?/g, '');
  html = html.replace(/\{%\s*endstepper\s*%\}\s*\n?/g, '');
  html = html.replace(/\{%\s*step\s*%\}\s*\n?/g, '');
  html = html.replace(/\{%\s*endstep\s*%\}\s*\n?/g, '');
  // details / summary
  html = html.replace(/<details>\s*\n?\s*<summary>([\s\S]*?)<\/summary>\s*\n?([\s\S]*?)<\/details>/g,
    (_, summary, content) => `<div class="details"><p><strong>${summary.replace(/<\/?strong>/g, '')}</strong></p>${content.trim()}</div>`
  );
  // hints
  html = html.replace(
    /\{%\s*hint\s+style="(\w+)"\s*%\}\s*\n?([\s\S]*?)\n?\{%\s*endhint\s*%\}/g,
    (_, style, content) => {
      const cleaned = content.replace(/<\/?p>/g, '').trim();
      return `<div class="hint hint-${style}"><p>${cleaned}</p></div>`;
    }
  );
  return html;
}

function buildTable(rows) {
  if (!rows.length) return '';
  const header = rows[0];
  const body = rows.slice(1);
  const ths = header.map(h => `<th>${processInline(h)}</th>`).join('');
  const trs = body.map(row => `<tr>${row.map(c => `<td>${processInline(c)}</td>`).join('')}</tr>`).join('\n');
  return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function processInline(text) {
  text = text.replace(/<br\s*\/?>\s*$/, '');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  text = text.replace(/`(.+?)`/g, '<code>$1</code>');
  text = text.replace(/<mark\s+style="color:([^"]+)">/g, '<mark style="color:$1">');
  text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/!\[(.+?)\]\((.+?)\)/g, '<img src="$2" alt="$1" />');
  // 處理 GitBook 的 &#x20; (空格)
  text = text.replace(/&#x20;/g, ' ');
  // 處理轉義反斜線
  text = text.replace(/\\(.)/g, '$1');
  return text;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// ═══════════════════════════════════════════════════════════════════
// 讀取源頭檔案並組裝匯入資料
// ═══════════════════════════════════════════════════════════════════

// Homepage: storage/desk.md
const deskMd = readMd('desk.md');

// Clearing: boxes → storage/boxes.md
const boxesMd = readMd('boxes.md');

// Clearing: changelog → storage/desk/changelog/README.md
const changelogMd = readMd(join('desk', 'changelog', 'README.md'));

// Clearing: extras → storage/desk/extras/README.md
const extrasMd = readMd(join('desk', 'extras', 'README.md'));

// Stuff: boxes/b-1 → storage/desk/boxes/b-1.md
const b1Md = readMd(join('desk', 'boxes', 'b-1.md'));

// Stuff: changelog/log-1 → storage/desk/changelog/log-1.md
const log1Md = readMd(join('desk', 'changelog', 'log-1.md'));

// Stuff: extras/void-1 → storage/desk/extras/void-1.md
const void1Md = readMd(join('desk', 'extras', 'void-1.md'));

// ═══════════════════════════════════════════════════════════════════
// Metadata 定義
// ═══════════════════════════════════════════════════════════════════
const boxesMetadata = {
  icon: '◰',
  style: 'dialogue',
  labelEn: 'PLAYGROUND',
  description: boxesMd.frontmatter.description || '',
  intro: '從外面看起來頂多就只有四五十個箱子，沒想到一踏進入口卻是一整座完整的遊樂場。看起來在 U.E.P 的世界中甚麼都是可能的 —— 而且她有時候會在這裡晃，所以你也許可以撿到一段對話。',
  uepNote: "哈囉! 你來這裡找我了嗎? 雖然我也不知道我自己什麼時候會在這裡 (>'-'<)",
  motto: 'a playground for stray dialogues. — storage/boxes',
};

const changelogMetadata = {
  icon: '☰',
  style: 'log',
  labelEn: 'CHANGELOG',
  description: changelogMd.frontmatter.description || '',
  intro: '桌上的紙條都是某人的紀錄，感覺不像是 U.E.P 自己寫的。算是小小閱讀了一下，很多裡面記載的內容都跟這個世界的其他地區相關 —— 比起說是紀錄，這些文件更像是某種更新公告。',
  uepNote: '咦? 這些不是我寫的! 但我也看不出來是誰寫的 (・ω・ )...',
  motto: 'someone keeps leaving notes. — storage/changelog',
};

const extrasMetadata = {
  icon: '◐',
  style: 'blog',
  labelEn: 'EXTRAS',
  description: extrasMd.frontmatter.description || '',
  intro: '不只從一扇窗傳來 —— 這裡的每一處窗戶都可以聽到一種來自異域的空靈聲。冒著精神被汙染的風險，你靠近了那些聲音的源頭，並把聽到的句子一字一句記下來。這裡放的是這些字條的整理。',
  uepNote: '你可以靠近那扇窗看看! 不過如果聽到什麼會讓你不舒服的就趕快離開喔 (•́ω•̀ )ﾉ',
  motto: 'voices from outside the room. — storage/extras',
};

// ═══════════════════════════════════════════════════════════════════
// Homepage 結構化 blocks（與其他 zone 的 homepage 格式一致）
// 從 desk.md 解析出 zone-header、uep-dialogue、rich-text、sticky-note
// ═══════════════════════════════════════════════════════════════════
function buildHomepageBlocks(md) {
  // desk.md 的 HTML 已去掉 h1，內容有：
  // 1. 敘事段落（旁白文字）
  // 2. <mark style="color:yellow;">...</mark> 包裹的 U.E.P 對話
  // 3. <blockquote> 裡的便條紙
  // 4. hr 分隔後的下半段
  const blocks = [];

  // zone-header
  blocks.push({
    id: 'sh1',
    type: 'zone-header',
    content: JSON.stringify({
      title: '某人的置物空間',
      subtitle: md.frontmatter.description || '再次地回到這間奇怪的房間，你發現有張書桌燈還亮著',
    }),
  });

  // 從 HTML 中提取 U.E.P 對話（<mark style="color:yellow;">...</mark>）和旁白
  const html = md.html;
  const parts = html.split('<hr>');
  const beforeHr = parts[0] || '';
  const afterHr = parts.slice(1).join('<hr>') || '';

  // 提取 <blockquote> 中的便條紙（U.E.P 留言）
  const stickyMatch = afterHr.match(/<blockquote>([\s\S]*?)<\/blockquote>/);
  let stickyText = '';
  if (stickyMatch) {
    stickyText = stickyMatch[1]
      .replace(/<\/?p>/g, '')
      .replace(/<mark[^>]*>/g, '')
      .replace(/<\/mark>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 提取 U.E.P 對話行
  const uepRegex = /<p><mark style="color:yellow;">([\s\S]*?)<\/mark><\/p>/g;
  const dialogues = [];
  let m;
  while ((m = uepRegex.exec(beforeHr)) !== null) {
    dialogues.push({
      text: m[1].replace(/<\/?mark[^>]*>/g, '').trim(),
      side: dialogues.length % 2 === 0 ? 'left' : 'right',
      effects: [],
    });
  }

  // 從 afterHr 也提取對話
  const uepRegex2 = /<p><mark style="color:yellow;">([\s\S]*?)<\/mark><\/p>/g;
  while ((m = uepRegex2.exec(afterHr)) !== null) {
    dialogues.push({
      text: m[1].replace(/<\/?mark[^>]*>/g, '').trim(),
      side: dialogues.length % 2 === 0 ? 'left' : 'right',
      effects: [],
    });
  }

  // 旁白文字：移除 U.E.P 對話和 blockquote，保留純敘事
  let narrativeHtml = beforeHr
    .replace(/<p><mark style="color:yellow;">[\s\S]*?<\/mark><\/p>/g, '')
    .trim();

  // 富文本 block：上半段敘事
  if (narrativeHtml) {
    blocks.push({
      id: 'sh2',
      type: 'rich-text',
      content: JSON.stringify({ html: narrativeHtml }),
    });
  }

  // UEP 對話（從 blockquote 中的便條紙 + mark 對話合併）
  const allDialogues = [];
  if (stickyText) {
    allDialogues.push({ text: stickyText, side: 'left', effects: [] });
  }
  allDialogues.push(...dialogues);
  if (allDialogues.length > 0) {
    blocks.push({
      id: 'sh3',
      type: 'uep-dialogue',
      content: JSON.stringify(allDialogues.slice(0, 4)),
    });
  }

  // 下半段敘事（hr 之後的部分，去掉 blockquote 和 content-ref 和 U.E.P 對話）
  let afterNarrative = afterHr
    .replace(/<blockquote>[\s\S]*?<\/blockquote>/g, '')
    .replace(/<p><mark style="color:yellow;">[\s\S]*?<\/mark><\/p>/g, '')
    .trim();

  if (afterNarrative) {
    blocks.push({
      id: 'sh4',
      type: 'rich-text',
      content: JSON.stringify({ html: afterNarrative }),
    });
  }

  // Storage Room Map 導航（三個 clearing 區域）
  blocks.push({
    id: 'sh5',
    type: 'storage-room-map',
    content: JSON.stringify({
      areas: [
        {
          icon: '◰',
          name: '箱子堆成的遊樂場',
          label: 'PLAYGROUND',
          hint: '跟 U.E.P 的對話',
          slug: 'boxes',
        },
        {
          icon: '☰',
          name: '零散的紀錄',
          label: 'CHANGELOG',
          hint: '桌上的更新公告',
          slug: 'changelog',
        },
        {
          icon: '◐',
          name: '外界的言語',
          label: 'EXTRAS',
          hint: '窗邊的聲音',
          slug: 'extras',
        },
      ],
    }),
  });

  return blocks;
}

const homepageContent = buildHomepageBlocks(deskMd);

// ═══════════════════════════════════════════════════════════════════
// 組裝匯入資料
// ═══════════════════════════════════════════════════════════════════
const pages = [
  // Homepage
  {
    id: 'storage/homepage',
    area: 'storage',
    title: '某人的置物空間',
    slug: 'homepage',
    sortOrder: 0,
    content: homepageContent,
    sourceFile: 'storage/desk.md',
    contentHash: hash(JSON.stringify(homepageContent)),
    parentId: null,
    depth: 0,
    pageType: 'homepage',
    metadata: {
      icon: deskMd.frontmatter.icon || '',
      description: deskMd.frontmatter.description || '',
    },
  },
  // Clearing: boxes
  {
    id: 'storage/boxes',
    area: 'storage',
    title: '箱子堆成的遊樂場',
    slug: 'boxes',
    sortOrder: 1,
    content: [{ id: 'content', type: 'rich_text', content: boxesMd.html }],
    sourceFile: 'storage/boxes.md',
    contentHash: hash(boxesMd.html),
    parentId: 'storage/homepage',
    depth: 1,
    pageType: 'clearing',
    metadata: boxesMetadata,
  },
  {
    id: 'storage/boxes/b-1',
    area: 'storage',
    title: '與 U.E.P 的對話-1',
    slug: 'boxes/b-1',
    sortOrder: 1,
    content: [{ id: 'content', type: 'rich_text', content: b1Md.html }],
    sourceFile: 'storage/desk/boxes/b-1.md',
    contentHash: hash(b1Md.html),
    parentId: 'storage/boxes',
    depth: 2,
    pageType: 'stuff',
    metadata: {
      scene: '紙板地鐵站 · 五號車廂',
      when: '紙箱底層的某個雨天',
      hint: b1Md.frontmatter.description || '',
      date: '?? / 04 / ??',
      tags: ['對話', '地鐵站', '存在性'],
    },
  },
  {
    id: 'storage/boxes/b-2',
    area: 'storage',
    title: '與 U.E.P 的對話-2',
    slug: 'boxes/b-2',
    sortOrder: 2,
    content: [],
    sourceFile: null,
    contentHash: hash([]),
    parentId: 'storage/boxes',
    depth: 2,
    pageType: 'stuff',
    metadata: { locked: true, hint: '下一次的偶遇還沒有發生。', date: '——' },
  },
  // Clearing: changelog
  {
    id: 'storage/changelog',
    area: 'storage',
    title: '零散的紀錄',
    slug: 'changelog',
    sortOrder: 2,
    content: [{ id: 'content', type: 'rich_text', content: changelogMd.html }],
    sourceFile: 'storage/desk/changelog/README.md',
    contentHash: hash(changelogMd.html),
    parentId: 'storage/homepage',
    depth: 1,
    pageType: 'clearing',
    metadata: changelogMetadata,
  },
  {
    id: 'storage/changelog/log-1',
    area: 'storage',
    title: '邊際世界觀測更新-??/04/??',
    slug: 'changelog/log-1',
    sortOrder: 1,
    content: [{ id: 'items', type: 'log_items', content: JSON.stringify([
      { id: 'li-1', type: 'zone', subject: '歷史典藏庫', text: '這裡的紀錄基本上無限多，空間也會隨著紀錄的數量擴展，為了方便管理，有關◼︎◼︎◼︎◼︎◼︎◼︎的敘述都已經被分類完畢，只是維護的部分還沒做完。', state: 'wip' },
      { id: 'li-2', type: 'zone', subject: '三向通道', text: '歷史的分歧地點，三條路線代表著三個◼︎◼︎◼︎◼︎◼︎◼︎，每個通道之內都有多個區間，每個區間都會呈現屬於他們內部歷史的部分面貌，然而某些未歸類者也有可能穿梭在不同的區間當中，此區域當前仍然在維修階段。', state: 'wip' },
      { id: 'li-3', type: 'zone', subject: '回音蒐藏間', text: '非常吵雜的空間，由各式回聲佔據，它們各自帶有一段「某事的記憶」，並且有著自主分群的習性，會去排斥異類並吸引同類。', state: 'ok' },
      { id: 'li-4', type: 'zone', subject: '空白廣場', text: '回聲的主要集聚地，在這裡能夠一次觀測到每一種回聲，也可以很清楚的看見它們所形成的「簇」，主要是有對於一個地區、一名人物、一段故事的記憶，但有時也會出現某些事件的記憶，粗略估計是由主界的事件進行干涉所導致的。', state: 'ok' },
      { id: 'li-5', type: 'zone', subject: '幻影重現室', text: '相較於其他地區，這裡更像是一個類似劇場的存在，所有在此處的幻影都是舞台中的角色，他們映照著真實存在之人的外表與內在。', state: 'ok' },
      { id: 'li-6', type: 'zone', subject: '鏡像十字路口', text: '這裡是單行道，一定進到這個地區就無法回到原來的幻影重現室，取而代之的四個出口都會導向到不同的子區塊，分別有不同形態的幻影存在，每個區塊都有著一個特性，也就是那些區塊中的幻影都會隨機的出現與消失，難以預測。', state: 'ok' },
      { id: 'li-7', type: 'zone', subject: '概念調整房', text: '用以存放世界上所有原質與概念的區塊，內部無時無刻不在進行複雜的運算，碰撞、分離出嶄新的概念，並將其運用在各個相依世界當中。', state: 'ok' },
      { id: 'li-8', type: 'zone', subject: '伺服器內部', text: '顧名思義就是概念調整房的內部伺服器，同時在進行著運算、紀錄與分析，並由各個子區塊去分開負責不同種類的概念操作，也是整個邊際世界當中最為關鍵的地區，由於世界更迭的權限並沒有額外限制，安全漏洞的部分也在維護的行程中。', state: 'ok' },
      { id: 'li-9', type: 'zone', subject: '外部基軸大廳', text: '運用修改過的基軸技術去建立的多項通道，能夠使實體在多個世界中穿梭，然而並不會實際傳輸物質，若是擁有血肉之軀的使用者僅有意識會被傳輸。傳輸所用的門以光柱形式呈現。', state: 'ok' },
      { id: 'li-10', type: 'zone', subject: '此處', text: '純粹就只是我的房間，此處位於邊際世界的裂縫當中，因此在任何層面上都是邊際世界裡最為安全之處，我們避免提及任何的危險性存在。', state: 'sealed' },
    ]) }],
    sourceFile: 'storage/desk/changelog/log-1.md',
    contentHash: hash('log-items-v2'),
    parentId: 'storage/changelog',
    depth: 2,
    pageType: 'stuff',
    metadata: {
      hint: log1Md.frontmatter.description || '',
      date: '?? / 04 / ??',
      version: '0.4.??',
      author: '◼︎◼︎◼︎◼︎◼︎◼︎',
      tags: ['全區段', '維護中'],
    },
  },
  {
    id: 'storage/changelog/log-2',
    area: 'storage',
    title: '邊際世界觀測更新-??/??/??',
    slug: 'changelog/log-2',
    sortOrder: 2,
    content: [],
    sourceFile: null,
    contentHash: hash([]),
    parentId: 'storage/changelog',
    depth: 2,
    pageType: 'stuff',
    metadata: { locked: true, hint: '尚未被擺上桌', date: '——' },
  },
  // Clearing: extras
  {
    id: 'storage/extras',
    area: 'storage',
    title: '外界的言語',
    slug: 'extras',
    sortOrder: 3,
    content: [{ id: 'content', type: 'rich_text', content: extrasMd.html }],
    sourceFile: 'storage/desk/extras/README.md',
    contentHash: hash(extrasMd.html),
    parentId: 'storage/homepage',
    depth: 1,
    pageType: 'clearing',
    metadata: extrasMetadata,
  },
  {
    id: 'storage/extras/void-1',
    area: 'storage',
    title: '虛空之聲-1',
    slug: 'extras/void-1',
    sortOrder: 1,
    content: [{ id: 'content', type: 'rich_text', content: void1Md.html }],
    sourceFile: 'storage/desk/extras/void-1.md',
    contentHash: hash(void1Md.html),
    parentId: 'storage/extras',
    depth: 2,
    pageType: 'stuff',
    metadata: {
      hint: void1Md.frontmatter.description || '',
      date: '?? / ?? / ??',
      mood: '反思',
      wordCount: void1Md.html.replace(/<[^>]+>/g, '').length,
      tags: ['敘事', '創作', '生活'],
    },
  },
  {
    id: 'storage/extras/void-2',
    area: 'storage',
    title: '虛空之聲-2',
    slug: 'extras/void-2',
    sortOrder: 2,
    content: [],
    sourceFile: null,
    contentHash: hash([]),
    parentId: 'storage/extras',
    depth: 2,
    pageType: 'stuff',
    metadata: { locked: true, hint: '草稿狀態 · 還沒組裝完', date: '——' },
  },
];

// ═══════════════════════════════════════════════════════════════════
// 執行匯入
// ═══════════════════════════════════════════════════════════════════
async function cleanStorage() {
  console.log('🧹 清除 storage 區域現有資料...');
  try {
    const res = await fetch(`${API_BASE}/api/content/storage`);
    const json = await res.json();
    if (json.ok && json.data) {
      for (const page of json.data) {
        await fetch(`${API_BASE}/api/content/${page.id}`, { method: 'DELETE' });
      }
      console.log(`   ✓ 已清除 ${json.data.length} 筆`);
    }
  } catch (e) {
    console.log(`   ⚠️ 清除時發生錯誤: ${e.message}（可能沒有資料）`);
  }
}

async function importStorage() {
  console.log('\n📋 匯入結構：');
  const typeIcons = { homepage: '🏠', clearing: '📂', stuff: '📄' };
  for (const p of pages) {
    const indent = '  '.repeat(p.depth);
    const icon = typeIcons[p.pageType] || '·';
    const lock = p.metadata?.locked ? ' 🔒' : '';
    const contentLen = p.content?.[0]?.content?.length || 0;
    console.log(`${indent}${icon} ${p.title} (${p.pageType})${lock} [${contentLen} chars]`);
  }

  console.log(`\n📤 正在逐筆匯入 ${pages.length} 筆資料至 ${API_BASE}...`);

  let ok = 0;
  let fail = 0;
  for (const p of pages) {
    try {
      const res = await fetch(`${API_BASE}/api/content/${p.area}/${p.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: p.title,
          content: p.content,
          parentId: p.parentId,
          depth: p.depth,
          pageType: p.pageType,
          sortOrder: p.sortOrder,
          metadata: p.metadata || {},
        }),
      });
      const json = await res.json();
      if (json.ok) {
        ok++;
        console.log(`   ✓ ${p.id}`);
      } else {
        fail++;
        console.error(`   ✗ ${p.id}: ${json.error}`);
      }
    } catch (e) {
      fail++;
      console.error(`   ✗ ${p.id}: ${e.message}`);
    }
  }

  console.log(`\n✅ 完成！成功: ${ok}, 失敗: ${fail}`);
  if (fail > 0) {
    console.error('   請確認 content-api worker 正在運行 (pnpm --filter content-api-worker dev)');
  }
}

async function main() {
  if (CLEAN) await cleanStorage();
  await importStorage();
  console.log('');
}

main();
