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
 */

import { createInterface } from 'readline';

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
const AREA_FLAG = args.indexOf('--area');
const TARGET_AREAS =
  AREA_FLAG !== -1 && args[AREA_FLAG + 1] ? [args[AREA_FLAG + 1]] : ALL_AREAS;

// === 工具函式 ===

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
  return ts
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '')
    .slice(0, 19);
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

// === 認證 ===

/** 遠端 JWT token（登入後設定）*/
let remoteToken = null;

/** 提示輸入（不顯示密碼） */
function askPassword(question) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // 嘗試隱藏密碼輸入
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    let pwd = '';
    const onData = (ch) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        if (stdin.setRawMode) stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(pwd);
      } else if (c === '\u007f' || c === '\b') {
        if (pwd.length > 0) {
          pwd = pwd.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c.charCodeAt(0) >= 32) {
        pwd += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
    stdin.resume();
  });
}

/** 登入遠端 API 取得 JWT */
async function loginRemote() {
  console.log('🔐 需要登入遠端 API 以同步 R2 資產\n');
  const username = await ask('   帳號: ');
  const password = await askPassword('   密碼: ');

  try {
    const res = await fetch(`${REMOTE_API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = await safeJson(res);
    if (json?.ok && json.data?.token) {
      remoteToken = json.data.token;
      console.log(`   ✓ 登入成功 (${json.data.display_name || username})\n`);
      return true;
    } else {
      console.log(`   ✗ 登入失敗: ${json?.error || '未知錯誤'}\n`);
      return false;
    }
  } catch (e) {
    console.log(`   ✗ 連線錯誤: ${e.message}\n`);
    return false;
  }
}

/** 為請求加上認證 header */
function authHeaders(apiBase) {
  if (apiBase === REMOTE_API && remoteToken) {
    return { Authorization: `Bearer ${remoteToken}` };
  }
  return {};
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
  const statusFix = []; // 內容一致但 status 不正確，需修正為 synced
  const conflicts = []; // 無法自動判斷
  const inSync = []; // 兩端一致

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (local && !remote) {
      // 本地有、遠端完全不存在 → 推送
      pushPages.push({ id, reason: '僅存在本地', local });
    } else if (!local && remote) {
      // 遠端有、本地完全不存在 → 拉取
      pullPages.push({ id, reason: '僅存在遠端', remote });
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
          // 時間戳一致，但檢查 status 是否需要修正
          const needsFix =
            (local.status !== 'synced' && local.sourceFile) ||
            (remote.status !== 'synced' && remote.sourceFile);
          if (needsFix) {
            statusFix.push({
              id,
              reason: `狀態修正 (${local.status}/${remote.status} → synced)`,
              local,
              remote,
            });
          } else {
            inSync.push(id);
          }
        }
      }
    }
  }

  return {
    pushPages,
    pullPages,
    deleteOnRemote,
    deleteOnLocal,
    statusFix,
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

/** 修正兩端的 status 為 synced（只更新 status，不動內容） */
async function executeStatusFix(pages, area) {
  let ok = 0;
  let fail = 0;
  for (const entry of pages) {
    const slug = entry.local?.slug || entry.id.replace(`${area}/`, '');
    if (DRY_RUN) {
      console.log(`  🔧 [dry-run] 會修正 ${entry.id} 狀態`);
      ok++;
      continue;
    }
    // 對兩端都送 PUT，只帶 status
    for (const api of [LOCAL_API, REMOTE_API]) {
      try {
        const res = await fetch(`${api}/api/content/${area}/${slug}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders(api),
          },
          body: JSON.stringify({ status: 'synced' }),
        });
        if (!res.ok) {
          console.log(
            `  ✗ 修正失敗 ${entry.id} (${api === REMOTE_API ? '遠端' : '本地'})`
          );
        }
      } catch {
        console.log(
          `  ✗ 修正失敗 ${entry.id} (${api === REMOTE_API ? '遠端' : '本地'})`
        );
      }
    }
    console.log(`  🔧 ${entry.id}`);
    ok++;
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
      console.error(
        '⚠️  遠端 API 回傳非 JSON 格式（可能是 Cloudflare 錯誤頁面），部分操作可能失敗'
      );
    }
  } catch {
    console.error('⚠️  無法連線到遠端 API，將只顯示本地資料\n');
  }

  // 登入遠端（R2 資產同步和寫入操作需要）
  if (!DRY_RUN) {
    const loggedIn = await loginRemote();
    if (!loggedIn) {
      console.log('   繼續同步但 R2 資產將無法存取\n');
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

    const {
      pushPages,
      pullPages,
      deleteOnRemote,
      deleteOnLocal,
      statusFix,
      inSync,
    } = buildDiff(localPages, remotePages);

    const hasChanges =
      pushPages.length > 0 ||
      pullPages.length > 0 ||
      deleteOnRemote.length > 0 ||
      deleteOnLocal.length > 0 ||
      statusFix.length > 0;

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
    if (statusFix.length > 0) {
      console.log(`\n   🔧 狀態修正 (${statusFix.length} 頁):`);
      for (const p of statusFix) {
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
    // 狀態修正不受方向控制，一律執行
    if (statusFix.length > 0) {
      console.log(`   修正 ${statusFix.length} 頁狀態為 synced...`);
      const result = await executeStatusFix(statusFix, area);
      totalSkip += result.ok;
    }
    totalSkip += inSync.length;

    console.log();
  }

  // === R2 資產同步 ===
  await syncAssets();

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

async function syncAssets() {
  const [localKeys, remoteKeys] = await Promise.all([
    listAssets(LOCAL_API),
    listAssets(REMOTE_API),
  ]);

  if (localKeys.length === 0 && remoteKeys.length === 0) return;

  const localSet = new Set(localKeys);
  const remoteSet = new Set(remoteKeys);

  const toPush = localKeys.filter((k) => !remoteSet.has(k));
  const toPull = remoteKeys.filter((k) => !localSet.has(k));
  const inSync = localKeys.filter((k) => remoteSet.has(k));

  if (toPush.length === 0 && toPull.length === 0) {
    console.log(
      `\n🗂️  R2 資產  (本地: ${localKeys.length} / 遠端: ${remoteKeys.length})`
    );
    console.log(`   ✓ 完全同步 (${inSync.length} 個檔案)\n`);
    return;
  }

  console.log(
    `\n🗂️  R2 資產  (本地: ${localKeys.length} / 遠端: ${remoteKeys.length})`
  );
  if (toPush.length > 0) console.log(`   ↑ 需推送: ${toPush.length} 個`);
  if (toPull.length > 0) console.log(`   ↓ 需拉取: ${toPull.length} 個`);
  if (inSync.length > 0) console.log(`   = 已同步: ${inSync.length} 個`);
  console.log();

  // 決定方向
  let doPush = toPush;
  let doPull = toPull;

  if (DIRECTION === 'pull') {
    doPush = [];
  } else if (DIRECTION === 'push') {
    doPull = [];
  } else if (!DRY_RUN && (toPush.length > 0 || toPull.length > 0)) {
    const answer = await ask(
      `   同步 R2 資產？ [y] 全部 / [push] 只推送 / [pull] 只拉取 / [n] 跳過: `
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

  console.log();
}

main().catch((e) => {
  console.error('❌ 錯誤:', e.message);
  process.exit(1);
});
