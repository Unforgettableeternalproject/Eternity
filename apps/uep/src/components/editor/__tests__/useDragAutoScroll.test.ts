/* eslint-disable no-undef */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDragAutoScroll } from '../useDragAutoScroll';

/**
 * useDragAutoScroll 測試（S8 驗收 #5）
 *
 * jsdom 無 layout 引擎——getBoundingClientRect / scroll 幾何全為 0，
 * 故用可控替身注入容器矩形與捲動尺寸，並把 requestAnimationFrame
 * 換成「每次 flush 只跑一幀」的手動佇列，逐幀驗證捲動行為。
 */

let el: HTMLDivElement;
let rafQueue: FrameRequestCallback[];

/** 手動 flush 一幀（跑掉當前佇列，新排入的留待下次 flush） */
function flushFrame(): void {
  const pending = rafQueue;
  rafQueue = [];
  pending.forEach((cb) => cb(0));
}

/** 設定容器幾何：矩形 top/bottom + 捲動尺寸 */
function setGeometry(opts: {
  top: number;
  bottom: number;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): void {
  el.getBoundingClientRect = () =>
    ({ top: opts.top, bottom: opts.bottom }) as DOMRect;
  el.scrollTop = opts.scrollTop;
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    value: opts.clientHeight,
  });
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    value: opts.scrollHeight,
  });
}

/** 派發帶 clientY 的 dragover（MouseEvent 有 clientY，handler 只讀它） */
function dragOver(clientY: number): void {
  el.dispatchEvent(new MouseEvent('dragover', { clientY, bubbles: true }));
}

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  el = document.createElement('div');
  document.body.appendChild(el);
});

afterEach(() => {
  el.remove();
  vi.unstubAllGlobals();
});

describe('useDragAutoScroll', () => {
  it('游標進入下緣感應帶 → 向下捲動', () => {
    // 容器 0–600，感應帶 64px；游標 570 落在下緣帶內、仍可向下捲
    setGeometry({
      top: 0,
      bottom: 600,
      scrollTop: 0,
      clientHeight: 600,
      scrollHeight: 2000,
    });
    renderHook(() => useDragAutoScroll({ current: el }));

    act(() => dragOver(570));
    act(() => flushFrame());

    expect(el.scrollTop).toBeGreaterThan(0);
  });

  it('游標進入上緣感應帶 → 向上捲動', () => {
    setGeometry({
      top: 0,
      bottom: 600,
      scrollTop: 500,
      clientHeight: 600,
      scrollHeight: 2000,
    });
    renderHook(() => useDragAutoScroll({ current: el }));

    act(() => dragOver(20));
    act(() => flushFrame());

    expect(el.scrollTop).toBeLessThan(500);
  });

  it('越接近邊緣捲得越快（線性加速）', () => {
    const measure = (clientY: number): number => {
      setGeometry({
        top: 0,
        bottom: 600,
        scrollTop: 0,
        clientHeight: 600,
        scrollHeight: 2000,
      });
      const { unmount } = renderHook(() => useDragAutoScroll({ current: el }));
      act(() => dragOver(clientY));
      act(() => flushFrame());
      const moved = el.scrollTop;
      unmount();
      return moved;
    };

    const nearEdge = measure(598); // 幾乎貼底
    const midBand = measure(560); // 感應帶中段
    expect(nearEdge).toBeGreaterThan(midBand);
  });

  it('游標在中央（感應帶外）→ 不捲動', () => {
    setGeometry({
      top: 0,
      bottom: 600,
      scrollTop: 100,
      clientHeight: 600,
      scrollHeight: 2000,
    });
    renderHook(() => useDragAutoScroll({ current: el }));

    act(() => dragOver(300));
    act(() => flushFrame());

    expect(el.scrollTop).toBe(100);
  });

  it('已捲到底 → 下緣不再捲動', () => {
    setGeometry({
      top: 0,
      bottom: 600,
      scrollTop: 1400,
      clientHeight: 600,
      scrollHeight: 2000, // scrollTop + clientHeight === scrollHeight
    });
    renderHook(() => useDragAutoScroll({ current: el }));

    act(() => dragOver(590));
    act(() => flushFrame());

    expect(el.scrollTop).toBe(1400);
  });

  it('dragend 後停止捲動迴圈', () => {
    setGeometry({
      top: 0,
      bottom: 600,
      scrollTop: 0,
      clientHeight: 600,
      scrollHeight: 2000,
    });
    renderHook(() => useDragAutoScroll({ current: el }));

    act(() => dragOver(590));
    act(() => flushFrame());
    const afterFirst = el.scrollTop;

    act(() => el.dispatchEvent(new Event('dragend')));
    act(() => flushFrame());

    // dragend 收束後不再有新的捲動幀
    expect(el.scrollTop).toBe(afterFirst);
  });

  it('ref 為 null 時安全 no-op', () => {
    expect(() =>
      renderHook(() => useDragAutoScroll({ current: null }))
    ).not.toThrow();
  });
});
