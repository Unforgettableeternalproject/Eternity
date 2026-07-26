/**
 * 互聯衍生表補建腳本（S10-1）
 *
 * 呼叫 `POST /api/interlink/reindex`，補建 migration 0022 的兩張表：
 *   - history_interlink_index：逐頁掃 content 的三種互聯標記重建錨點
 *   - story_points：掃 Echoes/Visuals 的 storyKey 補殼列
 *
 * 為什麼需要這一步：migration 只建空表。錨點藏在 content 的 TipTap JSON、
 * storyKey 藏在 metadata JSON，兩者都要逐頁解析，寫不進 SQL migration。
 * 沒跑之前既有內容的觸發模型靜默失效——沒有錯誤，只是永遠不會浮出線索卡。
 *
 * 冪等（整頁 DELETE+INSERT／INSERT OR IGNORE），重跑不會累積。
 *
 * 使用方式：
 *   node scripts/reindex-interlink.mjs --remote       # 正式
 *   node scripts/reindex-interlink.mjs --test         # 測試
 *   node scripts/reindex-interlink.mjs --local        # 本地（需 worker 在 :8788）
 *   node scripts/reindex-interlink.mjs --all          # 三個環境依序
 *   API_TOKEN=xxx node scripts/reindex-interlink.mjs --remote   # 非互動
 *
 * ⚠️ 需要與 worker 0.9.15.14 以上搭配才會補 story_points；更舊的版本
 * 只補 history_interlink_index（回應不含 storyKeys 欄位，本腳本會提醒）。
 */

import { resolveWriteToken } from './sync-auth.mjs';

const PROD_WORKER_URL = 'https://eternity-content-api.ptyc4076.workers.dev';
const TEST_WORKER_URL =
  'https://eternity-content-api-test.ptyc4076.workers.dev';
const LOCAL_WORKER_URL = 'http://localhost:8788';

const TARGETS = {
  remote: { label: '正式', url: PROD_WORKER_URL },
  test: { label: '測試', url: TEST_WORKER_URL },
  local: { label: '本地', url: LOCAL_WORKER_URL },
};

const args = process.argv.slice(2);
const selected = args.includes('--all')
  ? ['local', 'test', 'remote']
  : Object.keys(TARGETS).filter((key) => args.includes(`--${key}`));

if (selected.length === 0) {
  console.error(
    '\n用法: node scripts/reindex-interlink.mjs [--local] [--test] [--remote] [--all]\n'
  );
  process.exit(1);
}

/** 對單一環境執行 reindex；回傳是否成功 */
async function reindex(key, token) {
  const { label, url } = TARGETS[key];
  process.stdout.write(`\n▸ ${label}（${url}）\n`);

  let res;
  try {
    res = await fetch(`${url}/api/interlink/reindex`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    console.log(`   ✗ 連線失敗：${e.message}`);
    if (key === 'local') {
      console.log(
        '     本地 worker 沒在跑？需要 pnpm --filter content-api-worker dev'
      );
    }
    return false;
  }

  let json;
  try {
    json = await res.json();
  } catch {
    console.log(`   ✗ 回應不是 JSON（HTTP ${res.status}）`);
    return false;
  }

  if (!res.ok || !json?.ok) {
    console.log(
      `   ✗ 失敗（HTTP ${res.status}）：${json?.error || '未知錯誤'}`
    );
    return false;
  }

  const { pages = 0, anchors = 0, storyKeys } = json.data || {};
  console.log(`   ✓ 掃描 ${pages} 頁 History → ${anchors} 個錨點`);
  if (storyKeys === undefined) {
    console.log(
      '   ! 回應不含 storyKeys——這個 worker 早於 0.9.15.14，story_points 尚未補建'
    );
    console.log('     重新部署後再跑一次即可（冪等）');
  } else {
    console.log(`   ✓ ${storyKeys} 個劇情點殼列`);
  }
  return true;
}

async function main() {
  console.log('\n=== 互聯衍生表補建（S10-1）===');
  console.log(`目標：${selected.map((k) => TARGETS[k].label).join('、')}`);

  // 登入一律打正式 worker：test D1 的 admin_users 是空的，且兩邊
  // JWT_SECRET 相同，正式簽發的 token 對 test worker 一樣驗得過
  // （理由詳見 sync-auth.mjs 的 resolveWriteToken）
  const token = await resolveWriteToken({
    loginApiUrl: PROD_WORKER_URL,
    purpose: '互聯索引補建',
  });
  if (!token) {
    console.error('\n[ERROR] 未取得授權，中止。\n');
    process.exit(1);
  }

  let failed = 0;
  for (const key of selected) {
    const ok = await reindex(key, token);
    if (!ok) failed += 1;
  }

  console.log(
    failed === 0
      ? '\n完成。\n'
      : `\n完成，但有 ${failed} 個環境失敗（見上方訊息）。\n`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n[ERROR] ${e.message}\n`);
  process.exit(1);
});
