/**
 * Storage 對話解鎖通知橋
 *
 * 為什麼需要通知：Storage 的對話 gate 未通過時是**整張從列表消失**的
 * （見 `components/storage/storageVisibility.ts`）。好處是標題不劇透，
 * 代價是解鎖那一刻毫無動靜——讀者不會知道置物空間裡多了一段對話。
 * 這條橋補回那一半：解鎖時 UEP 從島的角落探出來說一聲。
 *
 * 為什麼不直接用 `relatedBridge`：那條橋每島各留一份、語意是「回應讀者
 * 剛才停在哪裡」，而這裡只有 storage 一個目標、且是一次性事件。共用只會
 * 讓兩種語意互相覆蓋。
 *
 * 生命週期（艾斯維爾 2026-08-10 定案）——**消費後不補發**：
 * - 島展開中 → subscriber 直接收下，卡片顯示 30 秒後自行收走
 * - 島收合中 → 留 pending + 亮 dock chip，展開時取走
 * - 換頁／重整 → 連同其他提示一起清掉（`clearAllChipAttention` 那一批），
 *   不跨頁保留。錯過就錯過，這是預期行為而非缺陷。
 *
 * 多篇同時解鎖時**只提一篇**：卡片是一句招呼不是清單，其餘讓讀者自己
 * 在置物空間裡發現。
 */

import { markChipAttention } from '../chipAttention';

export interface StorageUnlockNotice {
  /** 頁面 slug，點擊時導向 `/storage?page=<slug>` */
  slug: string;
  title: string;
}

/** `null` = 清除目前顯示的通知 */
type NoticeSubscriber = (notice: StorageUnlockNotice | null) => void;

let pending: StorageUnlockNotice | null = null;
let subscriber: NoticeSubscriber | null = null;

/**
 * 交付解鎖通知。島收合時暫存並亮 chip，展開後由 `subscribeUnlockNotice`
 * 取走。同時間只保留最後一筆——後到的取代先到的，不排隊。
 */
export function pushUnlockNotice(notice: StorageUnlockNotice): void {
  if (subscriber) {
    subscriber(notice);
    return;
  }
  pending = notice;
  markChipAttention('storage', '有新的對話可以聊了');
}

/** 是否有尚未送達的通知（島收合中） */
export function hasPendingUnlockNotice(): boolean {
  return pending !== null;
}

/**
 * 訂閱通知（島元件 mount 時呼叫）。島 mount 就代表使用者看得到內容，
 * 有 pending 時立即送達。回傳取消訂閱函式。
 */
export function subscribeUnlockNotice(fn: NoticeSubscriber): () => void {
  subscriber = fn;
  const waiting = pending;
  if (waiting) {
    pending = null;
    fn(waiting);
  }
  return () => {
    if (subscriber === fn) subscriber = null;
  };
}

/** 丟棄通知（換頁時呼叫，與其他嵌入提示同一個終點） */
export function clearUnlockNotice(): void {
  pending = null;
  subscriber?.(null);
}

/** 重置橋狀態（測試用） */
export function resetUnlockNoticeBridge(): void {
  pending = null;
  subscriber = null;
}
