/**
 * UEP 浮島系統 — dock chip 標記式提示（S9-D）
 *
 * chip 上的提示有兩種來源：
 * - **衍生型**（Visual Clue 區間、Echo Spot 待播、嵌入提示 pending）
 *   ——條件本身就是持續狀態，由來源端各自維護，在 useChipAttention
 *   聚合求值，不經過這裡。
 * - **標記型**（進度數字剛變、便條剛回到島裡）——事件發生的當下沒有
 *   任何「條件」可以持續查詢，需要有人記著。這個模組管的就是這一半。
 *
 * 標記**不會自己過期**。閃一下就消失的提示，使用者只要當下沒在看畫面
 * 右下角就永遠不會知道（艾斯維爾 2026-07-26）。清除時機與衍生型對齊：
 * 展開島（看到了）或換頁（脈絡沒了），兩者都在 IslandHost 收束。
 *
 * 狀態掛 window 而非 module 變數：來源端（HistoryReader、釘選層）與
 * IslandDock 不保證在同一個 bundle chunk（S8-B 教訓）。
 */

import type { IslandId } from './types';

/** chip 標記變化事件（CustomEvent，無 detail——消費端一律重讀狀態） */
export const UEP_CHIP_ATTENTION_EVENT = 'uep:island-chip-attention';

declare global {
  interface Window {
    __uepChipAttention?: Partial<Record<IslandId, string>>;
  }
}

function notify(): void {
  window.dispatchEvent(new CustomEvent(UEP_CHIP_ATTENTION_EVENT));
}

/**
 * 標記某座島「有東西動了」，chip 持續提示直到被清除。
 *
 * 島展開時呼叫是安全的——chip 此刻不在 dock 上，標記無從顯示，而島關回
 * 去之前 IslandHost 就會清掉它，呼叫端不必先問島開著沒有。
 * 同島重複標記以最後一次的說明為準。
 */
export function markChipAttention(id: IslandId, reason: string): void {
  if (typeof window === 'undefined') return;
  if (!window.__uepChipAttention) window.__uepChipAttention = {};
  if (window.__uepChipAttention[id] === reason) return;
  window.__uepChipAttention[id] = reason;
  notify();
}

/** 目前的標記說明（無標記回 null） */
export function getChipAttentionMark(id: IslandId): string | null {
  if (typeof window === 'undefined') return null;
  return window.__uepChipAttention?.[id] ?? null;
}

/** 清除單島標記（展開島時呼叫） */
export function clearChipAttention(id: IslandId): void {
  if (typeof window === 'undefined') return;
  if (!window.__uepChipAttention?.[id]) return;
  delete window.__uepChipAttention[id];
  notify();
}

/** 清除全部標記（換頁／登出／進度重置／測試用） */
export function clearAllChipAttention(): void {
  if (typeof window === 'undefined') return;
  const marks = window.__uepChipAttention;
  if (!marks || Object.keys(marks).length === 0) return;
  window.__uepChipAttention = {};
  notify();
}
