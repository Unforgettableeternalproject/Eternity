/**
 * Epic 2 進度系統驗收素材灌入腳本（**只寫 test 環境**）
 *
 * `seed-test-env.mjs` 的 leaf blacklist 跳過 section／song／stuff／gallery，
 * Concepts 的 type 也只留空殼——test D1 因此有完整的中間結構卻沒有任何葉子，
 * `docs/hidden/TEST_CHECKLIST.md` 的多數項目無從驗起。本腳本補那批葉子。
 *
 * 寫入內容見 `scripts/fixtures/progress-fixtures.mjs`。
 *
 * 使用方式：
 *   node scripts/seed-progress-fixtures.mjs --test          # 灌入
 *   node scripts/seed-progress-fixtures.mjs --test --dry-run # 只列出要寫什麼
 *   node scripts/seed-progress-fixtures.mjs --local          # 本機 worker（:8788）
 *
 * ⚠️ **本腳本永遠不接受正式環境**。三層防護與 seed/reset 同源：
 *   1. PROD_GUARD：prod 資源名稱與 URL 的完整段落比對
 *   2. hostname 檢查：目標主機第一段必須以 `-test` 結尾（local 例外）
 *   3. 沒有 `--remote` 這個選項——連打錯的機會都不留
 *
 * ⚠️ 冪等：重跑會覆蓋同 id 的頁面，並清掉 `STALE_PAGE_IDS` 列出的舊位置殘留。
 * 要完全乾淨重來請先 `pnpm test:reset`（但 reset 只清 pages 與 root_*，
 * uep_flags 與 interlink_keys 留著，重跑本腳本會原地更新）。
 */

import {
  ALL_PAGES,
  FLAGS,
  KEY_META,
  PAGE_IDS,
  PROGRESS_PAGE_ARC,
  STALE_PAGE_IDS,
} from './fixtures/progress-fixtures.mjs';
import { resolveWriteToken } from './sync-auth.mjs';

const TEST_WORKER_URL =
  'https://eternity-content-api-test.ptyc4076.workers.dev';
const LOCAL_WORKER_URL = 'http://localhost:8788';

/**
 * 正式資源的完整名稱與 URL。
 * ⚠️ 比對必須是**完整段落相等**，不可用 `String.includes()`——test worker 的
 * 命名慣例本身以 prod 名為前綴（`eternity-content-api-test`），子字串檢查
 * 會把每個 test 目標都誤判成正式環境。
 */
const PROD_GUARD = new Set([
  'eternity-content-api.ptyc4076.workers.dev',
  'eternity-content',
  'eternity-assets',
  'eternity-root-assets',
  '1f31587a-6cc7-441b-bbfb-eb99cba8a51b',
]);

const TARGETS = {
  test: { label: '測試', url: TEST_WORKER_URL },
  local: { label: '本地', url: LOCAL_WORKER_URL },
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = Object.keys(TARGETS).find((key) => args.includes(`--${key}`));

if (args.includes('--remote')) {
  console.error('\n✗ 本腳本不支援正式環境。驗收素材只灌 test worker。\n');
  process.exit(1);
}

if (!target) {
  console.error(
    '\n用法: node scripts/seed-progress-fixtures.mjs --test [--dry-run]\n' +
      '      node scripts/seed-progress-fixtures.mjs --local [--dry-run]\n'
  );
  process.exit(1);
}

const { label, url } = TARGETS[target];

/** 三層防護的第一、二層 */
function assertNotProduction(targetUrl) {
  const { hostname } = new URL(targetUrl);

  if (PROD_GUARD.has(hostname)) {
    console.error(`\n✗ 目標指向正式資源（${hostname}），中止。\n`);
    process.exit(1);
  }

  // 本機 worker 打的是本地 D1，不適用 -test 命名規則
  if (hostname === 'localhost' || hostname === '127.0.0.1') return;

  const firstSegment = hostname.split('.')[0];
  if (!firstSegment.endsWith('-test')) {
    console.error(
      `\n✗ 目標主機 ${hostname} 的第一段不以 -test 結尾，中止。\n` +
        '  驗收素材只能寫入測試環境。\n'
    );
    process.exit(1);
  }
}

assertNotProduction(url);

/** 帶授權的 JSON 請求；回傳 { ok, status, body } */
async function api(token, method, path, body) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // 非 JSON 回應（例如 502）——留 null，由呼叫端依 status 判斷
  }
  return { ok: res.ok && json?.ok !== false, status: res.status, body: json };
}

/**
 * 清掉搬家後留在舊位置的頁面。
 *
 * 404 視為成功——多數環境本來就沒有這些殘留（第一版之後才建的 test D1，
 * 或已經清過一次）。
 */
async function purgeStale(token) {
  let removed = 0;
  for (const id of STALE_PAGE_IDS) {
    const [area, ...rest] = id.split('/');
    const res = await api(
      token,
      'DELETE',
      `/api/content/${area}/${rest.join('/')}`
    );
    if (res.ok) {
      removed++;
      process.stdout.write(`  ✓ 已移除 ${id}\n`);
    } else if (res.status !== 404) {
      process.stdout.write(`  ! ${id} 移除失敗（${res.status}）\n`);
    }
  }
  return removed;
}

/** 註冊自訂旗標。已存在時回 409，視為成功（冪等）。 */
async function seedFlags(token) {
  let created = 0;
  let existing = 0;
  for (const flag of FLAGS) {
    const res = await api(token, 'POST', '/api/flags', flag);
    if (res.ok) {
      created++;
    } else if (res.status === 409) {
      existing++;
    } else {
      throw new Error(
        `旗標 ${flag.name} 註冊失敗（${res.status}）：${res.body?.error ?? '未知錯誤'}`
      );
    }
  }
  return { created, existing };
}

/**
 * 寫入頁面。
 *
 * ⚠️ 順序有意義：Concepts 先於 History。entity 可不可點取決於「相應浮島
 * 查得到內容」，條目還不存在時寫進 History 的 entity 會退回普通文字，
 * 而那個狀態很容易被誤讀成 S4 壞掉。
 */
async function seedPages(token) {
  const written = [];
  for (const page of ALL_PAGES) {
    const [area, ...rest] = page.id.split('/');
    const slug = rest.join('/');
    const parentId = page.id.slice(0, page.id.lastIndexOf('/'));
    const depth = rest.length;

    const res = await api(token, 'PUT', `/api/content/${area}/${slug}`, {
      title: page.title,
      content: page.content,
      metadata: page.metadata,
      pageType: page.pageType,
      parentId,
      depth,
      sortOrder: page.sortOrder,
      status: 'local_only',
    });
    if (!res.ok) {
      throw new Error(
        `頁面 ${page.id} 寫入失敗（${res.status}）：${res.body?.error ?? '未知錯誤'}`
      );
    }
    written.push(page.id);
    process.stdout.write(`  ✓ ${page.id}\n`);
  }
  return written;
}

/**
 * 把容器標為進度頁。
 *
 * 讀回原 metadata 再合併——直接覆寫會清掉 seed 從正式環境搬來的 icon 與
 * description，而那些欄位不屬於本腳本的職責範圍。
 */
async function markProgressPage(token) {
  const [area, ...rest] = PROGRESS_PAGE_ARC.split('/');
  const slug = rest.join('/');
  const current = await api(token, 'GET', `/api/content/${area}/${slug}`);
  if (!current.ok) {
    throw new Error(
      `讀取進度頁容器 ${PROGRESS_PAGE_ARC} 失敗（${current.status}）`
    );
  }
  const metadata = {
    ...(current.body?.data?.metadata ?? {}),
    progressPage: true,
  };
  const res = await api(token, 'PUT', `/api/content/${area}/${slug}`, {
    metadata,
  });
  if (!res.ok) {
    throw new Error(
      `標記進度頁 ${PROGRESS_PAGE_ARC} 失敗（${res.status}）：${res.body?.error ?? '未知錯誤'}`
    );
  }
}

/**
 * 補 key 說明。
 *
 * 殼列由存檔路徑自動建立（頁面寫入時掃 metadata 的 entityKey／storyKey），
 * 所以這一步必須在 seedPages 之後——否則 PUT 的目標列還不存在。
 * ⚠️ entity 的 title 會被 API 忽略（權威名稱來自 dossier 條目），只有
 * description 寫得進去。
 */
async function seedKeyMeta(token) {
  let updated = 0;
  for (const meta of KEY_META) {
    const res = await api(
      token,
      'PUT',
      `/api/interlink/keys/${meta.keyType}/${encodeURIComponent(meta.key)}`,
      { title: meta.title ?? null, description: meta.description }
    );
    if (res.ok) {
      updated++;
    } else {
      process.stdout.write(
        `  ! ${meta.keyType}:${meta.key} 說明寫入失敗（${res.status}）——` +
          '殼列可能尚未建立，稍後可重跑\n'
      );
    }
  }
  return updated;
}

/** 補建互聯衍生表——錨點藏在 content 的標記裡，只有 reindex 掃得出來 */
async function reindex(token) {
  const res = await api(token, 'POST', '/api/interlink/reindex');
  if (!res.ok) {
    throw new Error(`互聯 reindex 失敗（${res.status}）`);
  }
  return res.body?.data ?? {};
}

async function main() {
  process.stdout.write(`\n▸ 目標：${label}（${url}）\n`);

  if (dryRun) {
    process.stdout.write('\n[dry-run] 將寫入：\n');
    process.stdout.write(`\n  自訂旗標 ${FLAGS.length} 個\n`);
    FLAGS.forEach((f) => process.stdout.write(`    - ${f.name}\n`));
    process.stdout.write(`\n  頁面 ${ALL_PAGES.length} 個\n`);
    ALL_PAGES.forEach((p) =>
      process.stdout.write(`    - [${p.pageType}] ${p.id}\n`)
    );
    process.stdout.write(`\n  進度頁標記：${PROGRESS_PAGE_ARC}\n`);
    process.stdout.write(`\n  key 說明 ${KEY_META.length} 筆\n`);
    KEY_META.forEach((k) =>
      process.stdout.write(`    - ${k.keyType}:${k.key}\n`)
    );
    process.stdout.write('\n未做任何寫入。\n\n');
    return;
  }

  /* 互動登入的對象是**正式** worker：test D1 的 admin_users 是空的，向 test
     worker 登入永遠失敗；兩邊共用 JWT_SECRET，正式簽發的 admin JWT 打 test
     worker 由本地 verifyJwt 驗過。設了 API_TOKEN 則直接用，不會走登入。 */
  const token = await resolveWriteToken({
    loginApiUrl: 'https://eternity-content-api.ptyc4076.workers.dev',
    purpose: '灌入進度系統驗收素材',
  });
  if (!token) {
    console.error('\n[ERROR] 未取得授權，中止。\n');
    process.exit(1);
  }

  /* 清除必須排在寫入之前：storyKey／entityKey 在同一個 zone 內唯一，
     舊位置的頁面還佔著 key 的話，新頁面會被衝突檢查擋成 409。 */
  process.stdout.write('\n[1/6] 清除舊位置殘留\n');
  const purged = await purgeStale(token);
  process.stdout.write(`  移除 ${purged} 筆\n`);

  process.stdout.write('\n[2/6] 註冊自訂旗標\n');
  const flags = await seedFlags(token);
  process.stdout.write(`  新增 ${flags.created}、已存在 ${flags.existing}\n`);

  process.stdout.write('\n[3/6] 寫入頁面\n');
  const pages = await seedPages(token);

  process.stdout.write('\n[4/6] 標記進度頁容器\n');
  await markProgressPage(token);
  process.stdout.write(`  ✓ ${PROGRESS_PAGE_ARC}\n`);

  process.stdout.write('\n[5/6] 補 key 說明\n');
  const keys = await seedKeyMeta(token);
  process.stdout.write(`  更新 ${keys}/${KEY_META.length} 筆\n`);

  process.stdout.write('\n[6/6] 補建互聯衍生表\n');
  const idx = await reindex(token);
  process.stdout.write(
    `  錨點 ${idx.anchors ?? '?'}、story ${idx.storyKeys ?? '?'}、entity ${idx.entityKeys ?? '?'}\n`
  );

  process.stdout.write(`\n✓ 完成：${pages.length} 個頁面\n`);
  process.stdout.write(
    `\n下一步：切到 test 環境後從 ${PAGE_IDS.long} 開始讀。\n` +
      '素材與驗收項目的對照見 docs/hidden/TEST_CHECKLIST.md。\n\n'
  );
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
