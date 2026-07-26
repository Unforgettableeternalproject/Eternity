/**
 * History Island — 跨區互聯線索轉交橋（Epic 2 S10-1）
 *
 * 為什麼需要橋：IslandHost 只掛載「展開中」的島——島收合（在 dock）時
 * HistoryIsland 沒有 mount，直接在島內訂閱 `ISLAND_RELATED_EVENT` 會把
 * 收合期間的線索整個漏掉，「收合時 chip 亮框、展開後看到線索卡」這條
 * 定案路徑永遠不會發生（而且事件本身無狀態，事後也補不回來）。
 *
 * 因此監聽放在 IslandHost（解鎖即常駐），收到後：
 * 1. 島已展開 → subscriber 直接收下，立刻顯示
 * 2. 島收合中 → 留 pending + 亮 dock chip，使用者展開後
 *    `subscribeRelated` 取走
 *
 * 只保留最後一筆——新線索直接取代舊的，不排隊（設計定案：一次一則）。
 * 這與 concepts 的 `terminalBridge` 是同一個模式、同一個成因。
 */

import { setRelatedPendingFlag } from '../interlinkTrigger';
import type { IslandRelatedDetail } from '../types';

/** `null` = 清除目前顯示的線索（換頁時 Host 主動下達） */
type RelatedSubscriber = (detail: IslandRelatedDetail | null) => void;

let pending: IslandRelatedDetail | null = null;
let subscriber: RelatedSubscriber | null = null;

/** 交付跨區互聯線索（島未 mount 時暫存並亮 chip） */
export function pushIslandRelated(detail: IslandRelatedDetail): void {
  if (subscriber) {
    subscriber(detail);
    return;
  }
  pending = detail;
  setRelatedPendingFlag('history', true);
}

/** 是否有尚未送達的線索（島收合中） */
export function hasPendingRelated(): boolean {
  return pending !== null;
}

/**
 * 丟棄線索（換頁時呼叫）。
 *
 * 線索是對「讀者剛才停在哪首歌／哪個畫廊」的回應，換頁後那個脈絡已經
 * 不在——與 echo／phantom 提示同一個判準。已送達的那則也一併收掉，
 * 否則島展開著時卡片會跨頁殘留。
 */
export function clearRelated(): void {
  pending = null;
  setRelatedPendingFlag('history', false);
  subscriber?.(null);
}

/**
 * 訂閱線索（HistoryIsland mount 時呼叫）。
 *
 * 島 mount 就代表使用者看得到內容，待處理提示一律收掉——有 pending 時
 * 立即送達。回傳取消訂閱函式。
 */
export function subscribeRelated(fn: RelatedSubscriber): () => void {
  subscriber = fn;
  setRelatedPendingFlag('history', false);
  if (pending) {
    const detail = pending;
    pending = null;
    fn(detail);
  }
  return () => {
    if (subscriber === fn) subscriber = null;
  };
}

/** 重置橋狀態（測試用） */
export function resetRelatedBridge(): void {
  pending = null;
  subscriber = null;
  setRelatedPendingFlag('history', false);
}
