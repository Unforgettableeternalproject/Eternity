/**
 * T-08：測試環境種子腳本
 *
 * 從正式 D1 讀取骨架資料，寫入 test D1（透過 test Worker API）。
 *
 * 使用方式：
 *   node scripts/seed-test-env.mjs
 *
 * 資料範圍（不搬葉子內容頁）：
 *   - pages 表：page_type = 'homepage'（5 個 zone 首頁 — history/echoes/concepts/visuals/storage）
 *   - pages 表：page_type = 'zone'（history 的 3 個 passage 子條目「區間」）
 *   - pages 表：depth = 1 且各 zone 的首筆 chapter（概覽用）
 *   - pages 表：slug = 'history/index'
 *   - root_singletons：18 個已知 keys（見 KNOWN_SINGLETON_KEYS）
 *   - root_cards：全部
 *   - root_links：全部（links 表無葉子之分）
 *
 * 安全性：
 *   - 本腳本為唯讀模式讀取 prod（GET），寫入 test Worker（PUT/POST）
 *   - 不直接連接任何 D1 database_id，透過 Worker API 存取
 */

import { execSync } from 'child_process';

// ═══════════════════════════════════════════════════════════════
// 資源常數
// ═══════════════════════════════════════════════════════════════

const PROD_WORKER_URL = 'https://eternity-content-api.ptyc4076.workers.dev';
const TEST_WORKER_URL =
  'https://eternity-content-api-test.ptyc4076.workers.dev';

// ⚠️ Prod 資源保護白名單——seed 腳本永不寫入以下資源
const PROD_GUARD = new Set([
  'eternity-content',
  '1f31587a-6cc7-441b-bbfb-eb99cba8a51b',
  'eternity-assets',
  'eternity-root-assets',
  'eternity-content-api',
]);

// ═══════════════════════════════════════════════════════════════
// 讀取 API_TOKEN（透過 wrangler secret list 讀取 test env token）
// ═══════════════════════════════════════════════════════════════

function getApiToken() {
  const envToken = process.env.API_TOKEN || process.env.ETERNITY_API_TOKEN;
  if (envToken) return envToken;
  // 若未設定環境變數，dev mode（無 token）= 全通過
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 安全閥
// ═══════════════════════════════════════════════════════════════

function assertNotProd(name) {
  if (PROD_GUARD.has(name)) {
    console.error(
      `\n[ABORT] 偵測到 prod 資源「${name}」在寫入目標，seed 中止。\n` +
        '  seed 腳本應只寫入 test Worker，請確認目標 URL 正確。'
    );
    process.exit(1);
  }
}

// 確認目標 URL 確實是 test worker
function assertTestWorkerUrl(url) {
  try {
    const parsed = new URL(url);
    const firstSegment = parsed.hostname.split('.')[0];
    if (firstSegment !== 'eternity-content-api-test') {
      console.error(
        `\n[ABORT] 目標 URL「${url}」不是 test worker，seed 中止。`
      );
      process.exit(1);
    }
  } catch {
    console.error(`\n[ABORT] 無法解析目標 URL「${url}」，seed 中止。`);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════
// HTTP 工具
// ═══════════════════════════════════════════════════════════════

async function apiFetch(base, path, options = {}) {
  const url = `${base}${path}`;
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '（無回應體）');
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}\n${text}`);
  }
  return res.json();
}

async function prodGet(path) {
  return apiFetch(PROD_WORKER_URL, path);
}

async function testPut(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return apiFetch(TEST_WORKER_URL, path, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
}

async function testPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return apiFetch(TEST_WORKER_URL, path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// ═══════════════════════════════════════════════════════════════
// 主要邏輯：讀取 prod 骨架資料
// ═══════════════════════════════════════════════════════════════

const ZONES = ['history', 'echoes', 'visuals', 'concepts', 'storage'];

/**
 * 從 prod 讀取 pages 表的骨架資料。
 * 回傳要複製的 page 清單（帶完整欄位）。
 */
async function fetchSeedPages() {
  const seedPages = [];
  const seen = new Set();

  for (const zone of ZONES) {
    // 取得該 zone 的全部頁面清單（含層級資訊）
    const listResp = await prodGet(
      `/api/content/${zone}?include_deleted=false`
    );
    const pages = listResp.data || [];

    for (const page of pages) {
      if (seen.has(page.id)) continue;

      // 條件一：zone entry pages
      // - page_type='homepage'（各 zone 的入口首頁；depth=0，如 history/homepage）
      // - page_type='zone'（history 的 passage 子條目「區間」，depth=1）
      // 兩者都是需要在 test env 看到骨架的頁面。實際 prod 有 5 個 homepage
      // （history/echoes/concepts/visuals/storage）+ 3 個 history zone 條目。
      if (page.pageType === 'homepage' || page.pageType === 'zone') {
        const full = await prodGet(`/api/content/${zone}/${page.slug}`);
        if (full.data) {
          seedPages.push(full.data);
          seen.add(page.id);
        }
        continue;
      }

      // 條件二：depth === 1（首個 chapter，各 zone 只取一筆）
      if (page.depth === 1 && page.pageType === 'chapter') {
        // 檢查這個 zone 是否已有 depth=1 的 chapter
        const alreadyHasChapter = seedPages.some(
          (p) => p.area === zone && p.depth === 1
        );
        if (!alreadyHasChapter) {
          const full = await prodGet(`/api/content/${zone}/${page.slug}`);
          if (full.data) {
            seedPages.push(full.data);
            seen.add(page.id);
          }
        }
        continue;
      }
    }

    // 條件三：history/index 首頁（特殊 slug）
    if (zone === 'history') {
      try {
        const histIdx = await prodGet('/api/content/history/index');
        if (histIdx.data && !seen.has(histIdx.data.id)) {
          seedPages.push(histIdx.data);
          seen.add(histIdx.data.id);
        }
      } catch {
        // history/index 不存在則跳過
      }
    }
  }

  return seedPages;
}

/**
 * 從 prod 讀取 root_singletons（by-key）。
 *
 * ⚠️ content-api 沒有 `/api/root/singletons` 列表端點，只支援 GET :key。
 * 逐個抓 apps/root 已知的 singleton keys（保持與 apps/root/src/pages/admin/index.astro
 * 使用清單同步——那邊改就要跟著改）。
 */
const KNOWN_SINGLETON_KEYS = [
  'homepage-zh',
  'about-zh',
  'about-en',
  'contact-zh',
  'contact-en',
  'currently',
  'page-home-zh',
  'page-home-en',
  'page-projects-zh',
  'page-projects-en',
  'page-updates-zh',
  'page-updates-en',
  'page-links-zh',
  'page-links-en',
  'page-about-zh',
  'page-about-en',
  'page-contact-zh',
  'page-contact-en',
];

async function fetchSeedSingletons() {
  const results = [];
  for (const key of KNOWN_SINGLETON_KEYS) {
    try {
      const resp = await prodGet(`/api/root/singletons/${key}`);
      if (resp.data) {
        results.push({ ...resp.data, section_id: resp.data.sectionId ?? key });
      }
    } catch (err) {
      // 個別 key 缺失只 warn，不中斷（可能還沒建 / 已軟刪除）
      console.warn(`  ⚠ singleton ${key} 未取得: ${err.message}`);
    }
  }
  return results;
}

/**
 * 從 prod 讀取 root_cards。
 */
async function fetchSeedCards() {
  try {
    const resp = await prodGet('/api/root/cards');
    return resp.data || [];
  } catch (err) {
    console.warn(`  ⚠ 無法讀取 root_cards: ${err.message}`);
    return [];
  }
}

/**
 * 從 prod 讀取 root_links。
 */
async function fetchSeedLinks() {
  try {
    const resp = await prodGet('/api/root/links');
    return resp.data || [];
  } catch (err) {
    console.warn(`  ⚠ 無法讀取 root_links: ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 寫入 test Worker
// ═══════════════════════════════════════════════════════════════

/**
 * 將 page 物件寫入 test Worker（PUT /api/content/:area/:slug）。
 * JSON 欄位（content、metadata）用 JSON.stringify 序列化，避免 cp950 問題。
 */
async function writePage(page, token) {
  const slug = page.slug;
  const area = page.area;

  // 建構 PUT body（符合 UpsertPageRequest）
  const body = {
    title: page.title,
    content: page.content, // 已是物件，API 接受 object 或 string
    metadata: page.metadata,
    source_file: page.sourceFile || null,
    base_content_hash: page.baseContentHash || null,
    status: page.status || 'synced',
    page_type: page.pageType,
    sort_order: page.sortOrder ?? 0,
    parent_id: page.parentId || null,
    depth: page.depth ?? 0,
  };

  await testPut(`/api/content/${area}/${slug}`, body, token);
}

/**
 * 寫入 root_singletons（PUT /api/root/singletons/:sectionId）。
 */
async function writeSingleton(singleton, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const sectionId = singleton.section_id || singleton.sectionId || singleton.id;
  const content =
    typeof singleton.content === 'string'
      ? JSON.parse(singleton.content)
      : singleton.content;

  await apiFetch(TEST_WORKER_URL, `/api/root/singletons/${sectionId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      content,
      updatedAt: singleton.updated_at || singleton.updatedAt,
    }),
  });
}

/**
 * 寫入 root_cards（PUT /api/root/cards/:sectionId）。
 */
async function writeCard(card, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const sectionId = card.section_id || card.sectionId || card.id;
  const content =
    typeof card.content === 'string' ? JSON.parse(card.content) : card.content;

  await apiFetch(TEST_WORKER_URL, `/api/root/cards/${sectionId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      content,
      updatedAt: card.updated_at || card.updatedAt,
    }),
  });
}

/**
 * 寫入 root_links（PUT /api/root/links/:id）。
 */
async function writeLink(link, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const id = link.id;
  await apiFetch(TEST_WORKER_URL, `/api/root/links/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(link),
  });
}

// ═══════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('\n=== seed-test-env：測試環境骨架資料種子 ===\n');

  // 安全閥：確認寫入目標是 test worker（hostname 第一段完整匹配）
  // ⚠️ 不再做 URL.includes(prodName) 檢查——test worker 命名慣例本身以
  // prod worker 名稱為前綴（eternity-content-api-test 字面上含
  // eternity-content 與 eternity-content-api）。assertTestWorkerUrl 已足夠。
  assertTestWorkerUrl(TEST_WORKER_URL);

  const token = getApiToken();
  if (!token) {
    console.log('  ℹ API_TOKEN 未設定，以開發模式（全通過）執行\n');
  }

  // ── 1. 讀取 prod 骨架 pages ──
  console.log('[ 1/4 ] 從 prod 讀取骨架 pages...');
  const seedPages = await fetchSeedPages();
  console.log(`  找到 ${seedPages.length} 筆 pages`);

  const byType = {};
  for (const p of seedPages) {
    byType[p.pageType] = (byType[p.pageType] || 0) + 1;
  }
  for (const [type, count] of Object.entries(byType)) {
    console.log(`    ${type}: ${count} 筆`);
  }

  // ── 2. 讀取 root_singletons ──
  console.log('\n[ 2/4 ] 從 prod 讀取 root_singletons...');
  const singletons = await fetchSeedSingletons();
  console.log(`  找到 ${singletons.length} 筆 singletons`);

  // ── 3. 讀取 root_cards ──
  console.log('\n[ 3/4 ] 從 prod 讀取 root_cards...');
  const cards = await fetchSeedCards();
  console.log(`  找到 ${cards.length} 筆 cards`);

  // ── 4. 讀取 root_links ──
  console.log('\n[ 3/4 ] 從 prod 讀取 root_links...');
  const links = await fetchSeedLinks();
  console.log(`  找到 ${links.length} 筆 links`);

  // ── 寫入 test Worker ──
  console.log('\n=== 開始寫入 test Worker ===\n');

  let pagesOk = 0,
    pagesFail = 0;
  for (const page of seedPages) {
    try {
      await writePage(page, token);
      pagesOk++;
      process.stdout.write(`  ✔ ${page.id}\r`);
    } catch (err) {
      pagesFail++;
      console.error(`  ✘ ${page.id}: ${err.message}`);
    }
  }
  console.log(`  pages: ${pagesOk} 成功, ${pagesFail} 失敗          `);

  let singletonOk = 0,
    singletonFail = 0;
  for (const s of singletons) {
    const id = s.section_id || s.sectionId || s.id;
    try {
      await writeSingleton(s, token);
      singletonOk++;
    } catch (err) {
      singletonFail++;
      console.error(`  ✘ singleton ${id}: ${err.message}`);
    }
  }
  console.log(`  singletons: ${singletonOk} 成功, ${singletonFail} 失敗`);

  let cardOk = 0,
    cardFail = 0;
  for (const c of cards) {
    const id = c.section_id || c.sectionId || c.id;
    try {
      await writeCard(c, token);
      cardOk++;
    } catch (err) {
      cardFail++;
      console.error(`  ✘ card ${id}: ${err.message}`);
    }
  }
  console.log(`  cards: ${cardOk} 成功, ${cardFail} 失敗`);

  let linkOk = 0,
    linkFail = 0;
  for (const l of links) {
    try {
      await writeLink(l, token);
      linkOk++;
    } catch (err) {
      linkFail++;
      console.error(`  ✘ link ${l.id}: ${err.message}`);
    }
  }
  console.log(`  links: ${linkOk} 成功, ${linkFail} 失敗`);

  // ── 摘要 ──
  console.log('\n=== 種子完成摘要 ===\n');
  console.log(
    `  pages       : ${pagesOk} 筆（類型分布：${JSON.stringify(byType)}）`
  );
  console.log(`  singletons  : ${singletonOk} 筆`);
  console.log(`  cards       : ${cardOk} 筆`);
  console.log(`  links       : ${linkOk} 筆`);
  console.log(`  目標        : ${TEST_WORKER_URL}`);
  console.log();

  if (pagesFail + singletonFail + cardFail + linkFail > 0) {
    console.warn('  ⚠ 部分資料寫入失敗，請檢查上方錯誤訊息。');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
