/**
 * 主站（apps/root）雙向同步工具：本地 D1 ↔ 遠端 D1 + 圖片 → R2
 *
 * 使用方式：
 *   node scripts/sync-root.mjs                    # 互動模式
 *   node scripts/sync-root.mjs --push             # 本地→遠端
 *   node scripts/sync-root.mjs --pull             # 遠端→本地
 *   node scripts/sync-root.mjs --dry-run          # 只顯示差異
 *   node scripts/sync-root.mjs --only projects    # 只同步指定集合
 *   node scripts/sync-root.mjs --skip-images      # 跳過圖片同步
 *   node scripts/sync-root.mjs --images-only      # 只同步圖片
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
import { resolveWriteToken, getAuthHeaders } from './sync-auth.mjs';

// === 設定 ===
const LOCAL_API = 'http://localhost:8788';
const REMOTE_API = 'https://eternity-content-api.ptyc4076.workers.dev';
const COLLECTIONS = ['projects', 'links', 'updates'];
const SINGLETONS = [
  'homepage-zh',
  'homepage-en',
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
const CARD_KEYS = [
  'card-quote',
  'card-music',
  'card-quick-stats',
  'card-table-of-contents',
  'card-visitor-counter',
  'card-latest-update',
  'card-portal',
  'card-status',
  'card-uep',
];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DIRECTION = args.includes('--pull')
  ? 'pull'
  : args.includes('--push')
    ? 'push'
    : null;
const SKIP_IMAGES = args.includes('--skip-images');
const IMAGES_ONLY = args.includes('--images-only');
const ONLY_FLAG = args.indexOf('--only');
const ONLY_COLLECTION = ONLY_FLAG !== -1 ? args[ONLY_FLAG + 1] : null;

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

function stableJson(value) {
  if (Array.isArray(value)) {
    return value.map(stableJson);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableJson(item)])
    );
  }

  return value;
}

function sameJsonContent(a, b) {
  return JSON.stringify(stableJson(a)) === JSON.stringify(stableJson(b));
}

// === 集合同步 ===

async function listCollection(apiBase, collection) {
  try {
    const res = await fetch(
      `${apiBase}/api/root/${collection}?include_deleted=true`,
      { headers: authHeaders(apiBase) }
    );
    if (!res.ok) return [];
    const json = await safeJson(res);
    return json?.ok ? json.data || [] : [];
  } catch {
    return [];
  }
}

async function getItem(apiBase, collection, id) {
  try {
    const res = await fetch(
      `${apiBase}/api/root/${collection}/${encodeURIComponent(id)}`,
      { headers: authHeaders(apiBase) }
    );
    if (!res.ok) return null;
    const json = await safeJson(res);
    return json?.ok ? json.data : null;
  } catch {
    return null;
  }
}

async function putItem(apiBase, collection, id, body) {
  try {
    const res = await fetch(
      `${apiBase}/api/root/${collection}/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(apiBase),
        },
        body: JSON.stringify(body),
      }
    );
    const json = await safeJson(res);
    return json?.ok ?? false;
  } catch {
    return false;
  }
}

async function deleteItem(apiBase, collection, id) {
  try {
    const res = await fetch(
      `${apiBase}/api/root/${collection}/${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: authHeaders(apiBase) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function syncCollection(name) {
  const [localItems, remoteItems] = await Promise.all([
    listCollection(LOCAL_API, name),
    listCollection(REMOTE_API, name),
  ]);

  const localMap = new Map(localItems.map((i) => [i.id, i]));
  const remoteMap = new Map(remoteItems.map((i) => [i.id, i]));
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  const toPush = [];
  const toPull = [];
  const deleteOnRemote = [];
  const deleteOnLocal = [];
  const inSync = [];

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (local && !remote) {
      if (local.deletedAt) {
        inSync.push(id); // 本地建後又刪，遠端從沒有 → 不處理
      } else {
        toPush.push({ id, reason: '僅存在本地' });
      }
    } else if (!local && remote) {
      if (remote.deletedAt) {
        inSync.push(id);
      } else {
        toPull.push({ id, reason: '僅存在遠端' });
      }
    } else {
      // 兩端都有
      const localDeleted = !!local.deletedAt;
      const remoteDeleted = !!remote.deletedAt;

      if (localDeleted && remoteDeleted) {
        inSync.push(id);
      } else if (localDeleted && !remoteDeleted) {
        const winner = compareTimestamps(local.deletedAt, remote.updatedAt);
        if (winner === 'local' || winner === 'same') {
          deleteOnRemote.push({
            id,
            reason: `本地已刪除 (${fmtTime(local.deletedAt)})`,
          });
        } else {
          toPull.push({ id, reason: `遠端在刪除後有更新` });
        }
      } else if (!localDeleted && remoteDeleted) {
        const winner = compareTimestamps(remote.deletedAt, local.updatedAt);
        if (winner === 'local' || winner === 'same') {
          deleteOnLocal.push({
            id,
            reason: `遠端已刪除 (${fmtTime(remote.deletedAt)})`,
          });
        } else {
          toPush.push({ id, reason: `本地在刪除後有更新` });
        }
      } else {
        const cmp = compareTimestamps(local.updatedAt, remote.updatedAt);
        if (cmp === 'local')
          toPush.push({ id, reason: `本地較新 (${fmtTime(local.updatedAt)})` });
        else if (cmp === 'remote')
          toPull.push({
            id,
            reason: `遠端較新 (${fmtTime(remote.updatedAt)})`,
          });
        else inSync.push(id);
      }
    }
  }

  const hasChanges =
    toPush.length +
      toPull.length +
      deleteOnRemote.length +
      deleteOnLocal.length >
    0;

  console.log(
    `\n📦 ${name}  (本地: ${localItems.length} / 遠端: ${remoteItems.length})`
  );

  if (!hasChanges) {
    console.log(`   ✓ 完全同步 (${inSync.length} 筆)`);
    return { push: 0, pull: 0 };
  }

  if (toPush.length > 0) {
    console.log(`   ↑ 需推送: ${toPush.length}`);
    toPush.forEach((p) => console.log(`     ${p.id} — ${p.reason}`));
  }
  if (toPull.length > 0) {
    console.log(`   ↓ 需拉取: ${toPull.length}`);
    toPull.forEach((p) => console.log(`     ${p.id} — ${p.reason}`));
  }
  if (deleteOnRemote.length > 0) {
    console.log(`   🗑 傳播刪除到遠端: ${deleteOnRemote.length}`);
    deleteOnRemote.forEach((p) => console.log(`     ${p.id} — ${p.reason}`));
  }
  if (deleteOnLocal.length > 0) {
    console.log(`   🗑 傳播刪除到本地: ${deleteOnLocal.length}`);
    deleteOnLocal.forEach((p) => console.log(`     ${p.id} — ${p.reason}`));
  }

  if (DRY_RUN) return { push: toPush.length, pull: toPull.length };

  let doPush = toPush.map((p) => p.id);
  let doPull = toPull.map((p) => p.id);
  let doDelRemote = deleteOnRemote.map((p) => p.id);
  let doDelLocal = deleteOnLocal.map((p) => p.id);

  if (DIRECTION === 'pull') {
    doPush = [];
    doDelRemote = [];
  } else if (DIRECTION === 'push') {
    doPull = [];
    doDelLocal = [];
  } else {
    const answer = await ask(
      `   同步 ${name}？ [y] 全部 / [push] / [pull] / [n] 跳過: `
    );
    if (answer === 'n') return { push: 0, pull: 0 };
    if (answer === 'push') {
      doPull = [];
      doDelLocal = [];
    }
    if (answer === 'pull') {
      doPush = [];
      doDelRemote = [];
    }
  }

  let pushOk = 0,
    pullOk = 0;

  // 過濾掉不應由呼叫端控制的 metadata 欄位
  const stripMeta = (item) => {
    const { createdAt, deletedAt, ...rest } = item;
    return rest;
  };

  for (const id of doPush) {
    const full = await getItem(LOCAL_API, name, id);
    if (!full) continue;
    const ok = await putItem(REMOTE_API, name, id, stripMeta(full));
    console.log(ok ? `   ↑ ${id} ✅` : `   ↑ ${id} ❌`);
    if (ok) pushOk++;
  }

  for (const id of doPull) {
    const full = await getItem(REMOTE_API, name, id);
    if (!full) continue;
    const ok = await putItem(LOCAL_API, name, id, stripMeta(full));
    console.log(ok ? `   ↓ ${id} ✅` : `   ↓ ${id} ❌`);
    if (ok) pullOk++;
  }

  for (const id of doDelRemote) {
    const ok = await deleteItem(REMOTE_API, name, id);
    console.log(ok ? `   🗑 遠端 ${id} ✅` : `   🗑 遠端 ${id} ❌`);
  }

  for (const id of doDelLocal) {
    const ok = await deleteItem(LOCAL_API, name, id);
    console.log(ok ? `   🗑 本地 ${id} ✅` : `   🗑 本地 ${id} ❌`);
  }

  return { push: pushOk, pull: pullOk };
}

// === Singleton 同步 ===

async function getSingleton(apiBase, key) {
  try {
    const res = await fetch(`${apiBase}/api/root/singletons/${key}`, {
      headers: authHeaders(apiBase),
    });
    if (!res.ok) return null;
    const json = await safeJson(res);
    return json?.ok ? json.data : null;
  } catch {
    return null;
  }
}

async function putSingleton(apiBase, key, content, updatedAt) {
  try {
    const res = await fetch(`${apiBase}/api/root/singletons/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiBase) },
      body: JSON.stringify({ content, updatedAt }),
    });
    const json = await safeJson(res);
    return json?.ok ?? false;
  } catch {
    return false;
  }
}

/**
 * 收集所有 singleton 的差異，不立即執行
 * 回傳 { toPush, toPull }（含詳細資訊）
 */
async function diffSingletons() {
  const toPush = [];
  const toPull = [];

  for (const key of SINGLETONS) {
    const [local, remote] = await Promise.all([
      getSingleton(LOCAL_API, key),
      getSingleton(REMOTE_API, key),
    ]);

    if (!local && !remote) continue;

    if (local && !remote) {
      toPush.push({ key, local, remote: null, reason: '只在本地' });
    } else if (!local && remote) {
      toPull.push({ key, local: null, remote, reason: '只在遠端' });
    } else {
      if (sameJsonContent(local.content, remote.content)) continue;

      const cmp = compareTimestamps(local.updatedAt, remote.updatedAt);
      if (cmp === 'local') {
        toPush.push({
          key,
          local,
          remote,
          reason: `本地: ${fmtTime(local.updatedAt)}  遠端: ${fmtTime(remote.updatedAt)}`,
        });
      } else if (cmp === 'remote') {
        toPull.push({
          key,
          local,
          remote,
          reason: `遠端: ${fmtTime(remote.updatedAt)}  本地: ${fmtTime(local.updatedAt)}`,
        });
      }
      // same → 忽略
    }
  }

  return { toPush, toPull };
}

async function syncSingletons() {
  const inSync = SINGLETONS.length - 0; // 先算總數，稍後扣除
  const { toPush, toPull } = await diffSingletons();
  const hasChanges = toPush.length > 0 || toPull.length > 0;
  const syncCount = SINGLETONS.length - toPush.length - toPull.length;

  // 摘要行（與 Collection 格式一致）
  console.log(`\n🏠 Singletons  (共 ${SINGLETONS.length} 個)`);

  if (!hasChanges) {
    console.log(`   ✓ 完全同步 (${SINGLETONS.length} 個)`);
    return { push: 0, pull: 0 };
  }

  if (toPush.length > 0) console.log(`   ↑ 需推送: ${toPush.length}`);
  if (toPull.length > 0) console.log(`   ↓ 需拉取: ${toPull.length}`);

  // 顯示逐筆差異
  for (const { key, reason } of toPush) {
    console.log(`     ↑ ${key}  ${reason}`);
  }
  for (const { key, reason } of toPull) {
    console.log(`     ↓ ${key}  ${reason}`);
  }

  if (DRY_RUN) return { push: toPush.length, pull: toPull.length };

  // 決定方向：互動模式下詢問使用者
  let doPush = toPush;
  let doPull = toPull;

  if (DIRECTION === 'pull') {
    doPush = [];
  } else if (DIRECTION === 'push') {
    doPull = [];
  } else {
    // 互動模式：詢問 singletons 的同步方向
    const answer = await ask(
      `   Singletons: [push] 推送 / [pull] 拉取 / [y] 雙向 / [skip] 跳過: `
    );
    if (answer === 'skip' || answer === 'n') {
      console.log('   ⏭ 跳過\n');
      return { push: 0, pull: 0 };
    }
    if (answer === 'push') doPull = [];
    if (answer === 'pull') doPush = [];
  }

  let pushOk = 0,
    pullOk = 0;

  for (const { key, local } of doPush) {
    const ok = await putSingleton(
      REMOTE_API,
      key,
      local.content,
      local.updatedAt
    );
    console.log(ok ? `   ↑ ${key} ✅` : `   ↑ ${key} ❌`);
    if (ok) pushOk++;
  }

  for (const { key, remote } of doPull) {
    const ok = await putSingleton(
      LOCAL_API,
      key,
      remote.content,
      remote.updatedAt
    );
    console.log(ok ? `   ↓ ${key} ✅` : `   ↓ ${key} ❌`);
    if (ok) pullOk++;
  }

  return { push: pushOk, pull: pullOk };
}

// === Cards 同步 ===

async function getCard(apiBase, key) {
  try {
    const res = await fetch(`${apiBase}/api/root/cards/${key}`, {
      headers: authHeaders(apiBase),
    });
    if (!res.ok) return null;
    const json = await safeJson(res);
    return json?.ok ? json.data : null;
  } catch {
    return null;
  }
}

async function putCard(apiBase, key, content, updatedAt) {
  try {
    const res = await fetch(`${apiBase}/api/root/cards/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiBase) },
      body: JSON.stringify({ content, updatedAt }),
    });
    const json = await safeJson(res);
    return json?.ok ?? false;
  } catch {
    return false;
  }
}

/**
 * 收集所有 card 的差異，不立即執行
 * 回傳 { toPush, toPull }
 */
async function diffCards() {
  const toPush = [];
  const toPull = [];
  const missing = [];

  for (const key of CARD_KEYS) {
    const [local, remote] = await Promise.all([
      getCard(LOCAL_API, key),
      getCard(REMOTE_API, key),
    ]);

    if (!local && !remote) {
      missing.push(key);
      continue;
    }

    if (local && !remote) {
      toPush.push({ key, local, remote: null, reason: '只在本地' });
    } else if (!local && remote) {
      toPull.push({ key, local: null, remote, reason: '只在遠端' });
    } else {
      if (sameJsonContent(local.content, remote.content)) continue;

      const cmp = compareTimestamps(local.updatedAt, remote.updatedAt);
      if (cmp === 'local') {
        toPush.push({
          key,
          local,
          remote,
          reason: `本地: ${fmtTime(local.updatedAt)}  遠端: ${fmtTime(remote.updatedAt)}`,
        });
      } else if (cmp === 'remote') {
        toPull.push({
          key,
          local,
          remote,
          reason: `遠端: ${fmtTime(remote.updatedAt)}  本地: ${fmtTime(local.updatedAt)}`,
        });
      }
    }
  }

  return { toPush, toPull, missing };
}

async function syncCards() {
  const { toPush, toPull, missing } = await diffCards();
  const hasChanges = toPush.length > 0 || toPull.length > 0;

  // 摘要行（與 Collection 格式一致）
  console.log(`\n🃏 Cards  (共 ${CARD_KEYS.length} 個)`);

  if (missing.length > 0) {
    console.log(`   ⚠️  預期 card 缺失: ${missing.length}`);
    missing.forEach((key) => console.log(`     ! ${key}`));
  }

  if (!hasChanges && missing.length === 0) {
    console.log(`   ✓ 完全同步 (${CARD_KEYS.length} 個)`);
    return { push: 0, pull: 0 };
  }

  if (!hasChanges) {
    return { push: 0, pull: 0 };
  }

  if (toPush.length > 0) console.log(`   ↑ 需推送: ${toPush.length}`);
  if (toPull.length > 0) console.log(`   ↓ 需拉取: ${toPull.length}`);

  // 顯示逐筆差異
  for (const { key, reason } of toPush) {
    console.log(`     ↑ ${key}  ${reason}`);
  }
  for (const { key, reason } of toPull) {
    console.log(`     ↓ ${key}  ${reason}`);
  }

  if (DRY_RUN) return { push: toPush.length, pull: toPull.length };

  // 決定方向：互動模式下詢問使用者
  let doPush = toPush;
  let doPull = toPull;

  if (DIRECTION === 'pull') {
    doPush = [];
  } else if (DIRECTION === 'push') {
    doPull = [];
  } else {
    // 互動模式：詢問 cards 的同步方向
    const answer = await ask(
      `   Cards: [push] 推送 / [pull] 拉取 / [y] 雙向 / [skip] 跳過: `
    );
    if (answer === 'skip' || answer === 'n') {
      console.log('   ⏭ 跳過\n');
      return { push: 0, pull: 0 };
    }
    if (answer === 'push') doPull = [];
    if (answer === 'pull') doPush = [];
  }

  let pushOk = 0,
    pullOk = 0;

  for (const { key, local } of doPush) {
    const ok = await putCard(REMOTE_API, key, local.content, local.updatedAt);
    console.log(ok ? `   ↑ ${key} ✅` : `   ↑ ${key} ❌`);
    if (ok) pushOk++;
  }

  for (const { key, remote } of doPull) {
    const ok = await putCard(LOCAL_API, key, remote.content, remote.updatedAt);
    console.log(ok ? `   ↓ ${key} ✅` : `   ↓ ${key} ❌`);
    if (ok) pullOk++;
  }

  return { push: pushOk, pull: pullOk };
}

// === R2 資產同步 (R2 ↔ R2) ===

/** 列出主站 R2 資產 keys */
async function listR2Keys(apiBase) {
  try {
    const res = await fetch(`${apiBase}/api/root/assets?limit=500`, {
      headers: authHeaders(apiBase),
    });
    if (!res.ok) return [];
    const json = await safeJson(res);
    const items = json?.ok ? json.data?.items || [] : [];
    return items.map((i) => i.key);
  } catch {
    return [];
  }
}

/** 列出主站已刪除的 R2 資產紀錄 */
async function listDeletedRootAssets(apiBase) {
  try {
    const res = await fetch(`${apiBase}/api/root/assets/deleted`, {
      headers: authHeaders(apiBase),
    });
    if (!res.ok) return [];
    const json = await safeJson(res);
    return json?.ok ? json.data || [] : [];
  } catch {
    return [];
  }
}

/** 在目標端記錄主站 R2 刪除紀錄（不實際刪除，用於傳播刪除狀態） */
async function recordRootDeletions(apiBase, keys) {
  if (keys.length === 0) return;
  try {
    await fetch(`${apiBase}/api/root/assets/deleted/record`, {
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

/** 清除主站 R2 過期刪除紀錄 */
async function purgeRootDeletedRecords(apiBase, days = 30) {
  try {
    const olderThan = new Date(Date.now() - days * 86400000).toISOString();
    const res = await fetch(`${apiBase}/api/root/assets/deleted/purge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(apiBase),
      },
      body: JSON.stringify({ olderThan }),
    });
    const json = await safeJson(res);
    return json?.ok ? json.data : null;
  } catch {
    return null;
  }
}

/** 從來源 R2 下載檔案並上傳到目標 R2（保留原始 key） */
async function transferRootAsset(fromBase, toBase, key) {
  try {
    const encoded = key
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    const res = await fetch(`${fromBase}/api/root/assets/${encoded}`, {
      headers: authHeaders(fromBase),
    });
    if (!res.ok) return false;
    const contentType =
      res.headers.get('content-type') || 'application/octet-stream';
    const blob = await res.blob();
    const fileName = key.split('/').pop() || key;
    const form = new FormData();
    form.append('file', new File([blob], fileName, { type: contentType }));
    form.append('key', key);
    const upload = await fetch(`${toBase}/api/root/assets`, {
      method: 'POST',
      headers: authHeaders(toBase),
      body: form,
    });
    const json = await safeJson(upload);
    return json?.ok ?? false;
  } catch {
    return false;
  }
}

/** 刪除目標端的主站 R2 資產 */
async function deleteRootAsset(apiBase, key) {
  try {
    const encoded = key
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    const res = await fetch(`${apiBase}/api/root/assets/${encoded}`, {
      method: 'DELETE',
      headers: authHeaders(apiBase),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function syncAssets() {
  // 同時取得 R2 key 列表和刪除紀錄
  const [localKeys, remoteKeys, localDeleted, remoteDeleted] =
    await Promise.all([
      listR2Keys(LOCAL_API),
      listR2Keys(REMOTE_API),
      listDeletedRootAssets(LOCAL_API),
      listDeletedRootAssets(REMOTE_API),
    ]);

  const localSet = new Set(localKeys);
  const remoteSet = new Set(remoteKeys);
  const localDeletedSet = new Set(localDeleted.map((d) => d.key));
  const remoteDeletedSet = new Set(remoteDeleted.map((d) => d.key));

  const toPush = []; // 本地有、遠端沒有、且遠端無刪除紀錄 → 推送
  const toPull = []; // 遠端有、本地沒有、且本地無刪除紀錄 → 拉取
  const deleteOnRemote = []; // 本地有刪除紀錄、遠端還存在 → 傳播刪除
  const deleteOnLocal = []; // 遠端有刪除紀錄、本地還存在 → 傳播刪除
  const inSync = localKeys.filter((k) => remoteSet.has(k));

  // 本地有、遠端沒有
  for (const key of localKeys) {
    if (remoteSet.has(key)) continue;
    if (remoteDeletedSet.has(key)) {
      // 遠端曾刪除過 → 傳播刪除到本地
      deleteOnLocal.push(key);
    } else {
      toPush.push(key);
    }
  }

  // 遠端有、本地沒有
  for (const key of remoteKeys) {
    if (localSet.has(key)) continue;
    if (localDeletedSet.has(key)) {
      // 本地曾刪除過 → 傳播刪除到遠端
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
    `\n🗂️  R2 資產 (root-assets)  (本地: ${localKeys.length} / 遠端: ${remoteKeys.length})`
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
      const ok = await transferRootAsset(LOCAL_API, REMOTE_API, key);
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
      const ok = await transferRootAsset(REMOTE_API, LOCAL_API, key);
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
      const ok = await deleteRootAsset(REMOTE_API, key);
      if (ok) {
        // 在遠端記錄刪除紀錄（避免下次同步時重新拉取）
        await recordRootDeletions(REMOTE_API, [key]);
      }
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
      const ok = await deleteRootAsset(LOCAL_API, key);
      if (ok) {
        // 在本地記錄刪除紀錄
        await recordRootDeletions(LOCAL_API, [key]);
      }
      console.log(ok ? `  🗑 本地 ${key}` : `  ✗ 刪除失敗 ${key}`);
    }
  }

  // 同步完成後清除過期刪除紀錄（30 天）
  if (!DRY_RUN && (doDeleteRemote.length > 0 || doDeleteLocal.length > 0)) {
    for (const [label, api] of [
      ['本地', LOCAL_API],
      ['遠端', REMOTE_API],
    ]) {
      const result = await purgeRootDeletedRecords(api, 30);
      if (result?.purged > 0) {
        console.log(`   ✓ 清除 ${label} ${result.purged} 筆過期刪除紀錄`);
      }
    }
  }

  console.log();
}

// === 主程式 ===

async function main() {
  console.log('═'.repeat(50));
  console.log('  🏗️  主站同步工具 (Root Site Sync)');
  console.log(
    `  模式: ${DRY_RUN ? '🔍 dry-run' : DIRECTION === 'push' ? '↑ push' : DIRECTION === 'pull' ? '↓ pull' : '🔄 互動'}`
  );
  console.log('═'.repeat(50));

  // 本地 API 健檢
  const localOk = await checkLocalApi(LOCAL_API, '/api/root/projects?limit=1');
  if (!localOk) {
    console.error(
      '\n❌ 無法連線到本地 content-api (localhost:8788)，請確認 dev server 正在運行：'
    );
    console.error('   pnpm --filter content-api-worker dev\n');
    process.exit(1);
  }

  // 遠端 API 健檢
  const remoteStatus = await checkRemoteApi(
    REMOTE_API,
    '/api/root/projects?limit=1'
  );
  if (remoteStatus === 'unreachable') {
    console.error('\n❌ 無法連線到遠端 API，請確認網路連線\n');
    process.exit(1);
  }
  if (remoteStatus === 'bad_format') {
    console.error(
      '\n⚠️  遠端 API 回傳非 JSON 格式（可能是 Cloudflare 錯誤頁面），部分操作可能失敗\n'
    );
  }

  // 認證：優先使用 SYNC_REMOTE_TOKEN（由 sync.mjs 統一登入後傳入）
  if (!DRY_RUN) {
    const envToken = process.env.SYNC_REMOTE_TOKEN;
    if (envToken) {
      remoteToken = envToken;
    } else {
      // 獨立執行：有 API_TOKEN 環境變數就用，沒有才互動登入
      const token = await resolveWriteToken({
        loginApiUrl: REMOTE_API,
        purpose: '同步',
      });
      if (!token) {
        console.error('\n❌ 認證失敗，無法繼續同步\n');
        process.exit(1);
      }
      remoteToken = token;
    }
  }

  let totalPush = 0,
    totalPull = 0;

  if (!IMAGES_ONLY) {
    // 集合同步
    const targetCollections = ONLY_COLLECTION ? [ONLY_COLLECTION] : COLLECTIONS;
    for (const col of targetCollections) {
      if (!COLLECTIONS.includes(col)) {
        console.log(`\n⚠️  未知集合: ${col}`);
        continue;
      }
      const r = await syncCollection(col);
      totalPush += r.push;
      totalPull += r.pull;
    }

    // Singleton 同步
    if (!ONLY_COLLECTION) {
      const r = await syncSingletons();
      totalPush += r.push;
      totalPull += r.pull;
    }

    // Cards 同步
    if (!ONLY_COLLECTION) {
      const r = await syncCards();
      totalPush += r.push;
      totalPull += r.pull;
    }
  }

  // 圖片同步
  if (!SKIP_IMAGES) {
    await syncAssets();
  }

  // 總結
  console.log('\n' + '─'.repeat(50));
  console.log(`✅ 完成！ ↑推送: ${totalPush}  ↓拉取: ${totalPull}`);
  console.log();
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
