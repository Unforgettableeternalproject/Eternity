/**
 * UEP 進度系統 — React hook
 *
 * 讓 React island 訂閱全域進度狀態。
 * 底層用 useSyncExternalStore 接 window.__uepProgress bridge，
 * 任何 island 之間的狀態變更都會同步反映。
 */

import { useSyncExternalStore } from 'react';

import { evaluateGate } from './gating';
import type { GateCondition } from './gating';
import { getProgressManager } from './progressStore';
import type { ProgressState } from './types';

/** 訂閱全域進度狀態（跨 island 同步） */
export function useProgress(): ProgressState {
  return useSyncExternalStore(
    (onChange) => getProgressManager().subscribe(onChange),
    () => getProgressManager().getState(),
    () => getProgressManager().getState()
  );
}

/**
 * 求值 gating 條件並隨進度變更自動更新。
 * 回傳 true 表示內容對目前使用者可見。
 */
export function useGate(condition: GateCondition | null | undefined): boolean {
  const state = useProgress();
  return evaluateGate(state, condition);
}
