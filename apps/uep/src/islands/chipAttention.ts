/**
 * UEP 浮島系統 — dock chip 一次性提示（S9-D.6）
 *
 * 既有的 chip 閃爍（Visual Clue 區間、Echo Spot 待播、嵌入提示）都是
 * **持續狀態**：條件成立就一直閃，直到條件消失。那類由來源端各自維護、
 * 在 IslandDock 聚合求值，不經過這裡。
 *
 * 這個模組管的是另一半——**瞬時事件**：進度數字剛剛變了、便條剛剛回到
 * 島裡。沒有「條件消失」可等，只需要在收合的 chip 上閃一下告訴使用者
 * 「島裡的東西動了」，然後自己安靜下來。
 *
 * 狀態掛 window 而非 module 變數：來源端（HistoryReader、釘選層）與
 * IslandDock 不保證在同一個 bundle chunk（S8-B 教訓）。
 */

import type { IslandId } from './types';

/** chip 閃爍事件（CustomEvent，無 detail——消費端一律重讀狀態） */
export const UEP_CHIP_PULSE_EVENT = 'uep:island-chip-pulse';

/** 單次閃爍時長（ms）——必須與 islands.css 的 uep-chip-pulse 對齊 */
export const CHIP_PULSE_MS = 1400;

interface ChipPulse {
  /** 給 aria-label／title 的說明，如「進度已更新」 */
  reason: string;
  /** 自動清除的計時器 id */
  timer: number;
}

declare global {
  interface Window {
    __uepChipPulse?: Partial<Record<IslandId, ChipPulse>>;
  }
}

function store(): Partial<Record<IslandId, ChipPulse>> {
  if (!window.__uepChipPulse) window.__uepChipPulse = {};
  return window.__uepChipPulse;
}

function notify(): void {
  window.dispatchEvent(new CustomEvent(UEP_CHIP_PULSE_EVENT));
}

/**
 * 讓某座島的 dock chip 閃一次。
 *
 * 島展開時呼叫是安全的——chip 此刻不在 dock 上，閃爍自然無效，
 * 呼叫端不必先問島開著沒有。重複呼叫會重新計時（連續事件併成一次閃爍）。
 */
export function flashChip(id: IslandId, reason: string): void {
  if (typeof window === 'undefined') return;
  const pulses = store();
  const existing = pulses[id];
  if (existing) window.clearTimeout(existing.timer);
  pulses[id] = {
    reason,
    timer: window.setTimeout(() => {
      delete store()[id];
      notify();
    }, CHIP_PULSE_MS),
  };
  notify();
}

/** 目前是否有閃爍中的提示；有的話回傳說明文字 */
export function getChipPulse(id: IslandId): string | null {
  if (typeof window === 'undefined') return null;
  return window.__uepChipPulse?.[id]?.reason ?? null;
}

/** 重置所有閃爍（登出／進度重置／測試用） */
export function clearAllChipPulses(): void {
  if (typeof window === 'undefined') return;
  const pulses = window.__uepChipPulse;
  if (!pulses) return;
  Object.values(pulses).forEach((pulse) => {
    if (pulse) window.clearTimeout(pulse.timer);
  });
  window.__uepChipPulse = {};
  notify();
}
