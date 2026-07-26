/**
 * Terminal Island — entity-activate 轉交橋（Epic 2 S7-C）
 *
 * 為什麼需要橋：IslandHost 只掛載「展開中」的島——島收合（在 dock）時
 * TerminalIsland 沒有 mount，聽不到 uep:entity-activate。
 * 因此事件監聽放在 IslandHost（解鎖即常駐），收到後：
 * 1. pushEntityActivate 暫存 detail（島已 mount 時直接送達）
 * 2. runtime.open('concepts') 展開島 → TerminalIsland mount 後
 *    subscribeEntityActivate 取走 pending
 *
 * 只保留最後一筆 pending——連點多個 entity 時，使用者意圖是最後那個。
 */

import type { EntityActivateDetail } from '../../embed';

/** pending 狀態變化事件——dock chip 靠它決定要不要閃（S9-D.5） */
export const UEP_ENTITY_PENDING_EVENT = 'uep:entity-pending';

let pending: EntityActivateDetail | null = null;
let subscriber: ((detail: EntityActivateDetail) => void) | null = null;

function notifyPending(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UEP_ENTITY_PENDING_EVENT));
}

/** 交付 entity 啟動事件（島未 mount 時暫存） */
export function pushEntityActivate(detail: EntityActivateDetail): void {
  if (subscriber) {
    subscriber(detail);
  } else {
    pending = detail;
    notifyPending();
  }
}

/** 是否有尚未送達的 entity（島收合中，chip 閃爍判定） */
export function hasPendingEntityActivate(): boolean {
  return pending !== null;
}

/**
 * 訂閱 entity 啟動事件（TerminalIsland mount 時呼叫）。
 * 有 pending 時立即送達。回傳取消訂閱函式。
 */
export function subscribeEntityActivate(
  fn: (detail: EntityActivateDetail) => void
): () => void {
  subscriber = fn;
  if (pending) {
    const detail = pending;
    pending = null;
    notifyPending();
    fn(detail);
  }
  return () => {
    if (subscriber === fn) subscriber = null;
  };
}

/** 重置橋狀態（測試用） */
export function resetEntityActivateBridge(): void {
  pending = null;
  subscriber = null;
  notifyPending();
}
