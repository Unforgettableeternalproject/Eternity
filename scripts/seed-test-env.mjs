/**
 * T-08：測試環境種子腳本
 *
 * 從正式 D1 讀取骨架資料，寫入 test D1（透過 test Worker API）。
 *
 * 使用方式：
 *   node scripts/seed-test-env.mjs
 *
 * 資料範圍（各 zone 全導覽骨架，不搬葉子內容）：
 *   - pages 表：leaf blacklist — 跳過 section/page/song/stuff/gallery
 *     其餘 homepage / zone / chapter / arc / cluster / subcategory /
 *     division / clearing / stack 全搬，完整導覽樹
 *   - concepts/type 保留 row 骨架但清空 content；真正內容是其中的 entity
 *   - storage/stuff 是葉子資料，整列略過
 *   - pages 表：slug = 'history/index'
 *   - root_singletons：18 個已知 keys（見 KNOWN_SINGLETON_KEYS）
 *   - root_cards：全部
 *   - root_links：全部（links 表無葉子之分）
 *
 * 各 zone 的葉子命名不同（艾斯維爾提醒）：
 *   - history: section + page   - echoes: song       - visuals: gallery
 *   - concepts: type row 保留，清空其中 entity content
 *   - storage: stuff 整列略過
 *
 * 安全性：
 *   - 本腳本為唯讀模式讀取 prod（GET），寫入 test Worker（PUT/POST）
 *   - 不直接連接任何 D1 database_id，透過 Worker API 存取
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

// 葉子頁黑名單的單一來源；Admin reset 走 workers/content-api/src/test-seed.ts
// import 同一份。改任一 zone 葉子型別只需改該 JSON。
const pageTypeConfig = JSON.parse(
  readFileSync(
    new URL(
      '../workers/content-api/src/test-seed-page-types.json',
      import.meta.url
    )
  )
);

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
 * 各 zone 的葉子 page_type 黑名單（Issue #41）
 *
 * 艾斯維爾要求「各區域的葉子頁不搬，讓我在測試環境自己塞內容做大膽測試」。
 * 不同 zone 的葉子命名不同：
 *   - history: section（rich text 章節內容，avg 8K max 14K）+ page（特殊獨立頁）
 *   - echoes:  song（108 首歌曲 metadata + audioKey）+ page
 *   - concepts: type 的 row 是 stack 下的列表項，真正內容才是 content 裡的 entity
 *   - storage: stuff 本身就是應由測試環境自行建立的葉子資料
 *   - visuals: gallery（相簿圖片清單）
 *
 * 中間結構層一律搬（zone/chapter/arc/cluster/subcategory/division/clearing/stack），
 * 才能在 test env 看到完整導覽樹。homepage 也搬（zone 入口介紹）。
 */
// history: section（長文）/ page（特殊獨立頁），echoes: song，
// storage: stuff，visuals: gallery——來源見上方 pageTypeConfig。
const LEAF_PAGE_TYPES = new Set(pageTypeConfig.leafPageTypes);

/**
 * 需要保留 row、但不可把正式內容帶進測試環境的頁面殼。
 *
 * concepts/type 的 title、parentId、metadata 決定 stack 內的子列表與編輯模式；
 * 若整頁略過，Concepts 導覽和 Admin tree 會缺層；若原樣搬入，又會把正式
 * entity 一起帶入。Storage 的 stuff 則是葉子資料，整列排除。
 */
const CONTENT_SHELL_PAGE_TYPES = new Set(pageTypeConfig.contentShellTypes);

export function sanitizeSeedPage(page) {
  const key = `${page.area}:${page.pageType}`;
  const isRequiredLeafAncestor =
    LEAF_PAGE_TYPES.has(page.pageType) && page.id !== 'history/index';
  if (!CONTENT_SHELL_PAGE_TYPES.has(key) && !isRequiredLeafAncestor) {
    return page;
  }

  return {
    ...page,
    content: [],
  };
}

/**
 * 從 prod 讀取 pages 表的骨架資料。
 * 策略：leaf blacklist — 明確跳過已知葉子，其他中間層 + homepage 全搬。
 */
export async function fetchSeedPages() {
  const seedPages = [];
  const seen = new Set();

  for (const zone of ZONES) {
    // 取得該 zone 的全部頁面清單（含層級資訊）
    const listResp = await prodGet(
      `/api/content/${zone}?include_deleted=false`
    );
    const pages = listResp.data || [];
    const pagesById = new Map(pages.map((page) => [page.id, page]));
    const selectedIds = new Set(
      pages
        .filter((page) => !LEAF_PAGE_TYPES.has(page.pageType))
        .map((page) => page.id)
    );

    // 被選中的骨架節點可能掛在 page 類型的容器下。若只依類型過濾，
    // parentId 會指向不存在的資料，D1 外鍵檢查便會讓 reseed 半途失敗。
    // 因此補齊所有必要祖先，但仍不搬入無關的葉子內容。
    for (const selectedId of [...selectedIds]) {
      let parentId = pagesById.get(selectedId)?.parentId;
      while (parentId) {
        const parent = pagesById.get(parentId);
        if (!parent) {
          throw new Error(
            `${selectedId} 的父節點 ${parentId} 不在 ${zone} 清單中`
          );
        }
        selectedIds.add(parentId);
        parentId = parent.parentId;
      }
    }

    for (const page of pages) {
      if (seen.has(page.id)) continue;
      if (!selectedIds.has(page.id)) continue;

      // 其餘（homepage / zone / chapter / arc / cluster / subcategory / division /
      //       clearing / stack）通通搬——這是 zone 導覽骨架
      const full = await prodGet(`/api/content/${zone}/${page.slug}`);
      if (full.data) {
        seedPages.push(sanitizeSeedPage(full.data));
        seen.add(page.id);
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

  // D1 會檢查 parent_id 外鍵，因此必須由淺至深寫入。
  seedPages.sort(
    (a, b) =>
      (a.depth ?? 0) - (b.depth ?? 0) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.id.localeCompare(b.id)
  );

  const seedIds = new Set(seedPages.map((page) => page.id));
  const missingParents = seedPages.filter(
    (page) => page.parentId && !seedIds.has(page.parentId)
  );
  if (missingParents.length > 0) {
    throw new Error(
      `種子資料缺少父節點：${missingParents
        .map((page) => `${page.id} -> ${page.parentId}`)
        .join(', ')}`
    );
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

/**
 * 從 prod 讀取 root_projects。
 */
async function fetchSeedProjects() {
  try {
    const resp = await prodGet('/api/root/projects');
    return resp.data || [];
  } catch (err) {
    console.warn(`  ⚠ 無法讀取 root_projects: ${err.message}`);
    return [];
  }
}

/**
 * 從 prod 讀取 root_updates。
 */
async function fetchSeedUpdates() {
  try {
    const resp = await prodGet('/api/root/updates');
    return resp.data || [];
  } catch (err) {
    console.warn(`  ⚠ 無法讀取 root_updates: ${err.message}`);
    return [];
  }
}

async function fetchSeedSiteHomepage() {
  try {
    const resp = await prodGet('/api/homepage');
    return Object.entries(resp.data || {}).map(([sectionId, value]) => ({
      sectionId,
      content: value.content,
      updatedAt: value.updatedAt,
    }));
  } catch (err) {
    console.warn(`  ⚠ 無法讀取 site_homepage: ${err.message}`);
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

  // 建構 PUT body（符合 Worker 的 camelCase UpsertPageRequest）。
  // 這裡不可沿用 D1 snake_case，否則 Worker 會忽略欄位並把所有節點預設成 page。
  const body = {
    title: page.title,
    content: page.content, // 已是物件，API 接受 object 或 string
    metadata: page.metadata,
    status: page.status || 'synced',
    pageType: page.pageType,
    sortOrder: page.sortOrder ?? 0,
    parentId: page.parentId || null,
    depth: page.depth ?? 0,
    updatedAt: page.updatedAt,
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

/**
 * 寫入 root_projects（PUT /api/root/projects/:id）。
 *
 * API list 回傳的是 camelCase RootProject（含 links 巢狀物件），
 * UpsertRootProjectRequest 接受同構欄位，直接原封轉發即可。
 * 明確帶欄位而非 spread 全物件，避免把 createdAt / deletedAt 之類伺服器管理欄位塞回去。
 */
async function writeProject(project, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const body = {
    titleZh: project.titleZh,
    titleEn: project.titleEn,
    descZh: project.descZh,
    descEn: project.descEn,
    contentZh: project.contentZh,
    contentEn: project.contentEn,
    tags: project.tags,
    featured: project.featured,
    sortOrder: project.sortOrder,
    status: project.status,
    image: project.image,
    links: project.links,
    startDate: project.startDate,
    endDate: project.endDate,
    updatedAt: project.updatedAt,
  };

  await apiFetch(TEST_WORKER_URL, `/api/root/projects/${project.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * 寫入 root_updates（PUT /api/root/updates/:id）。
 */
async function writeUpdate(update, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const body = {
    titleZh: update.titleZh,
    titleEn: update.titleEn,
    descZh: update.descZh,
    descEn: update.descEn,
    contentZh: update.contentZh,
    contentEn: update.contentEn,
    date: update.date,
    category: update.category,
    featured: update.featured,
    updatedAt: update.updatedAt,
  };

  await apiFetch(TEST_WORKER_URL, `/api/root/updates/${update.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
}

async function writeSiteHomepage(section, token) {
  const headers = { 'Content-Type': 'application/json' };
  headers['Authorization'] = `Bearer ${token}`;
  await apiFetch(TEST_WORKER_URL, `/api/homepage/${section.sectionId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ content: section.content }),
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
    throw new Error(
      'API_TOKEN 未設定；Test Worker 已 fail closed，CLI seed 必須提供 test API token。'
    );
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
  console.log('\n[ 4/6 ] 從 prod 讀取 root_links...');
  const links = await fetchSeedLinks();
  console.log(`  找到 ${links.length} 筆 links`);

  // ── 5. 讀取 root_projects ──
  console.log('\n[ 5/6 ] 從 prod 讀取 root_projects...');
  const projects = await fetchSeedProjects();
  console.log(`  找到 ${projects.length} 筆 projects`);

  // ── 6. 讀取 root_updates ──
  console.log('\n[ 6/6 ] 從 prod 讀取 root_updates...');
  const updates = await fetchSeedUpdates();
  console.log(`  找到 ${updates.length} 筆 updates`);

  console.log('\n[ 7/7 ] 從 prod 讀取 site_homepage...');
  const siteHomepage = await fetchSeedSiteHomepage();
  console.log(`  找到 ${siteHomepage.length} 筆 site_homepage`);

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

  let projectOk = 0,
    projectFail = 0;
  for (const p of projects) {
    try {
      await writeProject(p, token);
      projectOk++;
    } catch (err) {
      projectFail++;
      console.error(`  ✘ project ${p.id}: ${err.message}`);
    }
  }
  console.log(`  projects: ${projectOk} 成功, ${projectFail} 失敗`);

  let updateOk = 0,
    updateFail = 0;
  for (const u of updates) {
    try {
      await writeUpdate(u, token);
      updateOk++;
    } catch (err) {
      updateFail++;
      console.error(`  ✘ update ${u.id}: ${err.message}`);
    }
  }
  console.log(`  updates: ${updateOk} 成功, ${updateFail} 失敗`);

  let homepageOk = 0,
    homepageFail = 0;
  for (const section of siteHomepage) {
    try {
      await writeSiteHomepage(section, token);
      homepageOk++;
    } catch (err) {
      homepageFail++;
      console.error(`  ✘ site_homepage ${section.sectionId}: ${err.message}`);
    }
  }
  console.log(`  site_homepage: ${homepageOk} 成功, ${homepageFail} 失敗`);

  // ── 摘要 ──
  console.log('\n=== 種子完成摘要 ===\n');
  console.log(
    `  pages       : ${pagesOk} 筆（類型分布：${JSON.stringify(byType)}）`
  );
  console.log(`  singletons  : ${singletonOk} 筆`);
  console.log(`  cards       : ${cardOk} 筆`);
  console.log(`  links       : ${linkOk} 筆`);
  console.log(`  projects    : ${projectOk} 筆`);
  console.log(`  updates     : ${updateOk} 筆`);
  console.log(`  homepage    : ${homepageOk} 筆`);
  console.log(`  目標        : ${TEST_WORKER_URL}`);
  console.log();

  if (
    pagesFail +
      singletonFail +
      cardFail +
      linkFail +
      projectFail +
      updateFail +
      homepageFail >
    0
  ) {
    console.warn('  ⚠ 部分資料寫入失敗，請檢查上方錯誤訊息。');
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error('\n[FATAL]', err.message);
    process.exit(1);
  });
}
