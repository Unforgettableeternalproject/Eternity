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
import { readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'apps', 'root', 'public', 'images');

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

async function syncCollection(name) {
  const [localItems, remoteItems] = await Promise.all([
    listCollection(LOCAL_API, name),
    listCollection(REMOTE_API, name),
  ]);

  const localMap = new Map(localItems.map((i) => [i.id, i]));
  const remoteMap = new Map(remoteItems.map((i) => [i.id, i]));
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  const toPush = [],
    toPull = [],
    inSync = [];

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (local && !remote) {
      toPush.push(id);
      continue;
    }
    if (!local && remote) {
      toPull.push(id);
      continue;
    }
    if (local && remote) {
      const cmp = compareTimestamps(local.updatedAt, remote.updatedAt);
      if (cmp === 'local') toPush.push(id);
      else if (cmp === 'remote') toPull.push(id);
      else inSync.push(id);
    }
  }

  console.log(
    `\n📦 ${name}  (本地: ${localItems.length} / 遠端: ${remoteItems.length})`
  );

  if (toPush.length === 0 && toPull.length === 0) {
    console.log(`   ✓ 完全同步 (${inSync.length} 筆)`);
    return { push: 0, pull: 0 };
  }

  if (toPush.length > 0) {
    console.log(`   ↑ 需推送: ${toPush.length}`);
    for (const id of toPush) {
      const l = localMap.get(id);
      console.log(`     ${id}  本地: ${fmtTime(l?.updatedAt)}`);
    }
  }
  if (toPull.length > 0) {
    console.log(`   ↓ 需拉取: ${toPull.length}`);
    for (const id of toPull) {
      const r = remoteMap.get(id);
      console.log(`     ${id}  遠端: ${fmtTime(r?.updatedAt)}`);
    }
  }

  if (DRY_RUN) return { push: toPush.length, pull: toPull.length };

  let doPush = toPush,
    doPull = toPull;
  if (DIRECTION === 'pull') doPush = [];
  else if (DIRECTION === 'push') doPull = [];
  else {
    const answer = await ask(
      `   同步 ${name}？ [y] 全部 / [push] / [pull] / [n] 跳過: `
    );
    if (answer === 'n') return { push: 0, pull: 0 };
    if (answer === 'push') doPull = [];
    if (answer === 'pull') doPush = [];
  }

  let pushOk = 0,
    pullOk = 0;

  for (const id of doPush) {
    const full = await getItem(LOCAL_API, name, id);
    if (!full) continue;
    const ok = await putItem(REMOTE_API, name, id, full);
    if (ok) {
      pushOk++;
      process.stdout.write(`   ↑ ${id} ✅\n`);
    } else {
      process.stdout.write(`   ↑ ${id} ❌\n`);
    }
  }

  for (const id of doPull) {
    const full = await getItem(REMOTE_API, name, id);
    if (!full) continue;
    const ok = await putItem(LOCAL_API, name, id, full);
    if (ok) {
      pullOk++;
      process.stdout.write(`   ↓ ${id} ✅\n`);
    } else {
      process.stdout.write(`   ↓ ${id} ❌\n`);
    }
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

// === 圖片同步 (local files → R2) ===

function walkDir(dir, base = dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...walkDir(full, base));
      else {
        const relative = path.relative(base, full).replace(/\\/g, '/');
        results.push({ absolute: full, relative });
      }
    }
  } catch {
    /* directory might not exist */
  }
  return results;
}

function slugifyPath(p) {
  return p
    .split('/')
    .map((seg) => seg.replace(/\s+/g, '-').toLowerCase())
    .join('/');
}

async function listR2Keys(apiBase, prefix) {
  try {
    const res = await fetch(`${apiBase}/api/assets`, {
      headers: authHeaders(apiBase),
    });
    if (!res.ok) return [];
    const json = await safeJson(res);
    const items = json?.ok ? json.data?.items || [] : [];
    return items.map((i) => i.key).filter((k) => k.startsWith(prefix + '/'));
  } catch {
    return [];
  }
}

async function uploadToR2(apiBase, key, filePath) {
  const { createReadStream } = await import('fs');
  const { Blob } = await import('buffer');
  const fileData = await import('fs/promises').then((fs) =>
    fs.readFile(filePath)
  );
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';

  const form = new FormData();
  form.append('file', new Blob([fileData], { type: contentType }), fileName);
  form.append('key', key);

  try {
    const res = await fetch(`${apiBase}/api/assets`, {
      method: 'POST',
      headers: authHeaders(apiBase),
      body: form,
    });
    const json = await safeJson(res);
    return json?.ok ?? false;
  } catch {
    return false;
  }
}

async function syncImages() {
  const localFiles = walkDir(IMAGES_DIR);
  if (localFiles.length === 0) {
    console.log('\n🖼️  圖片  (無本地檔案)');
    return;
  }

  // Build expected R2 keys from local files
  const localKeyMap = new Map(); // r2Key → absolutePath
  for (const { absolute, relative } of localFiles) {
    const r2Key = `${R2_PREFIX}/${slugifyPath(relative)}`;
    localKeyMap.set(r2Key, absolute);
  }

  // List existing R2 keys
  const targetApi = DIRECTION === 'pull' ? LOCAL_API : REMOTE_API;
  const remoteKeys = new Set(await listR2Keys(targetApi, R2_PREFIX));

  const toUpload = [];
  const existing = [];

  for (const [key, filePath] of localKeyMap) {
    if (remoteKeys.has(key)) existing.push(key);
    else toUpload.push({ key, filePath });
  }

  console.log(
    `\n🖼️  圖片 → R2  (本地: ${localFiles.length} / R2: ${remoteKeys.size})`
  );

  if (toUpload.length === 0) {
    console.log(`   ✓ 完全同步 (${existing.length} 個檔案)`);
    return;
  }

  console.log(`   ↑ 需上傳: ${toUpload.length} 個`);
  if (existing.length > 0) console.log(`   = 已存在: ${existing.length} 個`);

  if (DRY_RUN) {
    for (const { key } of toUpload) console.log(`     [dry] ${key}`);
    return;
  }

  if (DIRECTION === 'pull') {
    console.log('   ⏭ pull 模式不上傳圖片');
    return;
  }

  let ok = 0;
  for (const { key, filePath } of toUpload) {
    const size = (statSync(filePath).size / 1024).toFixed(1);
    const success = await uploadToR2(targetApi, key, filePath);
    if (success) {
      ok++;
      console.log(`   ✅ ${key} (${size} KB)`);
    } else {
      console.log(`   ❌ ${key}`);
    }
  }

  console.log(`   📊 ${ok}/${toUpload.length} 上傳成功`);
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
    await syncImages();
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
