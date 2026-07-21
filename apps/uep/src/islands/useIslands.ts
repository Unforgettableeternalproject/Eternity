/**
 * UEP 浮島系統 — React hooks
 *
 * 底層用 useSyncExternalStore 接 window.__uepIslands bridge，
 * 任何 island 之間的視窗狀態變更都會同步反映。
 */

import { useSyncExternalStore } from 'react';

import { ISLAND_DESKTOP_MIN_WIDTH, getIslandRuntime } from './islandRuntime';
import type { IslandRuntimeState } from './islandRuntime';

/** 訂閱浮島 runtime 狀態（跨 React island 同步） */
export function useIslandRuntimeState(): IslandRuntimeState {
  return useSyncExternalStore(
    (onChange) => getIslandRuntime().subscribe(onChange),
    () => getIslandRuntime().getState(),
    () => getIslandRuntime().getState()
  );
}

/**
 * 桌面浮島視窗寬度即時訂閱（matchMedia change）。
 *
 * `islandRuntime` 的 `isDesktopIslandViewport`／`canUseIslands`／
 * `shouldMountIsland` 只在呼叫當下同步讀 `window.innerWidth`——事件驅動
 * 的呼叫端（掃描線 marker 觸發、CustomEvent handler）每次都重新呼叫，
 * 天然吃到最新寬度；但**渲染時機**的呼叫端（要不要畫出浮島本體/加入
 * 佇列按鈕/映照按鈕/互動嵌入可點狀態）只在 React 重渲染當下算一次值，
 * resize／裝置旋轉不會自己觸發重渲染，畫面會停留在舊的桌面/手機判定
 * 直到其他 state 變化帶動下一次渲染。凡是把 `canUseIslands`／
 * `shouldMountIsland` 的結果直接餵進 JSX 的地方都要疊上這支 hook。
 */
export function useDesktopIslandViewport(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) {
        return () => {};
      }
      const mql = window.matchMedia(
        `(min-width: ${ISLAND_DESKTOP_MIN_WIDTH}px)`
      );
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () =>
      typeof window === 'undefined'
        ? true
        : window.innerWidth >= ISLAND_DESKTOP_MIN_WIDTH,
    // SSR snapshot：與 isDesktopIslandViewport 的 SSR fallback 一致
    () => true
  );
}
