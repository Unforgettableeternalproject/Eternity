/**
 * 浮島教學的請求通道（S10-4 C 段；2026-08-04 改為唯一觸發源）
 *
 * ## 教學由事件觸發，不再由狀態衍生
 *
 * 原本的自動播放條件是純衍生的 `islandsUnlocked ∖ islandGuidesSeen`，
 * 每次 progress 變動都重算。那個設計要處理一整排它自己製造的問題：舊帳號
 * hydrate 後五島全 unseen 要防連播（sessionStorage 分頁額度）、額度換人時
 * 要還原、元件 mount 在解鎖事件之後收不到訊號要靠模組層級旗標補延遲。
 *
 * 實際上教學只有兩個該播的時機，而兩者都是**一次性的動作**：
 *
 * 1. 解鎖儀式收束（`completeUnlockRitual`）——甦醒動畫演完，島剛出現
 * 2. 使用者從浮島偏好面板明確要求回顧
 *
 * 改成兩者都打進這個通道之後，上述那一整排問題連同它們的旗標一起消失。
 * 代價是「錯過就是錯過」：Escape 關掉、或解鎖當下條件不成立，就不會再
 * 自動補，得從偏好面板叫。教學不是關鍵路徑，這個取捨划算（艾斯維爾定案）。
 *
 * ## 為什麼要 latch
 *
 * `IslandHost` 在 `activeIds.length === 0` 時整個 `return null`——**第一座島
 * 解鎖之前 `IslandGuideAuto` 根本沒 mount**，訂閱掛不上。而第一座島正是最
 * 需要教學的那一次。所以請求在沒有訂閱者時不能就地丟掉，要留著等第一個
 * 訂閱者掛上來領。
 *
 * pending 只留最後一筆、消費即清空。若始終沒人來領（解鎖後立刻把視窗縮成
 * 手機寬度），它就留在記憶體裡等下次 mount——播放端自己會重驗資格，
 * 不合格時直接 return。
 */

import type { IslandId } from '../types';

type GuideListener = (id: IslandId) => void;

const listeners = new Set<GuideListener>();

/** 還沒有人領走的請求（見檔頭「為什麼要 latch」） */
let pending: IslandId | null = null;

/** 請求播放某座島的教學。播放端不存在時請求會等到它出現為止 */
export function requestIslandGuide(id: IslandId): void {
  if (listeners.size === 0) {
    pending = id;
    return;
  }
  listeners.forEach((fn) => fn(id));
}

export function subscribeIslandGuide(fn: GuideListener): () => void {
  listeners.add(fn);
  if (pending !== null) {
    const id = pending;
    pending = null;
    fn(id);
  }
  return () => {
    listeners.delete(fn);
  };
}

/** 測試用：清掉跨 case 殘留的 pending */
export function _resetGuideRequestForTest(): void {
  pending = null;
  listeners.clear();
}
