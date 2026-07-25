/**
 * migrate-homepage.mjs
 *
 * 將硬編碼於 ZoneEntryPage.tsx 中的首頁區塊內容
 * 寫入 D1 資料庫的各區域 homepage 頁面。
 *
 * 用法：
 *   node scripts/migrate-homepage.mjs           → 寫入本地 D1（http://localhost:8788）
 *   node scripts/migrate-homepage.mjs --remote  → 寫入遠端 content-api
 */

// ─── 設定 ──────────────────────────────────────────────────────────────────

const IS_REMOTE = process.argv.includes('--remote');
const IS_DRY_RUN = process.argv.includes('--dry-run');

const API_BASE = IS_REMOTE
  ? (process.env.CONTENT_API_URL ??
    'https://eternity-content-api.ptyc4076.workers.dev')
  : 'http://localhost:8788';

const API_TOKEN = process.env.API_TOKEN ?? '';

// ─── 各區域首頁區塊資料 ────────────────────────────────────────────────────

/** @type {Record<string, { label: string; area: string; blocks: Array<{id:string;type:string;content:string;attrs:{}}>}>} */
const ZONE_HOMEPAGES = {
  // ── 1. 歷史典藏庫 ──────────────────────────────────────────────────────
  history: {
    label: '歷史典藏庫',
    area: 'history',
    blocks: [
      {
        id: 'h1',
        type: 'zone-header',
        content: JSON.stringify({
          title: '三向通道',
          subtitle:
            '眼前的景色讓你嘆為觀止。這裡儼然是一座大型圖書館，無數書頁正有條理地在天空中飛舞著。',
        }),
        attrs: {},
      },
      {
        id: 'h2',
        type: 'uep-dialogue',
        content: JSON.stringify([
          {
            text: '很壯觀吧! 這裡就是「歷史典藏庫」，簡單來說就是一座收集歷史的圖書館，不過...比較特別的是，這邊保存的並不是書或者文字之類的，而是記憶——或者說，某些人的「故事」。',
            side: 'left',
            effects: [],
          },
          {
            text: '這些看起來像玻璃一樣飛在天上的東西就是「記憶碎片」啦!每一個碎片都是一段歷史的片段，你可以選擇一段故事，然後跟著那些碎片走。',
            side: 'right',
            effects: ['glow'],
          },
        ]),
        attrs: {},
      },
      {
        id: 'h3',
        type: 'archway-grid',
        content: JSON.stringify({
          cards: [
            {
              tag: '【U】',
              name: '未被記載的傳說',
              state: 'open',
              stateLabel: 'OPEN',
            },
            {
              tag: '【E】',
              name: '*@*?*元',
              state: 'corrupted',
              stateLabel: 'CORRUPTED',
            },
            {
              tag: '【P】',
              name: '*無法解讀的文字*',
              state: 'sealed',
              stateLabel: 'SEALED',
            },
          ],
        }),
        attrs: {},
      },
      {
        id: 'h4',
        type: 'hint-box',
        content: JSON.stringify({
          text: '看來就算是小 U 也沒有辦法完美地維護每一段歷史...',
        }),
        attrs: {},
      },
    ],
  },

  // ── 2. 回音蒐藏間 ──────────────────────────────────────────────────────
  echoes: {
    label: '回音蒐藏間',
    area: 'echoes',
    blocks: [
      {
        id: 'e1',
        type: 'zone-header',
        content: JSON.stringify({
          title: '空白廣場',
          subtitle:
            '音樂、OST、聲音作品。一片空白但充滿聲波的廣場，每踩一步都有回聲。',
        }),
        attrs: {},
      },
      {
        id: 'e2',
        type: 'uep-dialogue',
        content: JSON.stringify([
          {
            text: '歡迎來到空白廣場!你有聽到嗎? 這裡到處都有聲音在迴盪呢!',
            side: 'left',
            effects: [],
          },
          {
            text: '這裡的每一個聲音都是一段故事的「回聲」，它們會一直重複直到有人聽見為止。',
            side: 'right',
            effects: ['shimmer'],
          },
        ]),
        attrs: {},
      },
      {
        id: 'e3',
        type: 'orb-cluster-grid',
        content: JSON.stringify({
          clusters: [
            { color: '#5B7FB3', label: '場景回聲', orbCount: 9 },
            { color: '#B86060', label: '人物回聲', orbCount: 5 },
            { color: '#5B9C7A', label: '情節回聲', orbCount: 9 },
            { color: '#8E6CB6', label: '特殊回聲', orbCount: 3 },
          ],
        }),
        attrs: {},
      },
    ],
  },

  // ── 3. 幻影重現室 ──────────────────────────────────────────────────────
  visuals: {
    label: '幻影重現室',
    area: 'visuals',
    blocks: [
      {
        id: 'v1',
        type: 'zone-header',
        content: JSON.stringify({
          title: '鏡向十字路口',
          subtitle:
            '畫作、插圖、視覺作品。半透明的人物像在水面盪漾，鏡中的倒影引導著方向。',
        }),
        attrs: {},
      },
      {
        id: 'v2',
        type: 'uep-dialogue',
        content: JSON.stringify([
          {
            text: '嘿嘿!這裡就是「鏡向十字路口」了! 看到那些浮在空中的鏡子了嗎?',
            side: 'left',
            effects: [],
          },
          {
            text: '每一面鏡子都映照著不同的「畫面」，你可以選擇一個方向走進去看看喔!',
            side: 'right',
            effects: ['glow'],
          },
        ]),
        attrs: {},
      },
      {
        id: 'v3',
        type: 'cross-road-grid',
        content: JSON.stringify({
          roads: [
            {
              area: 'fwd',
              dir: '前方',
              name: '陳列走廊',
              hint: '看起來有很多像鏡子一樣的物件?',
              href: '/visuals/gallery',
            },
            {
              area: 'lft',
              dir: '左側',
              name: '插畫長廊',
              hint: '這裡相對而言非常空曠',
              href: '/visuals/illustrations',
            },
            {
              area: 'rgt',
              dir: '右側',
              name: '草稿置放間',
              hint: '你可以看到一些人為修改過的痕跡',
              href: '/visuals/drafts',
            },
            {
              area: 'bck',
              dir: '後方',
              name: 'AI 萃取區',
              hint: '直覺告訴你有甚麼地方很詭異',
              href: '/visuals/ai',
            },
          ],
        }),
        attrs: {},
      },
    ],
  },

  // ── 4. 概念調整房 ──────────────────────────────────────────────────────
  concepts: {
    label: '概念調整房',
    area: 'concepts',
    blocks: [
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
    ],
  },

  // ── 5. 某人的置物空間 ──────────────────────────────────────────────────
  storage: {
    label: '某人的置物空間',
    area: 'storage',
    blocks: [
      {
        id: 's1',
        type: 'zone-header',
        content: JSON.stringify({
          title: '雜亂的書桌',
          subtitle:
            '公告、Meta、雜項。一片散亂卻自有秩序的房間，好像某個人留下的痕跡。',
        }),
        attrs: {},
      },
      {
        id: 's2',
        type: 'uep-dialogue',
        content: JSON.stringify([
          {
            text: '嗯...這裡是「雜亂的書桌」，就是放一些雜七雜八的東西的地方啦! (≧▽≦)',
            side: 'left',
            effects: [],
          },
        ]),
        attrs: {},
      },
      {
        id: 's3',
        type: 'storage-sticky-note',
        content: JSON.stringify({
          text: '喂! 你來到這裡了嗎? 這個地方有點奇怪呢...\n不過既然你來了，就好好看看吧! (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧\n也許這裡有一些有趣的東西喔~',
          attribution: '— u.e.p',
        }),
        attrs: {},
      },
      {
        id: 's4',
        type: 'storage-links-list',
        content: JSON.stringify({
          links: [
            {
              num: '01',
              title: '箱子堆成的遊樂場',
              file: 'boxes.md',
              hint: '好像被紙箱堆滿的倉庫',
              href: '/storage/boxes',
            },
            {
              num: '02',
              title: '更新公告',
              file: 'desk/changelog/',
              hint: '有幾張新貼上去的紙條',
              href: '/storage/changelog',
            },
            {
              num: '03',
              title: '雜物與草稿',
              file: 'desk/extras/',
              hint: '各種說不清楚用途的東西',
              href: '/storage/extras',
            },
          ],
        }),
        attrs: {},
      },
    ],
  },
};

// ─── 需從 D1 合併的既有 page-type 頁面 ────────────────────────────────────

/**
 * 各區域需要從 D1 讀取並合併到 homepage 的 page-type 頁面。
 * kicker + title 來自 D1 頁面，content 轉為 rich-text 區塊。
 */
const MERGE_PAGES = {
  history: [
    { slug: 'passage', kicker: 'History / Passage' },
    { slug: 'note', kicker: 'Loose Note / Page' },
  ],
  echoes: [
    { slug: 'plaza', kicker: 'Echoes / Plaza' },
    { slug: 'photo', kicker: 'Loose Note / Page' },
  ],
  // visuals / concepts / storage 目前無 page-type 頁面
};

/**
 * 從 D1 讀取一個既有頁面並轉為 homepage 區塊。
 * @returns {Promise<Array|null>} 轉換後的 ContentBlock 陣列，或 null
 */
async function fetchAndConvertPage(area, slug, kicker) {
  const url = `${API_BASE}/api/content/${area}/${slug}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.ok || !json.data) return null;

    const page = json.data;
    const blocks = [];
    const title = page.title || slug;

    // 將 D1 頁面的所有內容區塊合併為一個 rich-text 區塊
    let html = '';
    const contentArr =
      typeof page.content === 'string'
        ? JSON.parse(page.content)
        : page.content || [];

    if (Array.isArray(contentArr)) {
      html = contentArr
        .map((b) => {
          if (!b.content) return '';
          switch (b.type) {
            case 'heading': {
              const lvl = b.attrs?.level || 2;
              return `<h${lvl}>${b.content}</h${lvl}>`;
            }
            case 'blockquote':
              return `<blockquote><p>${b.content}</p></blockquote>`;
            case 'code':
              return `<pre><code>${b.content}</code></pre>`;
            case 'divider':
              return '<hr />';
            case 'image':
              return `<img src="${b.content}" alt="${b.attrs?.alt || ''}" />`;
            default:
              return b.content;
          }
        })
        .join('\n');
    }

    if (html.trim()) {
      // 用 kicker + title 作為區段標頭
      const headerHtml = `<div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.18em;text-transform:uppercase;margin-bottom:4px;">${kicker}</div><h3 style="margin:0 0 12px;">${title}</h3>`;
      blocks.push({
        id: `merge-${area}-${slug}`,
        type: 'rich-text',
        content: JSON.stringify({ html: headerHtml + html }),
        attrs: {},
      });
    }

    return { blocks, title, contentLength: contentArr.length };
  } catch {
    return null;
  }
}

// ─── 寫入函式 ──────────────────────────────────────────────────────────────

/**
 * 將單一區域的首頁資料 PUT 到 content-api。
 * @param {string} area - 區域 id（history / echoes / visuals / concepts / storage）
 * @param {string} label - 區域中文名稱（用於顯示）
 * @param {Array} blocks - ContentBlock 陣列
 */
async function migrateZone(area, label, blocks) {
  const url = `${API_BASE}/api/content/${area}/homepage`;

  const body = {
    title: `${label} 首頁`,
    content: blocks,
    pageType: 'homepage',
    parentId: null,
    depth: 0,
  };

  const headers = {
    'Content-Type': 'application/json',
  };
  if (API_TOKEN) {
    headers['Authorization'] = `Bearer ${API_TOKEN}`;
  }

  console.log(
    `\n[${area}] ${IS_DRY_RUN ? '(DRY RUN) ' : ''}正在寫入「${label} 首頁」...`
  );
  console.log(`  目標 URL: ${url}`);
  console.log(`  區塊數量: ${blocks.length}`);

  // 列出區塊摘要
  for (const b of blocks) {
    let preview = '';
    try {
      const parsed = JSON.parse(b.content);
      if (parsed.title) preview = parsed.title;
      else if (Array.isArray(parsed) && parsed.length > 0)
        preview = `${parsed.length} 個項目`;
      else if (parsed.cards) preview = `${parsed.cards.length} 張卡片`;
      else if (parsed.clusters) preview = `${parsed.clusters.length} 個集群`;
      else if (parsed.roads) preview = `${parsed.roads.length} 條路徑`;
      else if (parsed.modules) preview = `${parsed.modules.length} 個模組`;
      else if (parsed.links) preview = `${parsed.links.length} 個連結`;
      else if (parsed.text)
        preview =
          parsed.text.slice(0, 30) + (parsed.text.length > 30 ? '...' : '');
      else if (parsed.html) preview = `HTML (${parsed.html.length} chars)`;
    } catch {
      /* ignore */
    }
    console.log(`    ${b.id.padEnd(4)} │ ${b.type.padEnd(24)} │ ${preview}`);
  }

  if (IS_DRY_RUN) {
    console.log(`  ⤳ (dry-run) 跳過實際寫入`);
    return true;
  }

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '（無法讀取回應內容）');
      console.error(`  ✗ 寫入失敗 [HTTP ${res.status}]: ${text}`);
      return false;
    }

    const json = await res.json().catch(() => null);
    console.log(`  ✓ 寫入成功，共 ${blocks.length} 個區塊`);
    if (json?.slug) {
      console.log(`    slug: ${json.slug}`);
    }
    return true;
  } catch (err) {
    console.error(`  ✗ 網路錯誤: ${err.message}`);
    return false;
  }
}

// ─── 主程式 ────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  UEP 首頁區塊遷移腳本');
  console.log(
    `  模式: ${IS_REMOTE ? '遠端 (Remote)' : '本地 (Local)'}${IS_DRY_RUN ? ' (DRY RUN)' : ''}`
  );
  console.log(`  API Base: ${API_BASE}`);
  if (!API_TOKEN && IS_REMOTE) {
    console.warn('  警告: 未設定 API_TOKEN，若遠端需要驗證則會失敗');
  }
  console.log('═══════════════════════════════════════════════');

  // Phase 1: 讀取 D1 中的既有 page-type 頁面並合併
  console.log('\n── Phase 1: 讀取 D1 既有 page-type 頁面 ──\n');

  for (const [area, pageDefs] of Object.entries(MERGE_PAGES)) {
    const zone = ZONE_HOMEPAGES[area];
    if (!zone) continue;

    for (const { slug, kicker } of pageDefs) {
      console.log(`  [${area}/${slug}] 嘗試讀取...`);
      const result = await fetchAndConvertPage(area, slug, kicker);
      if (result && result.blocks.length > 0) {
        zone.blocks.push(...result.blocks);
        console.log(
          `    ✓ 已合併「${result.title}」(${result.contentLength} 個原始區塊 → 1 個 rich-text 區塊)`
        );
      } else {
        console.log(`    ⤳ 未找到或內容為空，跳過`);
      }
    }
  }

  // Phase 2: 寫入各區域 homepage
  console.log('\n── Phase 2: 寫入 homepage 頁面 ──');

  const zones = Object.values(ZONE_HOMEPAGES);
  let successCount = 0;
  let failCount = 0;

  for (const zone of zones) {
    const ok = await migrateZone(zone.area, zone.label, zone.blocks);
    if (ok) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('\n───────────────────────────────────────────────');
  console.log(`  完成！成功: ${successCount} / 失敗: ${failCount}`);
  if (failCount > 0) {
    console.log('  請確認 content-api Worker 是否正在運行。');
    console.log('  本地模式：pnpm --filter content-api-worker dev');
    process.exit(1);
  }
  console.log('───────────────────────────────────────────────\n');
}

main();
