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
 *   node scripts/sync-content.mjs --purge               # 清除兩端超過 30 天的軟刪除記錄
 *   node scripts/sync-content.mjs --purge 7             # 清除超過 7 天的軟刪除記錄
 *   node scripts/sync-content.mjs --skip-homepage       # 跳過首頁同步
 *
 * 當由 sync.mjs 派遣時，會透過 SYNC_REMOTE_TOKEN 環境變數接收已登入的 token，
 * 無需重複詢問密碼。獨立執行且非 dry-run 時，自行進行登入。
 */

import {
  safeJson,
  normalizeTimestamp,
  compareTimestamps,
  fmtTime,
  ask,
  checkLocalApi,
  checkRemoteApi,
} from './sync-utils.mjs';
import { login, getAuthHeaders } from './sync-auth.mjs';

// === 設定 ===
const LOCAL_API = 'http://localhost:8788';
const REMOTE_API = 'https://eternity-content-api.ptyc4076.workers.dev';
const ALL_AREAS = [
  'history',
  'echoes',
  'visuals',
  'concepts',
  'storage',
  'portal',
];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PURGE_FLAG = args.indexOf('--purge');
const PURGE_MODE = PURGE_FLAG !== -1;
const PURGE_DAYS = PURGE_MODE ? parseInt(args[PURGE_FLAG + 1], 10) || 30 : 30;
const DIRECTION = args.includes('--pull')
  ? 'pull'
  : args.includes('--push')
    ? 'push'
    : null; // null = 互動模式
const SKIP_HOMEPAGE = args.includes('--skip-homepage');
const AREA_FLAG = args.indexOf('--area');
const TARGET_AREAS =
  AREA_FLAG !== -1 && args[AREA_FLAG + 1] ? [args[AREA_FLAG + 1]] : ALL_AREAS;

// === 認證狀態（模組頂層，由 main() 設定） ===

/** 遠端 JWT token，由 main() 初始化 */
let remoteToken = null;

/** 為請求加上認證 header（依目標 API 決定是否附帶） */
function authHeaders(apiBase) {
  if (apiBase === REMOTE_API) {
    return getAuthHeaders(remoteToken);
  }
  return {};
}

// === 頁面讀寫 ===

/** 從 API 取得指定區域的所有頁面清單（不含 content，包含已軟刪除的記錄） */
async function listPages(apiBase, area) {
  try {
    const res = await fetch(
      `${apiBase}/api/content/${area}?include_deleted=true`
    );
    if (!res.ok) return [];
    const json = await safeJson(res);
    return json?.ok ? json.data || [] : [];
  } catch {
    return [];
  }
}

/** 從 API 取得單一頁面完整資料（包含已軟刪除的記錄） */
async function getPage(apiBase, area, slug) {
  try {
    const res = await fetch(
      `${apiBase}/api/content/${area}/${slug}?include_deleted=true`
    );
    if (!res.ok) return null;
    const json = await safeJson(res);
    return json?.ok ? json.data : null;
  } catch {
    return null;
  }
}

/** 透過 PUT 端點寫入頁面（保留來源端的 updatedAt） */
async function putPage(apiBase, page) {
  try {
    const res = await fetch(
      `${apiBase}/api/content/${page.area}/${page.slug}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(apiBase),
        },
        body: JSON.stringify({
          title: page.title,
          content: page.content,
          parentId: page.parentId || null,
          pageType: page.pageType,
          depth: page.depth,
          metadata: page.metadata || {},
          status: page.status || 'synced',
          updatedAt: page.updatedAt,
          sortOrder: page.sortOrder,
        }),
      }
    );
    const json = await safeJson(res);
    if (!res.ok || !json?.ok) {
      // 撞名（409）與其他寫入拒絕都要帶出原因——只印「失敗」時使用者
      // 無從得知是 key 被別頁佔用，只會以為是網路或權限問題
      return { ok: false, error: json?.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// === 比對邏輯 ===

/**
 * 比對兩端的頁面清單，產生 diff
 * 回傳 { pushPages, pullPages, deleteOnRemote, deleteOnLocal, conflicts, inSync }
 */
function buildDiff(localPages, remotePages) {
  const localMap = new Map(localPages.map((p) => [p.id, p]));
  const remoteMap = new Map(remotePages.map((p) => [p.id, p]));
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  const pushPages = []; // 本地有、遠端沒有，或本地較新
  const pullPages = []; // 遠端有、本地沒有，或遠端較新
  const deleteOnRemote = []; // 本地已刪除，需傳播刪除到遠端
  const deleteOnLocal = []; // 遠端已刪除，需傳播刪除到本地
  const conflicts = []; // 無法自動判斷
  const inSync = []; // 兩端一致

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (local && !remote) {
      if (local.deletedAt) {
        // 本地建立後又刪除，遠端從未出現過 → 無需同步
        inSync.push(id);
      } else {
        pushPages.push({ id, reason: '僅存在本地', local });
      }
    } else if (!local && remote) {
      if (remote.deletedAt) {
        // 遠端建立後又刪除，本地從未出現過 → 無需同步
        inSync.push(id);
      } else {
        pullPages.push({ id, reason: '僅存在遠端', remote });
      }
    } else {
      // 兩端都有記錄
      const localDeleted = !!local.deletedAt;
      const remoteDeleted = !!remote.deletedAt;

      if (localDeleted && remoteDeleted) {
        // 兩端都已刪除 → 視為同步
        inSync.push(id);
      } else if (localDeleted && !remoteDeleted) {
        // 本地已刪除、遠端還在 → 比較刪除時間與遠端更新時間
        const deleteWinner = compareTimestamps(
          local.deletedAt,
          remote.updatedAt
        );
        if (deleteWinner === 'local' || deleteWinner === 'same') {
          // 本地刪除時間較新或相同 → 傳播刪除到遠端
          deleteOnRemote.push({
            id,
            reason: `本地已刪除 (${fmtTime(local.deletedAt)})`,
            local,
            remote,
          });
        } else {
          // 遠端在本地刪除後有更新 → 衝突，保留遠端版本恢復本地
          pullPages.push({
            id,
            reason: `遠端在刪除後有更新 (${fmtTime(remote.updatedAt)} > 刪除 ${fmtTime(local.deletedAt)})`,
            local,
            remote,
          });
        }
      } else if (!localDeleted && remoteDeleted) {
        // 遠端已刪除、本地還在 → 比較刪除時間與本地更新時間
        const deleteWinner = compareTimestamps(
          remote.deletedAt,
          local.updatedAt
        );
        if (deleteWinner === 'local' || deleteWinner === 'same') {
          // 遠端刪除時間較新或相同 → 傳播刪除到本地
          deleteOnLocal.push({
            id,
            reason: `遠端已刪除 (${fmtTime(remote.deletedAt)})`,
            local,
            remote,
          });
        } else {
          // 本地在遠端刪除後有更新 → 衝突，保留本地版本推送到遠端
          pushPages.push({
            id,
            reason: `本地在刪除後有更新 (${fmtTime(local.updatedAt)} > 刪除 ${fmtTime(remote.deletedAt)})`,
            local,
            remote,
          });
        }
      } else {
        // 兩端都未刪除 → 比較 updated_at
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
  }

  return {
    pushPages,
    pullPages,
    deleteOnRemote,
    deleteOnLocal,
    conflicts,
    inSync,
  };
}

// === 同步執行 ===

async function executePush(pages, area) {
  // 按 depth 排序，確保父頁面先於子頁面建立（避免 FK 約束失敗）
  const sorted = [...pages].sort((a, b) => {
    const da = a.local?.depth ?? a.id.split('/').length - 1;
    const db = b.local?.depth ?? b.id.split('/').length - 1;
    return da - db;
  });
  let ok = 0;
  let fail = 0;
  for (const entry of sorted) {
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
    const result = await putPage(REMOTE_API, fullPage);
    if (result.ok) {
      console.log(`  ↑ ${entry.id}`);
      ok++;
    } else {
      console.log(`  ✗ 推送失敗 ${entry.id}：${result.error}`);
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
    const result = await putPage(LOCAL_API, fullPage);
    if (result.ok) {
      console.log(`  ↓ ${entry.id}`);
      ok++;
    } else {
      console.log(`  ✗ 拉取失敗 ${entry.id}：${result.error}`);
      fail++;
    }
  }
  return { ok, fail };
}

/** 對目標端執行軟刪除（透過 DELETE 端點） */
async function executeDelete(pages, area, targetApi) {
  let ok = 0;
  let fail = 0;
  for (const entry of pages) {
    const slug =
      entry.local?.slug ||
      entry.remote?.slug ||
      entry.id.replace(`${area}/`, '');
    if (DRY_RUN) {
      console.log(
        `  🗑 [dry-run] 會刪除 ${entry.id} (${targetApi === REMOTE_API ? '遠端' : '本地'})`
      );
      ok++;
      continue;
    }
    try {
      const res = await fetch(`${targetApi}/api/content/${area}/${slug}`, {
        method: 'DELETE',
        headers: authHeaders(targetApi),
      });
      if (res.ok) {
        console.log(
          `  🗑 ${entry.id} (${targetApi === REMOTE_API ? '遠端' : '本地'})`
        );
        ok++;
      } else {
        console.log(`  ✗ 刪除失敗 ${entry.id}`);
        fail++;
      }
    } catch {
      console.log(`  ✗ 刪除失敗 ${entry.id}`);
      fail++;
    }
  }
  return { ok, fail };
}

/** 呼叫 purge 端點清除過期的軟刪除記錄 */
async function executePurge(apiBase, days) {
  try {
    const res = await fetch(`${apiBase}/api/content/purge?days=${days}`, {
      method: 'POST',
      headers: authHeaders(apiBase),
    });
    const json = await safeJson(res);
    return json?.ok ? json.data : null;
  } catch {
    return null;
  }
}

// === 主程式 ===

async function main() {
  console.log('\n🔄 內容同步工具');
  console.log(`   本地: ${LOCAL_API}`);
  console.log(`   遠端: ${REMOTE_API}`);
  console.log(
    `   模式: ${PURGE_MODE ? `清除軟刪除 (${PURGE_DAYS} 天)` : DRY_RUN ? 'dry-run' : DIRECTION === 'pull' ? '拉取 (遠端→本地)' : DIRECTION === 'push' ? '推送 (本地→遠端)' : '互動模式'}`
  );
  console.log(`   區域: ${TARGET_AREAS.join(', ')}\n`);

  // 本地 API 健檢
  const localOk = await checkLocalApi(LOCAL_API);
  if (!localOk) {
    console.error(
      '❌ 無法連線到本地 content-api (localhost:8788)，請確認 dev server 正在運行：'
    );
    console.error('   pnpm --filter content-api-worker dev\n');
    process.exit(1);
  }

  // 遠端 API 健檢
  const remoteStatus = await checkRemoteApi(REMOTE_API);
  if (remoteStatus === 'unreachable') {
    console.error('⚠️  無法連線到遠端 API，將只顯示本地資料\n');
  } else if (remoteStatus === 'bad_format') {
    console.error(
      '⚠️  遠端 API 回傳非 JSON 格式（可能是 Cloudflare 錯誤頁面），部分操作可能失敗\n'
    );
  }

  // 認證：優先使用 SYNC_REMOTE_TOKEN（由 sync.mjs 統一登入後傳入）
  if (!DRY_RUN) {
    const envToken = process.env.SYNC_REMOTE_TOKEN;
    if (envToken) {
      // 透過 dispatcher 執行，直接使用傳入的 token
      remoteToken = envToken;
    } else {
      // 獨立執行，自行登入
      const result = await login(REMOTE_API);
      if (!result) {
        console.error('❌ 認證失敗，無法繼續同步\n');
        process.exit(1);
      }
      remoteToken = result.token;
    }
  }

  // === Purge 模式：只清除兩端的過期軟刪除記錄 ===
  if (PURGE_MODE) {
    console.log(`🗑  清除超過 ${PURGE_DAYS} 天的軟刪除記錄...\n`);

    if (DRY_RUN) {
      console.log('   [dry-run] 不會實際執行清除\n');
    } else {
      console.log('   清除本地...');
      const localResult = await executePurge(LOCAL_API, PURGE_DAYS);
      if (localResult) {
        console.log(
          `   ✓ 本地清除 ${localResult.purged} 筆記錄 (截止: ${fmtTime(localResult.cutoffDate)})`
        );
      } else {
        console.log('   ✗ 本地清除失敗');
      }

      console.log('   清除遠端...');
      const remoteResult = await executePurge(REMOTE_API, PURGE_DAYS);
      if (remoteResult) {
        console.log(
          `   ✓ 遠端清除 ${remoteResult.purged} 筆記錄 (截止: ${fmtTime(remoteResult.cutoffDate)})`
        );
      } else {
        console.log('   ✗ 遠端清除失敗');
      }

      // 清除 R2 資產刪除紀錄
      console.log('\n   清除 R2 資產刪除紀錄...');
      for (const [label, api] of [
        ['本地', LOCAL_API],
        ['遠端', REMOTE_API],
      ]) {
        try {
          const res = await fetch(
            `${api}/api/assets/deleted/purge?days=${PURGE_DAYS}`,
            {
              method: 'POST',
              headers: authHeaders(api),
            }
          );
          const json = await safeJson(res);
          if (json?.ok) {
            console.log(`   ✓ ${label}清除 ${json.data.purged} 筆 R2 刪除紀錄`);
          } else {
            console.log(`   ✗ ${label} R2 刪除紀錄清除失敗`);
          }
        } catch {
          console.log(`   ✗ ${label} R2 刪除紀錄清除失敗`);
        }
      }
    }

    console.log('\n' + '─'.repeat(40));
    console.log('✅ 清除完成！\n');
    return;
  }

  let totalPush = 0;
  let totalPull = 0;
  let totalDelete = 0;
  let totalSkip = 0;

  for (const area of TARGET_AREAS) {
    // 取得兩端的頁面清單
    const [localPages, remotePages] = await Promise.all([
      listPages(LOCAL_API, area),
      listPages(REMOTE_API, area),
    ]);

    if (localPages.length === 0 && remotePages.length === 0) continue;

    const localActive = localPages.filter((p) => !p.deletedAt).length;
    const localDeleted = localPages.length - localActive;
    const remoteActive = remotePages.filter((p) => !p.deletedAt).length;
    const remoteDeleted = remotePages.length - remoteActive;
    const localInfo =
      localDeleted > 0
        ? `${localActive} 頁 + ${localDeleted} 已刪除`
        : `${localActive} 頁`;
    const remoteInfo =
      remoteDeleted > 0
        ? `${remoteActive} 頁 + ${remoteDeleted} 已刪除`
        : `${remoteActive} 頁`;
    console.log(`📂 ${area}  (本地: ${localInfo} / 遠端: ${remoteInfo})`);

    const { pushPages, pullPages, deleteOnRemote, deleteOnLocal, inSync } =
      buildDiff(localPages, remotePages);

    const hasChanges =
      pushPages.length > 0 ||
      pullPages.length > 0 ||
      deleteOnRemote.length > 0 ||
      deleteOnLocal.length > 0;

    if (!hasChanges) {
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
    if (deleteOnRemote.length > 0) {
      console.log(`\n   🗑 傳播刪除到遠端 (${deleteOnRemote.length} 頁):`);
      for (const p of deleteOnRemote) {
        console.log(`     ${p.id}  — ${p.reason}`);
      }
    }
    if (deleteOnLocal.length > 0) {
      console.log(`\n   🗑 傳播刪除到本地 (${deleteOnLocal.length} 頁):`);
      for (const p of deleteOnLocal) {
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
    let doDeleteRemote = deleteOnRemote;
    let doDeleteLocal = deleteOnLocal;

    if (DIRECTION === 'pull') {
      // 拉取模式：只拉取，不推送；刪除也只傳播到本地
      doPush = [];
      doPull = [...pullPages, ...pushPages];
      doDeleteRemote = [];
    } else if (DIRECTION === 'push') {
      // 推送模式：只推送，不拉取；刪除也只傳播到遠端
      doPush = [...pushPages, ...pullPages];
      doPull = [];
      doDeleteLocal = [];
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
        doDeleteLocal = [];
      } else if (answer === 'pull') {
        doPush = [];
        doDeleteRemote = [];
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
    if (doDeleteRemote.length > 0) {
      console.log(`   傳播刪除到遠端 ${doDeleteRemote.length} 頁...`);
      const result = await executeDelete(doDeleteRemote, area, REMOTE_API);
      totalDelete += result.ok;
    }
    if (doDeleteLocal.length > 0) {
      console.log(`   傳播刪除到本地 ${doDeleteLocal.length} 頁...`);
      const result = await executeDelete(doDeleteLocal, area, LOCAL_API);
      totalDelete += result.ok;
    }
    totalSkip += inSync.length;

    console.log();
  }

  // === R2 資產同步 ===
  await syncAssets();

  // === 首頁同步 ===
  if (!SKIP_HOMEPAGE) {
    await syncHomepage();
  }

  // 總結
  console.log('─'.repeat(40));
  console.log(
    `✅ 完成！ ↑推送: ${totalPush}  ↓拉取: ${totalPull}  🗑刪除: ${totalDelete}  =同步: ${totalSkip}`
  );
  console.log();
}

// === R2 資產同步 ===

/** 列出 R2 資產 keys */
async function listAssets(apiBase) {
  try {
    const res = await fetch(`${apiBase}/api/assets`, {
      headers: authHeaders(apiBase),
    });
    if (!res.ok) return [];
    const json = await safeJson(res);
    return json?.ok ? (json.data?.items || []).map((i) => i.key) : [];
  } catch {
    return [];
  }
}

/** 列出已刪除的資產紀錄 */
async function listDeletedAssets(apiBase) {
  try {
    const res = await fetch(`${apiBase}/api/assets/deleted`, {
      headers: authHeaders(apiBase),
    });
    if (!res.ok) return [];
    const json = await safeJson(res);
    return json?.ok ? json.data || [] : [];
  } catch {
    return [];
  }
}

/** 在目標端記錄刪除紀錄（不實際刪除 R2，用於傳播刪除狀態） */
async function recordDeletions(apiBase, keys) {
  if (keys.length === 0) return;
  try {
    await fetch(`${apiBase}/api/assets/deleted/record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(apiBase),
      },
      body: JSON.stringify({ keys }),
    });
  } catch {
    // 靜默失敗
  }
}

/** 從來源下載檔案並上傳到目標（保留原始 key） */
async function transferAsset(fromBase, toBase, key) {
  try {
    const res = await fetch(
      `${fromBase}/api/assets/${encodeURIComponent(key)}`,
      { headers: authHeaders(fromBase) }
    );
    if (!res.ok) return false;
    const contentType =
      res.headers.get('content-type') || 'application/octet-stream';
    const blob = await res.blob();
    const fileName = key.split('/').pop() || key;
    const form = new FormData();
    form.append('file', new File([blob], fileName, { type: contentType }));
    form.append('key', key);
    const upload = await fetch(`${toBase}/api/assets`, {
      method: 'POST',
      headers: authHeaders(toBase),
      body: form,
    });
    if (!upload.ok) return false;
    const json = await safeJson(upload);
    return json?.ok ?? false;
  } catch {
    return false;
  }
}

/** 刪除目標端的 R2 資產 */
async function deleteAsset(apiBase, key) {
  try {
    const res = await fetch(
      `${apiBase}/api/assets/${encodeURIComponent(key)}`,
      {
        method: 'DELETE',
        headers: authHeaders(apiBase),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function syncAssets() {
  const [localKeys, remoteKeys, localDeleted, remoteDeleted] =
    await Promise.all([
      listAssets(LOCAL_API),
      listAssets(REMOTE_API),
      listDeletedAssets(LOCAL_API),
      listDeletedAssets(REMOTE_API),
    ]);

  if (
    localKeys.length === 0 &&
    remoteKeys.length === 0 &&
    localDeleted.length === 0 &&
    remoteDeleted.length === 0
  )
    return;

  const localSet = new Set(localKeys);
  const remoteSet = new Set(remoteKeys);
  const localDeletedSet = new Set(localDeleted.map((d) => d.key));
  const remoteDeletedSet = new Set(remoteDeleted.map((d) => d.key));

  const toPush = []; // 本地有、遠端沒有、且遠端沒有刪除紀錄 → 推送
  const toPull = []; // 遠端有、本地沒有、且本地沒有刪除紀錄 → 拉取
  const deleteOnRemote = []; // 本地有刪除紀錄、遠端還存在 → 傳播刪除
  const deleteOnLocal = []; // 遠端有刪除紀錄、本地還存在 → 傳播刪除
  const inSync = localKeys.filter((k) => remoteSet.has(k));

  // 本地有、遠端沒有
  for (const key of localKeys) {
    if (remoteSet.has(key)) continue;
    if (remoteDeletedSet.has(key)) {
      // 遠端曾經刪除過 → 傳播刪除到本地
      deleteOnLocal.push(key);
    } else {
      toPush.push(key);
    }
  }

  // 遠端有、本地沒有
  for (const key of remoteKeys) {
    if (localSet.has(key)) continue;
    if (localDeletedSet.has(key)) {
      // 本地曾經刪除過 → 傳播刪除到遠端
      deleteOnRemote.push(key);
    } else {
      toPull.push(key);
    }
  }

  const hasChanges =
    toPush.length > 0 ||
    toPull.length > 0 ||
    deleteOnRemote.length > 0 ||
    deleteOnLocal.length > 0;

  console.log(
    `\n🗂️  R2 資產  (本地: ${localKeys.length} / 遠端: ${remoteKeys.length})`
  );

  if (!hasChanges) {
    console.log(`   ✓ 完全同步 (${inSync.length} 個檔案)\n`);
    return;
  }

  if (toPush.length > 0) console.log(`   ↑ 需推送: ${toPush.length} 個`);
  if (toPull.length > 0) console.log(`   ↓ 需拉取: ${toPull.length} 個`);
  if (deleteOnRemote.length > 0)
    console.log(`   🗑 傳播刪除到遠端: ${deleteOnRemote.length} 個`);
  if (deleteOnLocal.length > 0)
    console.log(`   🗑 傳播刪除到本地: ${deleteOnLocal.length} 個`);
  if (inSync.length > 0) console.log(`   = 已同步: ${inSync.length} 個`);
  console.log();

  // 決定方向
  let doPush = toPush;
  let doPull = toPull;
  let doDeleteRemote = deleteOnRemote;
  let doDeleteLocal = deleteOnLocal;

  if (DIRECTION === 'pull') {
    doPush = [];
    doDeleteRemote = [];
  } else if (DIRECTION === 'push') {
    doPull = [];
    doDeleteLocal = [];
  } else if (!DRY_RUN && hasChanges) {
    const answer = await ask(
      `   同步 R2 資產？ [y] 全部 / [push] 只推送 / [pull] 只拉取 / [n] 跳過: `
    );
    if (answer === 'n' || answer === 'no') {
      console.log('   ⏭ 跳過\n');
      return;
    }
    if (answer === 'push') {
      doPull = [];
      doDeleteLocal = [];
    }
    if (answer === 'pull') {
      doPush = [];
      doDeleteRemote = [];
    }
  }

  // 推送
  if (doPush.length > 0) {
    console.log(`   推送 ${doPush.length} 個檔案到遠端...`);
    for (const key of doPush) {
      if (DRY_RUN) {
        console.log(`  → [dry-run] ${key}`);
        continue;
      }
      const ok = await transferAsset(LOCAL_API, REMOTE_API, key);
      console.log(ok ? `  ↑ ${key}` : `  ✗ 推送失敗 ${key}`);
    }
  }

  // 拉取
  if (doPull.length > 0) {
    console.log(`   拉取 ${doPull.length} 個檔案到本地...`);
    for (const key of doPull) {
      if (DRY_RUN) {
        console.log(`  ← [dry-run] ${key}`);
        continue;
      }
      const ok = await transferAsset(REMOTE_API, LOCAL_API, key);
      console.log(ok ? `  ↓ ${key}` : `  ✗ 拉取失敗 ${key}`);
    }
  }

  // 傳播刪除到遠端
  if (doDeleteRemote.length > 0) {
    console.log(`   傳播刪除到遠端 ${doDeleteRemote.length} 個檔案...`);
    for (const key of doDeleteRemote) {
      if (DRY_RUN) {
        console.log(`  🗑 [dry-run] 遠端 ${key}`);
        continue;
      }
      const ok = await deleteAsset(REMOTE_API, key);
      console.log(ok ? `  🗑 遠端 ${key}` : `  ✗ 刪除失敗 ${key}`);
    }
  }

  // 傳播刪除到本地
  if (doDeleteLocal.length > 0) {
    console.log(`   傳播刪除到本地 ${doDeleteLocal.length} 個檔案...`);
    for (const key of doDeleteLocal) {
      if (DRY_RUN) {
        console.log(`  🗑 [dry-run] 本地 ${key}`);
        continue;
      }
      const ok = await deleteAsset(LOCAL_API, key);
      console.log(ok ? `  🗑 本地 ${key}` : `  ✗ 刪除失敗 ${key}`);
    }
  }

  console.log();
}

// === 首頁同步 ===

/** 從 API 取得首頁全部 section 資料 */
async function fetchHomepage(apiBase) {
  try {
    const res = await fetch(`${apiBase}/api/homepage`);
    if (!res.ok) return {};
    const json = await safeJson(res);
    return json?.ok ? json.data || {} : {};
  } catch {
    return {};
  }
}

/** 寫入單一首頁 section（保留來源時間戳） */
async function putHomepageSection(apiBase, sectionId, content, updatedAt) {
  try {
    const res = await fetch(`${apiBase}/api/homepage/${sectionId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(apiBase),
      },
      body: JSON.stringify({ content, updatedAt }),
    });
    if (!res.ok) return false;
    const json = await safeJson(res);
    return json?.ok ?? false;
  } catch {
    return false;
  }
}

async function syncHomepage() {
  const [localData, remoteData] = await Promise.all([
    fetchHomepage(LOCAL_API),
    fetchHomepage(REMOTE_API),
  ]);

  const allSections = new Set([
    ...Object.keys(localData),
    ...Object.keys(remoteData),
  ]);

  if (allSections.size === 0) return;

  const toPush = []; // 本地較新或僅本地
  const toPull = []; // 遠端較新或僅遠端
  const inSync = [];

  for (const sid of allSections) {
    const local = localData[sid];
    const remote = remoteData[sid];

    if (local && !remote) {
      toPush.push({ sid, reason: '僅存在本地', local });
    } else if (!local && remote) {
      toPull.push({ sid, reason: '僅存在遠端', remote });
    } else {
      const winner = compareTimestamps(local.updatedAt, remote.updatedAt);
      if (winner === 'local') {
        toPush.push({
          sid,
          reason: `本地較新 (${fmtTime(local.updatedAt)} > ${fmtTime(remote.updatedAt)})`,
          local,
        });
      } else if (winner === 'remote') {
        toPull.push({
          sid,
          reason: `遠端較新 (${fmtTime(remote.updatedAt)} > ${fmtTime(local.updatedAt)})`,
          remote,
        });
      } else {
        inSync.push(sid);
      }
    }
  }

  const hasChanges = toPush.length > 0 || toPull.length > 0;

  console.log(
    `\n🏠 首頁  (本地: ${Object.keys(localData).length} sections / 遠端: ${Object.keys(remoteData).length} sections)`
  );

  if (!hasChanges) {
    console.log(`   ✓ 完全同步 (${inSync.length} sections)\n`);
    return;
  }

  if (toPush.length > 0) {
    console.log(`\n   ↑ 本地較新 / 僅本地 (${toPush.length} sections):`);
    for (const p of toPush) console.log(`     ${p.sid}  — ${p.reason}`);
  }
  if (toPull.length > 0) {
    console.log(`\n   ↓ 遠端較新 / 僅遠端 (${toPull.length} sections):`);
    for (const p of toPull) console.log(`     ${p.sid}  — ${p.reason}`);
  }
  if (inSync.length > 0) {
    console.log(`\n   = 已同步: ${inSync.length} sections`);
  }
  console.log();

  // 決定方向
  let doPush = toPush;
  let doPull = toPull;

  if (DIRECTION === 'pull') {
    doPush = [];
  } else if (DIRECTION === 'push') {
    doPull = [];
  } else if (!DRY_RUN && hasChanges) {
    const answer = await ask(
      `   同步首頁？ [y] 全部 / [push] 只推送 / [pull] 只拉取 / [n] 跳過: `
    );
    if (answer === 'n' || answer === 'no') {
      console.log('   ⏭ 跳過\n');
      return;
    }
    if (answer === 'push') doPull = [];
    if (answer === 'pull') doPush = [];
  }

  // 推送
  if (doPush.length > 0) {
    console.log(`   推送 ${doPush.length} sections 到遠端...`);
    for (const entry of doPush) {
      const src = entry.local || localData[entry.sid];
      if (DRY_RUN) {
        console.log(`  → [dry-run] 會推送 ${entry.sid}`);
        continue;
      }
      const ok = await putHomepageSection(
        REMOTE_API,
        entry.sid,
        src.content,
        src.updatedAt
      );
      console.log(ok ? `  ↑ ${entry.sid}` : `  ✗ 推送失敗 ${entry.sid}`);
    }
  }

  // 拉取
  if (doPull.length > 0) {
    console.log(`   拉取 ${doPull.length} sections 到本地...`);
    for (const entry of doPull) {
      const src = entry.remote || remoteData[entry.sid];
      if (DRY_RUN) {
        console.log(`  ← [dry-run] 會拉取 ${entry.sid}`);
        continue;
      }
      const ok = await putHomepageSection(
        LOCAL_API,
        entry.sid,
        src.content,
        src.updatedAt
      );
      console.log(ok ? `  ↓ ${entry.sid}` : `  ✗ 拉取失敗 ${entry.sid}`);
    }
  }

  console.log();
}

main().catch((e) => {
  console.error('❌ 錯誤:', e.message);
  process.exit(1);
});
