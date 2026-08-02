/**
 * 教學回顧的請求通道（S10-4 C 段）
 *
 * ## 為什麼這裡需要一個通道，而自動播放不需要
 *
 * 自動播放的條件是純衍生的（`islandsUnlocked` ∖ `islandGuidesSeen`），
 * 兩份資料都在 ProgressState 裡，`IslandGuideAuto` 自己算得出來。
 *
 * 回顧不是狀態而是**一次性的使用者動作**，而且發起端（識別證裡的浮島偏好
 * 面板）與播放端（IslandHost）在不同子樹：面板是 modal，按下回顧就要關掉
 * 自己，overlay 不能掛在一個即將 unmount 的元件裡。
 *
 * 刻意做成只有兩個函式的模組變數，不是 store：沒有需要保存的狀態，
 * 請求送出即消費完畢。
 */

import type { IslandId } from '../types';

type ReplayListener = (id: IslandId) => void;

const listeners = new Set<ReplayListener>();

export function requestGuideReplay(id: IslandId): void {
  listeners.forEach((fn) => fn(id));
}

export function subscribeGuideReplay(fn: ReplayListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
