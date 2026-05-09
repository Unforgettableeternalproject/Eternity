/**
 * 雙向內容同步工具：本地 D1 ↔ 遠端 D1
 *
 * 透過 content-api REST 端點比對兩端的 updated_at 時間戳，
 * 決定哪些頁面需要 push（本地→遠端）或 pull（遠端→本地）。
 *
 * 使用方式：
 *   node scripts/sync-content.mjs                      # 互動模式（顯示差異，逐一確認）
 *   node scripts/sync-content.mjs --pull               # 遠端→本地（遠端贏）
 *   node scripts/sync-content.mjs --push               # 本地→遠端（本地贏）
 *   node scripts/sync-content.mjs --dry-run             # 只顯示差異，不執行
 *   node scripts/sync-content.mjs --area history        # 只同步指定區域
 *   node scripts/sync-content.mjs --pull --area history # 可組合使用
 */

import { createInterface } from 'readline';

// === 設定 ===
const LOCAL_API = 'http://localhost:8788';
const REMOTE_API = 'https://eternity-content-api.ptyc4076.workers.dev';
const ALL_AREAS = ['history', 'echoes', 'visuals', 'concepts', 'storage', 'portal'];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DIRECTION = args.includes('--pull')
  ? 'pull'
  : args.includes('--push')
    ? 'push'
    : null; // null = 互動模式
const AREA_FLAG = args.indexOf('--area');
const TARGET_AREAS =
  AREA_FLAG !== -1 && args[AREA_FLAG + 1]
    ? [args[AREA_FLAG + 1]]
    : ALL_AREAS;

// === 工具函式 ===

/** 從 API 取得指定區域的所有頁面清單（不含 content） */
async function listPages(apiBase, area) {
  try {
    const res = await fetch(`${apiBase}/api/content/${area}`);
    if (!res.ok) return [];
    const json = await safeJson(res);
    return json?.ok ? json.data || [] : [];
  } catch {
    return [];
  }
}

/** 安全地解析 JSON 回應，回傳 null 若非 JSON */
async function safeJson(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** 從 API 取得單一頁面完整資料 */
async function getPage(apiBase, area, slug) {
  try {
    const res = await fetch(`${apiBase}/api/content/${area}/${slug}`);
    if (!res.ok) return null;
    const json = await safeJson(res);
    return json?.ok ? json.data : null;
  } catch {
    return null;
  }
}

/** 透過 PUT 端點寫入頁面 */
async function putPage(apiBase, page) {
  try {
    const res = await fetch(`${apiBase}/api/content/${page.area}/${page.slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: page.title,
        content: page.content,
        parentId: page.parentId || null,
        pageType: page.pageType,
        depth: page.depth,
        metadata: page.metadata || {},
      }),
    });
    if (!res.ok) return false;
    const json = await safeJson(res);
    return json?.ok ?? false;
  } catch {
    return false;
  }
}

/** 比較兩個時間戳，回傳較新的一方 */
function compareTimestamps(localTime, remoteTime) {
  const l = new Date(localTime).getTime();
  const r = new Date(remoteTime).getTime();
  if (l > r) return 'local';
  if (r > l) return 'remote';
  return 'same';
}

/** 格式化時間戳為易讀格式 */
function fmtTime(ts) {
  if (!ts) return '(無)';
  return ts.replace('T', ' ').replace(/\.\d+Z$/, '').slice(0, 19);
}

/** 互動式提問 */
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// === 比對邏輯 ===

/**
 * 比對兩端的頁面清單，產生 diff
 * 回傳 { pushPages, pullPages, conflicts, inSync }
 */
function buildDiff(localPages, remotePages) {
  const localMap = new Map(localPages.map((p) => [p.id, p]));
  const remoteMap = new Map(remotePages.map((p) => [p.id, p]));
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  const pushPages = []; // 本地有、遠端沒有，或本地較新
  const pullPages = []; // 遠端有、本地沒有，或遠端較新
  const conflicts = []; // 無法自動判斷
  const inSync = []; // 兩端一致

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (local && !remote) {
      pushPages.push({ id, reason: '僅存在本地', local });
    } else if (!local && remote) {
      pullPages.push({ id, reason: '僅存在遠端', remote });
    } else {
      // 兩端都有，比較時間戳
      const winner = compareTimestamps(local.updatedAt, remote.updatedAt);
      if (winner === 'local') {
        pushPages.push({
          id,
          reason: `本地較新 (${fmtTime(local.updatedAt)} > ${fmtTime(remote.updatedAt)})`,
          local,
          remote,
        });
      } else if (winner === 'remote') {
        pullPages.push({
          id,
          reason: `遠端較新 (${fmtTime(remote.updatedAt)} > ${fmtTime(local.updatedAt)})`,
          local,
          remote,
        });
      } else {
        inSync.push(id);
      }
    }
  }

  return { pushPages, pullPages, conflicts, inSync };
}

// === 同步執行 ===

async function executePush(pages, area) {
  let ok = 0;
  let fail = 0;
  for (const entry of pages) {
    const slug = entry.local?.slug || entry.id.replace(`${area}/`, '');
    const fullPage = await getPage(LOCAL_API, area, slug);
    if (!fullPage) {
      console.log(`  ✗ 無法讀取本地頁面 ${entry.id}`);
      fail++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  → [dry-run] 會推送 ${entry.id}`);
      ok++;
      continue;
    }
    const success = await putPage(REMOTE_API, fullPage);
    if (success) {
      console.log(`  ↑ ${entry.id}`);
      ok++;
    } else {
      console.log(`  ✗ 推送失敗 ${entry.id}`);
      fail++;
    }
  }
  return { ok, fail };
}

async function executePull(pages, area) {
  let ok = 0;
  let fail = 0;
  for (const entry of pages) {
    const slug = entry.remote?.slug || entry.id.replace(`${area}/`, '');
    const fullPage = await getPage(REMOTE_API, area, slug);
    if (!fullPage) {
      console.log(`  ✗ 無法讀取遠端頁面 ${entry.id}`);
      fail++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  ← [dry-run] 會拉取 ${entry.id}`);
      ok++;
      continue;
    }
    const success = await putPage(LOCAL_API, fullPage);
    if (success) {
      console.log(`  ↓ ${entry.id}`);
      ok++;
    } else {
      console.log(`  ✗ 拉取失敗 ${entry.id}`);
      fail++;
    }
  }
  return { ok, fail };
}

// === 主程式 ===

async function main() {
  console.log('\n🔄 內容同步工具');
  console.log(`   本地: ${LOCAL_API}`);
  console.log(`   遠端: ${REMOTE_API}`);
  console.log(
    `   模式: ${DRY_RUN ? 'dry-run' : DIRECTION === 'pull' ? '拉取 (遠端→本地)' : DIRECTION === 'push' ? '推送 (本地→遠端)' : '互動模式'}`
  );
  console.log(`   區域: ${TARGET_AREAS.join(', ')}\n`);

  // 檢查本地 API 是否可用
  try {
    const check = await fetch(`${LOCAL_API}/api/content/history`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!check.ok) throw new Error();
  } catch {
    console.error(
      '❌ 無法連線到本地 content-api (localhost:8788)，請確認 dev server 正在運行：'
    );
    console.error('   pnpm --filter content-api-worker dev\n');
    process.exit(1);
  }

  // 檢查遠端 API 是否可用
  try {
    const check = await fetch(`${REMOTE_API}/api/content/history`, {
      signal: AbortSignal.timeout(5000),
    });
    const ct = check.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      console.error('⚠️  遠端 API 回傳非 JSON 格式（可能是 Cloudflare 錯誤頁面），部分操作可能失敗');
    }
  } catch {
    console.error('⚠️  無法連線到遠端 API，將只顯示本地資料\n');
  }

  let totalPush = 0;
  let totalPull = 0;
  let totalSkip = 0;

  for (const area of TARGET_AREAS) {
    // 取得兩端的頁面清單
    const [localPages, remotePages] = await Promise.all([
      listPages(LOCAL_API, area),
      listPages(REMOTE_API, area),
    ]);

    if (localPages.length === 0 && remotePages.length === 0) continue;

    console.log(
      `📂 ${area}  (本地: ${localPages.length} 頁 / 遠端: ${remotePages.length} 頁)`
    );

    const { pushPages, pullPages, inSync } = buildDiff(
      localPages,
      remotePages
    );

    if (pushPages.length === 0 && pullPages.length === 0) {
      console.log(`   ✓ 完全同步 (${inSync.length} 頁)\n`);
      totalSkip += inSync.length;
      continue;
    }

    // 顯示差異
    if (pushPages.length > 0) {
      console.log(`\n   ↑ 本地較新 / 僅本地 (${pushPages.length} 頁):`);
      for (const p of pushPages) {
        console.log(`     ${p.id}  — ${p.reason}`);
      }
    }
    if (pullPages.length > 0) {
      console.log(`\n   ↓ 遠端較新 / 僅遠端 (${pullPages.length} 頁):`);
      for (const p of pullPages) {
        console.log(`     ${p.id}  — ${p.reason}`);
      }
    }
    if (inSync.length > 0) {
      console.log(`\n   = 已同步: ${inSync.length} 頁`);
    }
    console.log();

    // 決定要執行哪些操作
    let doPush = pushPages;
    let doPull = pullPages;

    if (DIRECTION === 'pull') {
      // 拉取模式：只拉取，不推送
      // 遠端較新的拉回來；本地較新的頁面也從遠端覆蓋
      doPush = [];
      doPull = [...pullPages, ...pushPages];
    } else if (DIRECTION === 'push') {
      // 推送模式：只推送，不拉取
      // 本地較新的推出去；遠端較新的頁面也從本地覆蓋
      doPush = [...pushPages, ...pullPages];
      doPull = [];
    } else if (!DRY_RUN) {
      // 互動模式：逐一確認
      const answer = await ask(
        `   執行同步？ [y] 全部 / [push] 只推送 / [pull] 只拉取 / [n] 跳過: `
      );
      if (answer === 'n' || answer === 'no') {
        console.log('   ⏭ 跳過\n');
        continue;
      }
      if (answer === 'push') {
        doPull = [];
      } else if (answer === 'pull') {
        doPush = [];
      }
    }

    // 執行
    if (doPush.length > 0) {
      console.log(`   推送 ${doPush.length} 頁到遠端...`);
      const result = await executePush(doPush, area);
      totalPush += result.ok;
    }
    if (doPull.length > 0) {
      console.log(`   拉取 ${doPull.length} 頁到本地...`);
      const result = await executePull(doPull, area);
      totalPull += result.ok;
    }
    totalSkip += inSync.length;

    console.log();
  }

  // 總結
  console.log('─'.repeat(40));
  console.log(
    `✅ 完成！ ↑推送: ${totalPush}  ↓拉取: ${totalPull}  =同步: ${totalSkip}`
  );
  console.log();
}

main().catch((e) => {
  console.error('❌ 錯誤:', e.message);
  process.exit(1);
});
