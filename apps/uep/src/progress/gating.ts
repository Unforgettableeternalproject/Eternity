/**
 * UEP 進度系統 — Gating 條件求值器
 *
 * 內容可見性的三維條件模型：
 *
 * 1. requiresFlags — 正向條件：需持有全部旗標（AND）。
 *    觀測者視角 bypass 此條件（全知）。
 * 2. pristineOnly — 純潔者限定：從未見證過一切的人才可見。
 *    觀測者「不」bypass 此條件——這是觀測者印記的代價。
 * 3. 兩者可組合，例如：番外需要讀完某章（旗標）且無印記。
 *
 * 與既有 contentVisibility（hidden/locked/spoiler）的關係：
 * 那是編輯端手動控制的靜態語意；這裡是隨使用者進度動態求值的條件。
 * 後續 session 會讓 locked/spoiler 的判定接上這裡。
 */

import type { ProgressState } from './types';

/** 內容節點的 gating 條件（存於 page/entry/segment metadata） */
export interface GateCondition {
  /** 需持有的旗標（全部滿足，AND 語意）；觀測者 bypass */
  requiresFlags?: string[];
  /** 純潔者限定：探索者且無觀測者印記才可見；觀測者不 bypass */
  pristineOnly?: boolean;
}

/**
 * 是否為「純潔者」——從未見證過一切的人。
 * 切換至觀測者的瞬間 observerEver 即為 true，因此只需檢查印記；
 * view 的防禦性檢查是為了容忍外部資料破壞不變量的情況。
 */
export function isPristine(state: ProgressState): boolean {
  return !state.observerEver && state.view !== 'observer';
}

/** 是否持有全部旗標 */
export function hasAllFlags(state: ProgressState, flags: string[]): boolean {
  return flags.every((f) => state.flags.includes(f));
}

/**
 * 求值 gating 條件。回傳 true 表示內容對目前使用者可見。
 *
 * 求值順序：
 * 1. 無條件 → 可見
 * 2. pristineOnly 不滿足 → 不可見（觀測者與印記者到此為止）
 * 3. requiresFlags：觀測者 bypass；探索者需持有全部旗標
 */
export function evaluateGate(
  state: ProgressState,
  condition: GateCondition | null | undefined
): boolean {
  if (!condition) return true;

  if (condition.pristineOnly && !isPristine(state)) {
    return false;
  }

  const required = condition.requiresFlags;
  if (required && required.length > 0) {
    if (state.view === 'observer') return true; // 全知 bypass（已通過 pristine 檢查）
    return hasAllFlags(state, required);
  }

  return true;
}

/**
 * 從 metadata JSON 解析 gating 條件。
 * 支援兩種存放形狀：
 * - 平鋪：`{ requiresFlags: [...], pristineOnly: true }`
 * - 巢狀：`{ gate: { requiresFlags: [...], pristineOnly: true } }`
 * 無有效條件時回傳 null（代表無限制）。
 */
export function parseGateCondition(
  metadata: Record<string, unknown> | null | undefined
): GateCondition | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const source =
    typeof metadata.gate === 'object' && metadata.gate !== null
      ? (metadata.gate as Record<string, unknown>)
      : metadata;

  const condition: GateCondition = {};

  if (Array.isArray(source.requiresFlags)) {
    const flags = source.requiresFlags.filter(
      (f): f is string => typeof f === 'string' && f.length > 0
    );
    if (flags.length > 0) condition.requiresFlags = flags;
  }

  if (source.pristineOnly === true) {
    condition.pristineOnly = true;
  }

  return condition.requiresFlags || condition.pristineOnly ? condition : null;
}
