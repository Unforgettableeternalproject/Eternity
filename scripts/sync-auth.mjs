/**
 * 同步認證共用模組
 *
 * 提供登入、token 管理、auth header 產生等認證相關功能。
 * 子腳本直接 import 使用，不含任何腳本特定邏輯。
 */

import { ask, askPassword, safeJson } from './sync-utils.mjs';

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
