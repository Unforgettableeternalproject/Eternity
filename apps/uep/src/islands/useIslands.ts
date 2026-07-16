/**
 * UEP 浮島系統 — React hooks
 *
 * 底層用 useSyncExternalStore 接 window.__uepIslands bridge，
 * 任何 island 之間的視窗狀態變更都會同步反映。
 */

import { useSyncExternalStore } from 'react';

import { getIslandRuntime } from './islandRuntime';
import type { IslandRuntimeState } from './islandRuntime';

/** 訂閱浮島 runtime 狀態（跨 React island 同步） */
export function useIslandRuntimeState(): IslandRuntimeState {
  return useSyncExternalStore(
    (onChange) => getIslandRuntime().subscribe(onChange),
    () => getIslandRuntime().getState(),
    () => getIslandRuntime().getState()
  );
}
