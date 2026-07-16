/**
 * T-09：測試環境 Reset 腳本
 *
 * 執行順序：
 *   1. 安全閥：比對目標資源是否落在 prod 白名單 → 若命中立即 abort
 *   2. 確認 --confirm flag，未帶則印警告退出（exit code 1）
 *   3. 呼叫 test Worker 的 POST /api/test/reset 清空 D1 test 表格
 *   4. 呼叫 seed-test-env.mjs 重新填充骨架資料
 *
 * 使用方式：
 *   node scripts/reset-test-env.mjs --confirm
 *
 * ⚠️ 不帶 --confirm 會印警告並以 exit code 1 退出，不執行任何清除。
 */

import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════
// ⚠️ Prod 資源保護白名單（hard-coded）
// 若目標資源的名稱或 ID 在此集合內，立即 abort。
// 這是第一道安全閥，任何 reset 邏輯都無法繞過。
// ═══════════════════════════════════════════════════════════════

const PROD_GUARD = new Set([
  'eternity-content', // prod D1 database name
  '1f31587a-6cc7-441b-bbfb-eb99cba8a51b', // prod D1 database id
  'eternity-assets', // prod R2 bucket（文件站）
  'eternity-root-assets', // prod R2 bucket（主站）
  'eternity-content-api', // prod worker name
]);

// 已知合法的 test 資源（只操作這些）
const TEST_RESOURCES = {
  d1Name: 'eternity-content-test',
  d1Id: '71adde52-e169-452c-bf76-2b710c09586b',
  r2Assets: 'eternity-assets-test',
  r2Root: 'eternity-root-assets-test',
  workerName: 'eternity-content-api-test',
  workerUrl: 'https://eternity-content-api-test.ptyc4076.workers.dev',
};

// ═══════════════════════════════════════════════════════════════
// 安全閥函式
// ═══════════════════════════════════════════════════════════════

/**
 * 若 resourceName 在 PROD_GUARD 中，印「REFUSED」並 process.exit(1)。
 * @param {string} resourceName 要檢查的資源名稱或 ID
 * @param {string} context 用於錯誤訊息的脈絡說明
 */
function assertNotProd(resourceName, context = '') {
  if (PROD_GUARD.has(resourceName)) {
    console.error('\n' + '='.repeat(60));
    console.error('  REFUSED — PROD 資源保護觸發');
    console.error('='.repeat(60));
    console.error(`  偵測到 prod 資源：「${resourceName}」`);
    if (context) console.error(`  脈絡：${context}`);
    console.error('  reset 中止，prod 資料完全未受影響。');
    console.error('='.repeat(60) + '\n');
    process.exit(1);
  }
}

/**
 * 驗證所有 test 資源名稱皆不在 prod 白名單中。
 * 這確保即使有人修改 TEST_RESOURCES 常數，安全閥仍會攔截。
 */
function runProdGuardChecks() {
  assertNotProd(TEST_RESOURCES.d1Name, 'test D1 database name');
  assertNotProd(TEST_RESOURCES.d1Id, 'test D1 database id');
  assertNotProd(TEST_RESOURCES.r2Assets, 'test R2 bucket（文件站）');
  assertNotProd(TEST_RESOURCES.r2Root, 'test R2 bucket（主站）');
  assertNotProd(TEST_RESOURCES.workerName, 'test worker name');

  // 確認 test worker URL hostname 第一段以 `-test` 結尾
  // ⚠️ 不再用 URL.includes() 檢查 prod 名——test URL 命名慣例本來就以 prod worker 名稱為前綴
  //    （eternity-content-api-test 字面上含 eternity-content 與 eternity-content-api），
  //    寬鬆 includes 會誤觸；hostname 第一段是否 `-test` 結尾才是真正判斷點。
  try {
    const parsed = new URL(TEST_RESOURCES.workerUrl);
    const firstSegment = parsed.hostname.split('.')[0];
    if (!firstSegment.endsWith('-test')) {
      console.error(
        `\n[ABORT] test Worker URL hostname「${firstSegment}」不以 -test 結尾，reset 中止。`
      );
      process.exit(1);
    }
    // 再次確認 hostname 第一段本身不在 PROD_GUARD（如果有人手滑改成 prod）
    assertNotProd(firstSegment, `test Worker hostname 第一段`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid URL')) {
      console.error('\n[ABORT] 無法解析 test Worker URL，reset 中止。');
      process.exit(1);
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函式
// ═══════════════════════════════════════════════════════════════

function getApiToken() {
  return process.env.API_TOKEN || process.env.ETERNITY_API_TOKEN || null;
}

async function callTestReset(token) {
  const url = `${TEST_RESOURCES.workerUrl}/api/test/reset`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    // CLI 會在下一步執行 seed-test-env.mjs；避免 Worker 先 reseed 一次。
    body: JSON.stringify({ clearOnly: true }),
  });

  if (res.status === 404) {
    throw new Error(
      'POST /api/test/reset 回傳 404：test Worker 可能未部署，' +
        '或 ETERNITY_TEST_ENV 未設定為 "true"。'
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '（無回應體）');
    throw new Error(`HTTP ${res.status} — ${text}`);
  }

  return res.json();
}

function runSeed() {
  const seedScript = join(__dirname, 'seed-test-env.mjs');
  console.log('\n[ 2/2 ] 執行 seed-test-env.mjs 填充骨架資料...\n');

  const result = spawnSync(process.execPath, [seedScript], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error('\n[ERROR] seed-test-env.mjs 執行失敗');
    process.exit(result.status ?? 1);
  }
}

// ═══════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════

async function main() {
  // ── 步驟 1：安全閥（第一件事，不可移動到後面）──
  runProdGuardChecks();

  // ── 步驟 2：確認 --confirm flag ──
  if (!process.argv.includes('--confirm')) {
    console.error('\n' + '='.repeat(60));
    console.error('  警告：reset 操作需要明確確認');
    console.error('='.repeat(60));
    console.error('  此操作將清空 test D1 所有資料並重新 seed，無法復原。');
    console.error('  如確認執行，請加上 --confirm flag：');
    console.error();
    console.error('    node scripts/reset-test-env.mjs --confirm');
    console.error();
    console.error('  或透過 npm script：');
    console.error();
    console.error('    pnpm test:reset');
    console.error('='.repeat(60) + '\n');
    process.exit(1);
  }

  console.log('\n=== reset-test-env：測試環境完整重置 ===\n');
  console.log(`  目標 Worker : ${TEST_RESOURCES.workerUrl}`);
  console.log(`  Test D1     : ${TEST_RESOURCES.d1Name}`);
  console.log(
    `  Test R2     : ${TEST_RESOURCES.r2Assets} / ${TEST_RESOURCES.r2Root}`
  );
  console.log();

  // fail closed，與 seed-test-env 一致：部署後的 test Worker 需授權，
  // 無 token 呼叫會被 401 擋下，不存在「開發模式全通過」路徑。
  const token = getApiToken();
  if (!token) {
    console.error(
      '\n[ERROR] API_TOKEN 未設定；Test Worker 已 fail closed，CLI reset 必須提供 test API token。\n'
    );
    process.exit(1);
  }

  // ── 步驟 3：呼叫 test Worker 的 /api/test/reset 清空 D1 ──
  console.log('[ 1/2 ] 呼叫 POST /api/test/reset 清空 test D1 表格...');

  try {
    const result = await callTestReset(token);
    console.log('  完成。');
    if (result?.data) {
      const { tables, totalRows } = result.data;
      if (tables?.length > 0) {
        console.log(`  清除的表格：${tables.join(', ')}`);
      }
      if (typeof totalRows === 'number') {
        console.log(`  清除總筆數：${totalRows}`);
      }
    }
  } catch (err) {
    console.error(`\n[ERROR] reset 失敗：${err.message}`);
    console.error('  請確認 test Worker 已部署且 ETERNITY_TEST_ENV="true"。');
    process.exit(1);
  }

  // ── 步驟 4：重新 seed ──
  runSeed();

  console.log('\n=== reset 完成 ===');
  console.log(`  test 環境已重置並填充骨架資料。`);
  console.log(`  目標：${TEST_RESOURCES.workerUrl}\n`);
}

main().catch((err) => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
