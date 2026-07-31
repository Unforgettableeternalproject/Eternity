/**
 * 同步工具共用函式庫
 *
 * 提供給 sync-content.mjs、sync-root.mjs、sync.mjs 使用的共用工具。
 * 不含任何腳本特定邏輯，純粹是無副作用的工具函式。
 */

import { createInterface } from 'readline';

// === 時間戳工具 ===

/**
 * 正規化時間戳為 UTC ISO 格式。
 * SQLite 的 datetime('now') 輸出 'YYYY-MM-DD HH:MM:SS'（無 Z），
 * 在非 UTC 系統上 new Date() 會誤判為本地時間，必須先補上 Z。
 */
export function normalizeTimestamp(ts) {
  if (!ts) return ts;
  // 已有 Z 或時區偏移 → 不處理
  if (/Z$|[+-]\d{2}:\d{2}$/.test(ts)) return ts;
  // SQLite 格式 'YYYY-MM-DD HH:MM:SS' → 加上 T 和 Z
  return ts.replace(' ', 'T') + 'Z';
}

/** 比較兩個時間戳，回傳較新的一方（截斷到秒，忽略毫秒差異） */
export function compareTimestamps(localTime, remoteTime) {
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

/**
 * 格式化時間戳為 UTC+8 易讀格式（含秒）
 * 回傳格式：YYYY-MM-DD HH:MM:SS
 */
export function fmtTime(ts) {
  if (!ts) return '(無)';
  const d = new Date(normalizeTimestamp(ts));
  if (isNaN(d.getTime())) return ts;
  // 轉換為 UTC+8
  const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const yyyy = utc8.getUTCFullYear();
  const mm = String(utc8.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc8.getUTCDate()).padStart(2, '0');
  const hh = String(utc8.getUTCHours()).padStart(2, '0');
  const mi = String(utc8.getUTCMinutes()).padStart(2, '0');
  const ss = String(utc8.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// === 網路工具 ===

/** 安全地解析 JSON 回應，回傳 null 若非 JSON 格式 */
export async function safeJson(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 檢查本地 API 是否可用（發送一個簡單的 GET 請求）
 * @param {string} url 要檢查的本地 API 基底 URL（不含路徑）
 * @param {string} [path='/api/content/history'] 用於健檢的路徑
 * @returns {Promise<boolean>}
 */
export async function checkLocalApi(url, path = '/api/content/history') {
  try {
    const res = await fetch(`${url}${path}`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 檢查遠端 API 是否可用，並驗證回應格式
 * @param {string} url 要檢查的遠端 API 基底 URL
 * @param {string} [path='/api/content/history'] 用於健檢的路徑
 * @returns {Promise<'ok' | 'bad_format' | 'unreachable'>}
 */
export async function checkRemoteApi(url, path = '/api/content/history') {
  try {
    const res = await fetch(`${url}${path}`, {
      signal: AbortSignal.timeout(5000),
    });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return 'bad_format';
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

// === 互動式輸入 ===

/**
 * 互動式提問，等待使用者輸入後回傳字串
 * @param {string} question 顯示的問題文字
 * @param {{ lowercase?: boolean }} opts
 *   - lowercase: 是否將答案轉為小寫（預設 true）
 * @returns {Promise<string>}
 */
export function ask(question, { lowercase = true } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(lowercase ? trimmed.toLowerCase() : trimmed);
    });
  });
}

/**
 * 掩碼密碼輸入（顯示 * 遮罩，支援 backspace 退格、Ctrl-C 中斷）
 * Windows 相容：stdin 不支援 setRawMode 時自動降級為明文輸入。
 * @param {string} question 顯示的問題文字
 * @returns {Promise<string>}
 */
export function askPassword(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    // 若 stdin 不支援 raw mode（如 Windows 非 TTY），降級為普通輸入
    if (!stdin.setRawMode) {
      const rl = createInterface({ input: stdin, output: process.stdout });
      process.stdout.write(question);
      rl.question('', (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    process.stdout.write(question);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    let pwd = '';

    const onData = (ch) => {
      const c = ch.toString();

      if (c === '\n' || c === '\r') {
        // 輸入完成
        stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(pwd);
      } else if (c === '') {
        // Ctrl-C：還原 raw mode 後中止
        stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        process.exit(130);
      } else if (c === '' || c === '\b') {
        // Backspace：退一格
        if (pwd.length > 0) {
          pwd = pwd.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c.charCodeAt(0) >= 32) {
        // 可見字元：用 * 掩碼顯示
        pwd += c;
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

// === 差異比對 ===

/**
 * 比對兩端的同一批記錄，分成推送／拉取／傳播刪除／已同步。
 *
 * 記錄帶 `deletedAt`（軟刪除墓碑）時才會產生刪除清單，沒有那個欄位的表
 * （如 interlink_keys）行為與過去完全相同。墓碑的意義就在這裡：少了它，
 * 「單邊不存在」只能被當成「僅存在另一端」而複製回去——刪除永遠同步不掉。
 *
 * @param {Record<string, any>} localMap 以 id 為鍵的本地記錄
 * @param {Record<string, any>} remoteMap 以 id 為鍵的遠端記錄
 */
export function diffByTimestamp(localMap, remoteMap) {
  const toPush = [];
  const toPull = [];
  const deleteOnRemote = [];
  const deleteOnLocal = [];
  const inSync = [];

  for (const id of new Set([
    ...Object.keys(localMap),
    ...Object.keys(remoteMap),
  ])) {
    const local = localMap[id];
    const remote = remoteMap[id];
    const localDeleted = Boolean(local?.deletedAt);
    const remoteDeleted = Boolean(remote?.deletedAt);

    if (local && !remote) {
      // 本地建了又刪、遠端從來沒有過 → 沒有東西要傳播
      if (localDeleted) inSync.push(id);
      else toPush.push({ id, reason: '僅存在本地', local });
      continue;
    }
    if (!local && remote) {
      if (remoteDeleted) inSync.push(id);
      else toPull.push({ id, reason: '僅存在遠端', remote });
      continue;
    }

    if (localDeleted && remoteDeleted) {
      inSync.push(id);
      continue;
    }
    // 一邊是墓碑、另一邊還活著：比刪除時間與對面的更新時間，
    // 刪除之後對面又改過就以那次修改為準（等於撤銷刪除）
    if (localDeleted) {
      const winner = compareTimestamps(local.deletedAt, remote.updatedAt);
      if (winner === 'remote') {
        toPull.push({ id, reason: '遠端在刪除後有更新', local, remote });
      } else {
        deleteOnRemote.push({
          id,
          reason: `本地已刪除 (${fmtTime(local.deletedAt)})`,
          local,
          remote,
        });
      }
      continue;
    }
    if (remoteDeleted) {
      const winner = compareTimestamps(local.updatedAt, remote.deletedAt);
      if (winner === 'local') {
        toPush.push({ id, reason: '本地在刪除後有更新', local, remote });
      } else {
        deleteOnLocal.push({
          id,
          reason: `遠端已刪除 (${fmtTime(remote.deletedAt)})`,
          local,
          remote,
        });
      }
      continue;
    }

    const winner = compareTimestamps(local.updatedAt, remote.updatedAt);
    if (winner === 'local') {
      toPush.push({
        id,
        reason: `本地較新 (${fmtTime(local.updatedAt)} > ${fmtTime(remote.updatedAt)})`,
        local,
        remote,
      });
    } else if (winner === 'remote') {
      toPull.push({
        id,
        reason: `遠端較新 (${fmtTime(remote.updatedAt)} > ${fmtTime(local.updatedAt)})`,
        local,
        remote,
      });
    } else {
      inSync.push(id);
    }
  }
  return { toPush, toPull, deleteOnRemote, deleteOnLocal, inSync };
}
