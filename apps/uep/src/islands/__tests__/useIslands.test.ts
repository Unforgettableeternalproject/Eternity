/**
 * useDesktopIslandViewport 測試 — resize/裝置旋轉即時重渲染（S8 手動
 * 驗收 #9 追加修復）
 *
 * islandRuntime 的 isDesktopIslandViewport 只在呼叫當下同步讀
 * window.innerWidth，本身不具重渲染能力；這支 hook 補上 matchMedia
 * change 訂閱，讓消費端能在 viewport 跨越門檻時自動重繪。
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ISLAND_DESKTOP_MIN_WIDTH } from '../islandRuntime';
import { useDesktopIslandViewport } from '../useIslands';

/** 可控制觸發 change 的 matchMedia 假實作（模擬瀏覽器 resize/旋轉）。 */
function stubMatchMedia(initialWidth: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: initialWidth,
  });
  const listeners = new Set<() => void>();
  // vitest.setup.ts 的全域 mock 用 Object.defineProperty 且未設
  // configurable:true——直接賦值覆蓋才不會撞上「無法重新定義屬性」
  // 的既知陷阱（同 IntersectionObserver 前例）。
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: window.innerWidth >= ISLAND_DESKTOP_MIN_WIDTH,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, handler: () => void) => {
      listeners.add(handler);
    },
    removeEventListener: (_: string, handler: () => void) => {
      listeners.delete(handler);
    },
    dispatchEvent: () => false,
  }));
  return {
    resizeTo(width: number) {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: width,
      });
      listeners.forEach((handler) => handler());
    },
  };
}

describe('useDesktopIslandViewport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('初始值反映當下 window.innerWidth（門檻以上為桌面）', () => {
    stubMatchMedia(1024);
    const { result } = renderHook(() => useDesktopIslandViewport());
    expect(result.current).toBe(true);
  });

  it('門檻以下（手機寬度）初始值為 false', () => {
    stubMatchMedia(375);
    const { result } = renderHook(() => useDesktopIslandViewport());
    expect(result.current).toBe(false);
  });

  it('resize 跨越門檻時即時重渲染，不需其他 state 變化觸發', () => {
    const controls = stubMatchMedia(1024);
    const { result } = renderHook(() => useDesktopIslandViewport());
    expect(result.current).toBe(true);

    act(() => controls.resizeTo(375));
    expect(result.current).toBe(false);

    act(() => controls.resizeTo(1200));
    expect(result.current).toBe(true);
  });
});
