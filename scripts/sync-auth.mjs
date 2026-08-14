/**
 * 同步認證共用模組
 *
 * 提供登入、token 管理、auth header 產生等認證相關功能。
 * 子腳本直接 import 使用，不含任何腳本特定邏輯。
 */

import { ask, askPassword, safeJson } from './sync-utils.mjs';
import { loadRootEnv, ROOT_ENV_PATH } from './load-env.mjs';

/**
 * 互動式登入遠端 API
 *
 * 向使用者詢問帳號與密碼，呼叫 /api/auth/login 取得 JWT。
 * 失敗時回傳 null（不呼叫 process.exit，由呼叫端決定如何處理）。
 *
 * @param {string} remoteApiUrl 遠端 API 基底 URL
 * @returns {Promise<{ token: string, displayName: string } | null>}
 */
export async function login(remoteApiUrl) {
  console.log('\n🔐 需要登入遠端 API\n');
  const username = await ask('   帳號: ', { lowercase: false });
  const password = await askPassword('   密碼: ');

  try {
    const res = await fetch(`${remoteApiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = await safeJson(res);

    if (json?.ok && json.data?.token) {
      const displayName = json.data.display_name || username;
      console.log(`   ✓ 登入成功 (${displayName})\n`);
      return { token: json.data.token, displayName };
    } else {
      console.log(`   ✗ 登入失敗: ${json?.error || '未知錯誤'}\n`);
      return null;
    }
  } catch (e) {
    console.log(`   ✗ 連線錯誤: ${e.message}\n`);
    return null;
  }
}

/**
 * 產生帶有 Bearer token 的 Authorization header
 *
 * @param {string | null} token JWT token，null 時回傳空物件
 * @returns {{ Authorization: string } | {}}
 */
export function getAuthHeaders(token) {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * 解析 CLI 寫入用的 Bearer token（環境變數優先，否則互動式登入）。
 *
 * 背景：Worker 端 `isAuthorized` 認兩種身分——`API_TOKEN` 相符，或有效的
 * admin JWT。`pnpm sync` 一直走後者（{@link login}），所以從來不需要
 * `API_TOKEN`；但 test env 那組腳本只讀環境變數，2026-07-16 又從
 * 「無 token = 開發模式全通過」改成 fail closed，於是變成沒有任何可用的
 * 認證途徑。這個函式把 sync 的登入流程補給它們，行為與 sync 一致。
 *
 * ⚠️ **登入一律打正式 worker，不是操作目標**：test D1 的 `admin_users`
 * 是空的（設計如此，見 CLAUDE.md 測試環境章節），向 test worker 登入
 * 永遠失敗。test worker 設定了與正式相同的 `JWT_SECRET`，因此正式簽發的
 * admin JWT 拿去打 test worker 會由本地 `verifyJwt` 驗過。
 *
 * @param {object} options
 * @param {string} options.loginApiUrl 登入用的 API base（正式 worker）
 * @param {string} [options.purpose] 提示文字用的用途描述
 * @returns {Promise<string | null>} token；登入失敗回 null（由呼叫端決定如何處理）
 */
/**
 * 只從環境變數取 token，不做任何互動。
 *
 * 給 dry-run 這種「不該打斷使用者去輸入帳密、但有授權的話應該讀得更完整」
 * 的情境用：旗標註冊表與 key 說明這兩個端點掛了 isAuthorized，沒有 token
 * 就會被跳過，差異表因此少一截而且看不出原因。
 *
 * @returns {string | null}
 */
export function getEnvToken() {
  loadRootEnv();
  return process.env.API_TOKEN || process.env.ETERNITY_API_TOKEN || null;
}

export async function resolveWriteToken({ loginApiUrl, purpose = '寫入' }) {
  // 獨立的 node 腳本不像 Astro/Vite 會自動吃 .env，要自己載
  loadRootEnv();
  const envToken = process.env.API_TOKEN || process.env.ETERNITY_API_TOKEN;
  if (envToken) return envToken;

  // 非互動環境（CI、被其他工具以管線呼叫）不能問帳密：readline 讀到 EOF
  // 不會 resolve，事件迴圈一空 process 就以 exit 0 靜默結束——看起來成功、
  // 其實什麼都沒做。這裡直接擋下並指路到環境變數。
  if (!process.stdin.isTTY) {
    console.error(
      `\n   [ERROR] ${purpose}需要授權，但目前是非互動環境，無法登入。` +
        `\n           請設 API_TOKEN（環境變數，或寫進 ${ROOT_ENV_PATH}）。\n`
    );
    return null;
  }

  console.log(`\n   未設定 API_TOKEN——${purpose}需要授權，改用帳號登入。`);
  console.log(`   （登入對象是正式 API，取得的 admin JWT 對兩邊都有效）`);
  const session = await login(loginApiUrl);
  return session?.token ?? null;
}
