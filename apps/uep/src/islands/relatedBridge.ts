/**
 * 跨區互聯線索轉交橋（Epic 2 S10-1）
 *
 * 為什麼需要橋：IslandHost 只掛載「展開中」的島——島收合（在 dock）時
 * 島元件沒有 mount，直接在島內訂閱 `ISLAND_RELATED_EVENT` 會把收合期間的
 * 線索整個漏掉，「收合時 chip 亮框、展開後看到線索卡」這條定案路徑永遠
 * 不會發生（而且事件本身無狀態，事後也補不回來）。
 *
 * 因此監聽放在 IslandHost（解鎖即常駐），收到後：
 * 1. 島已展開 → subscriber 直接收下，立刻顯示
 * 2. 島收合中 → 留 pending + 亮 dock chip，使用者展開後
 *    `subscribeRelated` 取走
 *
 * 每座島各留一份狀態：entityKey 的線索可能同時送給 Echoes 與 Visuals
 * （一個 entity 可以既有歌又有畫廊），共用單一 slot 會讓後到的蓋掉先到的。
 * 同一座島內仍是**只保留最後一筆**——新線索取代舊的，不排隊。
 *
 * 這與 concepts 的 `terminalBridge` 是同一個模式、同一個成因。
 */

import { setRelatedPendingFlag } from './interlinkTrigger';
import type { IslandId, IslandRelatedDetail } from './types';

/** `null` = 清除目前顯示的線索（換頁時 Host 主動下達） */
type RelatedSubscriber = (detail: IslandRelatedDetail | null) => void;

const pending = new Map<IslandId, IslandRelatedDetail>();
const subscribers = new Map<IslandId, RelatedSubscriber>();

/** 交付跨區互聯線索（島未 mount 時暫存並亮 chip） */
export function pushIslandRelated(detail: IslandRelatedDetail): void {
  const target = detail.targetIsland;
  const subscriber = subscribers.get(target);
  if (subscriber) {
    subscriber(detail);
    return;
  }
  pending.set(target, detail);
  setRelatedPendingFlag(target, true);
}

/** 某座島是否有尚未送達的線索（島收合中） */
export function hasPendingRelated(islandId: IslandId): boolean {
  return pending.has(islandId);
}

/**
 * 丟棄所有線索（換頁時呼叫）。
 *
 * 線索是對「讀者剛才停在哪首歌／點了哪個條目」的回應，換頁後那個脈絡
 * 已經不在——與 echo／phantom 提示同一個判準。已送達的那則也一併收掉，
 * 否則島開著時卡片會跨頁殘留。
 */
export function clearRelated(): void {
  for (const islandId of pending.keys()) {
    setRelatedPendingFlag(islandId, false);
  }
  pending.clear();
  for (const subscriber of subscribers.values()) subscriber(null);
}

/**
 * 訂閱某座島的線索（島元件 mount 時呼叫）。
 *
 * 島 mount 就代表使用者看得到內容，待處理提示一律收掉——有 pending 時
 * 立即送達。回傳取消訂閱函式。
 */
export function subscribeRelated(
  islandId: IslandId,
  fn: RelatedSubscriber
): () => void {
  subscribers.set(islandId, fn);
  setRelatedPendingFlag(islandId, false);
  const waiting = pending.get(islandId);
  if (waiting) {
    pending.delete(islandId);
    fn(waiting);
  }
  return () => {
    if (subscribers.get(islandId) === fn) subscribers.delete(islandId);
  };
}

/** 重置橋狀態（測試用） */
export function resetRelatedBridge(): void {
  for (const islandId of pending.keys()) {
    setRelatedPendingFlag(islandId, false);
  }
  pending.clear();
  subscribers.clear();
}
