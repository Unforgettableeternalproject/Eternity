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
 */

import { createInterface } from 'readline';

// === 設定 ===
const LOCAL_API = 'http://localhost:8788';
const REMOTE_API = 'https://eternity-content-api.ptyc4076.workers.dev';
const R2_PREFIX = 'root';
const COLLECTIONS = ['projects', 'links', 'updates'];
const SINGLETONS = ['homepage-zh', 'homepage-en', 'about-zh', 'about-en'];
const CARD_KEYS = [
  'quote',
  'music',
  'quick-stats',
  'table-of-contents',
  'visitor-counter',
  'latest-update',
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

// === 工具函式 ===

async function safeJson(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeTimestamp(ts) {
  if (!ts) return ts;
  if (/Z$|[+-]\d{2}:\d{2}$/.test(ts)) return ts;
  return ts.replace(' ', 'T') + 'Z';
}

function compareTimestamps(localTime, remoteTime) {
  const l = Math.floor(
    new Date(normalizeTimestamp(localTime)).getTime() / 1000
  );
  const r = Math.floor(
    new Date(normalizeTimestamp(remoteTime)).getTime() / 1000
  );
  if (l > r) return 'local';
  if (r > l) return 'remote';
  return 'same';
}

function fmtTime(ts) {
  if (!ts) return '(無)';
  const d = new Date(normalizeTimestamp(ts));
  if (isNaN(d.getTime())) return ts;
  const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${utc8.getUTCFullYear()}-${String(utc8.getUTCMonth() + 1).padStart(2, '0')}-${String(utc8.getUTCDate()).padStart(2, '0')} ${String(utc8.getUTCHours()).padStart(2, '0')}:${String(utc8.getUTCMinutes()).padStart(2, '0')}`;
}

function ask(question, { lowercase = true } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (a) => {
      rl.close();
      resolve(lowercase ? a.trim().toLowerCase() : a.trim());
    });
  });
}

function askPassword(question) {
  return new Promise((resolve) => {
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
        resolve(pwd);
      } else if (c === '') {
        process.exit();
      } else if (c === '' || c === '\b') {
        pwd = pwd.slice(0, -1);
      } else {
        pwd += c;
      }
    };
    stdin.resume();
    stdin.on('data', onData);
  });
}

// === 認證 ===

let remoteToken = null;

function authHeaders(apiBase) {
  if (apiBase === REMOTE_API && remoteToken) {
    return { Authorization: `Bearer ${remoteToken}` };
  }
  return {};
}

async function ensureAuth() {
  if (DIRECTION === null && DRY_RUN) return;
  // 嘗試已有 token
  if (remoteToken) return;
  console.log('\n🔐 遠端認證...');
  const username = await ask('   帳號: ', { lowercase: false });
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
      console.log('   ✅ 認證成功\n');
    } else {
      console.error('   ❌ 認證失敗:', json?.error || 'unknown');
      process.exit(1);
    }
  } catch (e) {
    console.error('   ❌ 連線失敗:', e.message);
    process.exit(1);
  }
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

  for (const id of doPush) {
    const full = await getItem(LOCAL_API, name, id);
    if (!full) continue;
    const ok = await putItem(REMOTE_API, name, id, full);
    console.log(ok ? `   ↑ ${id} ✅` : `   ↑ ${id} ❌`);
    if (ok) pushOk++;
  }

  for (const id of doPull) {
    const full = await getItem(REMOTE_API, name, id);
    if (!full) continue;
    const ok = await putItem(LOCAL_API, name, id, full);
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

async function putSingleton(apiBase, key, content) {
  try {
    const res = await fetch(`${apiBase}/api/root/singletons/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiBase) },
      body: JSON.stringify({ content }),
    });
    const json = await safeJson(res);
    return json?.ok ?? false;
  } catch {
    return false;
  }
}

async function syncSingletons() {
  console.log(`\n🏠 Singletons`);
  let pushOk = 0,
    pullOk = 0;

  for (const key of SINGLETONS) {
    const [local, remote] = await Promise.all([
      getSingleton(LOCAL_API, key),
      getSingleton(REMOTE_API, key),
    ]);

    if (!local && !remote) {
      continue;
    }
    if (local && !remote) {
      console.log(`   ↑ ${key} (只在本地)`);
      if (!DRY_RUN && DIRECTION !== 'pull') {
        const ok = await putSingleton(REMOTE_API, key, local.content);
        if (ok) pushOk++;
      }
      continue;
    }
    if (!local && remote) {
      console.log(`   ↓ ${key} (只在遠端)`);
      if (!DRY_RUN && DIRECTION !== 'push') {
        const ok = await putSingleton(LOCAL_API, key, remote.content);
        if (ok) pullOk++;
      }
      continue;
    }

    const cmp = compareTimestamps(local.updatedAt, remote.updatedAt);
    if (cmp === 'same') {
      console.log(`   = ${key} ✓`);
    } else if (cmp === 'local') {
      console.log(
        `   ↑ ${key}  本地: ${fmtTime(local.updatedAt)}  遠端: ${fmtTime(remote.updatedAt)}`
      );
      if (!DRY_RUN && DIRECTION !== 'pull') {
        const ok = await putSingleton(REMOTE_API, key, local.content);
        if (ok) pushOk++;
      }
    } else {
      console.log(
        `   ↓ ${key}  遠端: ${fmtTime(remote.updatedAt)}  本地: ${fmtTime(local.updatedAt)}`
      );
      if (!DRY_RUN && DIRECTION !== 'push') {
        const ok = await putSingleton(LOCAL_API, key, remote.content);
        if (ok) pullOk++;
      }
    }
  }

  return { push: pushOk, pull: pullOk };
}

// === R2 資產同步 (R2 ↔ R2) ===

async function listR2Keys(apiBase, prefix) {
  try {
    const params = prefix
      ? `?prefix=${encodeURIComponent(prefix)}&limit=500`
      : '?limit=500';
    const res = await fetch(`${apiBase}/api/root/assets${params}`, {
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

/** 刪除目標端的 R2 資產 */
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
  // R2 ↔ R2 雙向同步（跟文件站的 syncAssets 同模式）
  const [localKeys, remoteKeys] = await Promise.all([
    listR2Keys(LOCAL_API, ''),
    listR2Keys(REMOTE_API, ''),
  ]);

  const localSet = new Set(localKeys);
  const remoteSet = new Set(remoteKeys);

  const toPush = localKeys.filter((k) => !remoteSet.has(k));
  const toPull = remoteKeys.filter((k) => !localSet.has(k));
  const inSync = localKeys.filter((k) => remoteSet.has(k));

  const hasChanges = toPush.length > 0 || toPull.length > 0;

  console.log(
    `\n🗂️  R2 資產 (root-assets)  (本地: ${localKeys.length} / 遠端: ${remoteKeys.length})`
  );

  if (!hasChanges) {
    console.log(`   ✓ 完全同步 (${inSync.length} 個檔案)\n`);
    return;
  }

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
  } else if (!DRY_RUN && hasChanges) {
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

  if (!DRY_RUN) await ensureAuth();

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
