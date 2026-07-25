/**
 * 「變回全新訪客」的單一入口（2026-07-26）
 *
 * DevTools 的「重置本機身分」與「完全重置」原本各自實作一份清除邏輯，
 * 兩份都只清了自己記得的那幾把 key，也都沒有斷開登入 session——結果
 * 重載後 `readerAuth` 偵測到 session 仍在，`attachServerAdapter()` 立刻
 * 把伺服器上的舊帳號進度 hydrate 回來，看起來就像「重置了又自己長回來」。
 *
 * 現在兩者共用此函式，順序上的坑集中在這裡處理一次。
 */

import { getReaderAuth } from '../auth/readerAuth';

import { wipeAllUepStorage } from './uepStorage';

/**
 * 清除本機所有 UEP 身分與狀態，使瀏覽器回到全新訪客。
 *
 * ⚠️ **順序不可對調**：
 * 1. 先 `logout()`——銷毀 ServerAdapter（否則它殘留的 debounce PUT 會把
 *    舊進度寫回伺服器）、清 session、切回 LocalStorageAdapter 並重置進度。
 * 2. 再 `wipeAllUepStorage()`——logout 過程中 adapter 切換與進度重置都會
 *    **寫回 localStorage**，先清後登出等於白清。
 *
 * 記憶體中的 module singleton 不在此函式的職責範圍內；呼叫端在此之後
 * 一律要重新載入頁面，否則各 store 仍持有清除前的狀態。
 */
export async function wipeLocalIdentity(): Promise<void> {
  try {
    await getReaderAuth().logout();
  } catch {
    // 登出失敗（離線等）不該擋下本機清除——session key 由下一步一併清掉
  }
  wipeAllUepStorage();
}
