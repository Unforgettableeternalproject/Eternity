/**
 * 旅程之書 — 目錄頁碼「上次看到」快照（跨收合保留）
 *
 * S9-D.6 的頁碼閃動原本把前後快照存在元件 ref 裡：島收合會 unmount，
 * 重新展開後首拍快照被當成「第一次看到」，於是 chip 把使用者引來，
 * 數字卻早已換好、什麼也不閃。快照搬到這裡——「上次看到」的主詞是
 * 使用者，不是元件實例，生命週期自然跟著 session 而非 mount。
 *
 * 狀態掛 window 而非 module 變數：寫入端（HistoryIsland lazy chunk）
 * 與清除端（islandRuntime 核心 bundle）不保證同一個 chunk（S8-B 教訓）。
 */

declare global {
  interface Window {
    __uepHistoryTocSeen?: Record<string, string>;
  }
}

/** 上次展開時看到的頁碼快照；從未看過回 null */
export function getSeenTocCounts(): Record<string, string> | null {
  if (typeof window === 'undefined') return null;
  return window.__uepHistoryTocSeen ?? null;
}

/** 記下這次看到的頁碼（島展開渲染時持續更新） */
export function setSeenTocCounts(counts: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  window.__uepHistoryTocSeen = counts;
}

/** 清除快照（登出／進度 reset——islandRuntime.resetAll 呼叫） */
export function clearSeenTocCounts(): void {
  if (typeof window === 'undefined') return;
  delete window.__uepHistoryTocSeen;
}
