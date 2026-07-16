/**
 * 掃描線核心（createScanline）單元測試
 *
 * IntersectionObserver 在 jsdom 不存在，以 mock 類別替代並手動觸發
 * intersection entries。store 是 module singleton，比照 progressStore
 * 測試用 vi.resetModules() 隔離。
 *
 * observer 建立順序固定：instances[0] = 內容標記（80% 掃描線），
 * instances[1] = 文末哨兵（rootMargin 0，進入視窗即完成）。
 */
/* global IntersectionObserverEntry, IntersectionObserverInit */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROGRESS_MARKER_ROLE } from '../markers';

/* ── IntersectionObserver mock ── */

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IOCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: IOCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  disconnect() {
    this.disconnected = true;
  }

  unobserve() {}
  takeRecords() {
    return [];
  }

  /** 模擬指定元素過線 */
  trigger(els: Element[], isIntersecting = true) {
    this.callback(els.map((el) => ({ target: el, isIntersecting })));
  }
}

/* ── 測試環境 ── */

async function freshScanline() {
  vi.resetModules();
  const scanlineMod = await import('../scanline');
  const storeMod = await import('../progressStore');
  return { ...scanlineMod, ...storeMod };
}

function buildDom(markerHtml: string) {
  const container = document.createElement('div');
  container.innerHTML = markerHtml;
  const sentinel = document.createElement('div');
  document.body.append(container, sentinel);
  return { container, sentinel };
}

/** 取兩個 observer（內容標記 / 哨兵） */
function getObservers() {
  const [markerIO, sentinelIO] = MockIntersectionObserver.instances;
  return { markerIO, sentinelIO };
}

// vitest.setup.ts 用 defineProperty（configurable: false）定義了全域
// IntersectionObserver，vi.stubGlobal 會失敗；改用直接賦值（writable: true）
const originalIO = window.IntersectionObserver;

beforeEach(() => {
  window.localStorage.clear();
  delete window.__uepProgress;
  MockIntersectionObserver.instances = [];
  window.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.IntersectionObserver = originalIO;
  document.body.innerHTML = '';
});

const PAGE_ID = 'history/u/chapter-1/1-1';

describe('createScanline', () => {
  it('內容標記與哨兵分別由兩個 observer 觀察', async () => {
    const { createScanline } = await freshScanline();
    const { container, sentinel } = buildDom(
      `<hr /><div data-role="${PROGRESS_MARKER_ROLE}"></div><hr />`
    );

    createScanline({ pageId: PAGE_ID, container, sentinel });

    const { markerIO, sentinelIO } = getObservers();
    expect(markerIO.observed).toHaveLength(3); // 3 個內容標記
    // 掃描線位置：視窗高度 80% 處
    expect(markerIO.options?.rootMargin).toBe('0px 0px -20% 0px');
    // 哨兵不縮視窗：捲到底部進入視窗即完成
    expect(sentinelIO.observed).toEqual([sentinel]);
    expect(sentinelIO.options?.rootMargin).toBeUndefined();
  });

  it('標記過線時 max 進度立即寫入 store（totalMarkers 不含哨兵）', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom('<hr /><hr />');

    createScanline({ pageId: PAGE_ID, container, sentinel });
    const { markerIO } = getObservers();

    markerIO.trigger([markerIO.observed[0]]);
    const progress = uepProgress.getState().pageMarkers[PAGE_ID];
    expect(progress.maxMarkerIdx).toBe(0);
    expect(progress.lastMarkerIdx).toBe(0);
    expect(progress.totalMarkers).toBe(2);
  });

  it('回捲時 last 位置更新但 max 進度不倒退', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom('<hr /><hr />');

    createScanline({ pageId: PAGE_ID, container, sentinel });
    const { markerIO } = getObservers();

    markerIO.trigger([markerIO.observed[0], markerIO.observed[1]]); // 讀到 idx 1
    markerIO.trigger([markerIO.observed[0]]); // 捲回 idx 0（節流寫入）
    vi.runAllTimers();

    const progress = uepProgress.getState().pageMarkers[PAGE_ID];
    expect(progress.maxMarkerIdx).toBe(1);
    expect(progress.lastMarkerIdx).toBe(0);
  });

  it('未過線（isIntersecting=false）不計入進度', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom('<hr />');

    createScanline({ pageId: PAGE_ID, container, sentinel });
    const { markerIO, sentinelIO } = getObservers();

    markerIO.trigger([markerIO.observed[0]], false);
    sentinelIO.trigger([sentinel], false);
    vi.runAllTimers();
    expect(uepProgress.getState().pageMarkers[PAGE_ID]).toBeUndefined();
  });

  it('哨兵過線時 max = last = totalMarkers（數字直覺對齊）', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom('<hr /><hr /><hr />');

    createScanline({ pageId: PAGE_ID, container, sentinel });
    const { sentinelIO } = getObservers();

    sentinelIO.trigger([sentinel]);
    const progress = uepProgress.getState().pageMarkers[PAGE_ID];
    expect(progress.totalMarkers).toBe(3);
    expect(progress.maxMarkerIdx).toBe(3);
    expect(progress.lastMarkerIdx).toBe(3);
  });

  it('哨兵過線時回呼 isSentinel=true', async () => {
    const { createScanline } = await freshScanline();
    const { container, sentinel } = buildDom('<hr />');
    const passed: unknown[] = [];

    createScanline({
      pageId: PAGE_ID,
      container,
      sentinel,
      onMarkerPassed: (info) => passed.push(info),
    });
    const { sentinelIO } = getObservers();

    sentinelIO.trigger([sentinel]);
    expect(passed).toEqual([
      {
        index: 1,
        grantsFlags: [],
        isSentinel: true,
        totalMarkers: 1,
        element: sentinel,
        role: 'sentinel',
      },
    ]);
  });

  it('FlagMarker 過線時回呼帶 grantsFlags', async () => {
    const { createScanline } = await freshScanline();
    const { container, sentinel } = buildDom(
      `<div data-role="${PROGRESS_MARKER_ROLE}" data-grants-flags="met:novia, met:dell"></div>`
    );
    const passed: { grantsFlags: string[] }[] = [];

    createScanline({
      pageId: PAGE_ID,
      container,
      sentinel,
      onMarkerPassed: (info) => passed.push(info),
    });
    const { markerIO } = getObservers();

    markerIO.trigger([markerIO.observed[0]]);
    expect(passed[0].grantsFlags).toEqual(['met:novia', 'met:dell']);
  });

  it('destroy 時兩個 observer 都 disconnect 並 flush 未寫入的位置', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom('<hr /><hr />');

    const handle = createScanline({ pageId: PAGE_ID, container, sentinel });
    const { markerIO, sentinelIO } = getObservers();

    markerIO.trigger([markerIO.observed[0], markerIO.observed[1]]); // max=1 立即寫入
    markerIO.trigger([markerIO.observed[0]]); // last=0 進入節流
    handle.destroy(); // 不等節流，直接 flush

    expect(markerIO.disconnected).toBe(true);
    expect(sentinelIO.disconnected).toBe(true);
    const progress = uepProgress.getState().pageMarkers[PAGE_ID];
    expect(progress.lastMarkerIdx).toBe(0);
    expect(progress.maxMarkerIdx).toBe(1);
  });

  it('跨 session 續讀：既有 max 進度不因重新觀察而倒退', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom('<hr /><hr /><hr />');

    // 模擬前一次 session 已讀到 idx 2
    uepProgress.updatePageMarker(PAGE_ID, 2, 2, 3);

    createScanline({ pageId: PAGE_ID, container, sentinel });
    const { markerIO } = getObservers();

    markerIO.trigger([markerIO.observed[0]]); // 這次 session 只過了 idx 0
    vi.runAllTimers();

    const progress = uepProgress.getState().pageMarkers[PAGE_ID];
    expect(progress.maxMarkerIdx).toBe(2);
    expect(progress.lastMarkerIdx).toBe(0);
  });

  it('FlagMarker 過線時授予旗標到 store', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom(
      `<div data-role="${PROGRESS_MARKER_ROLE}" data-grants-flags="met:novia"></div>`
    );

    createScanline({ pageId: PAGE_ID, container, sentinel });
    const { markerIO } = getObservers();

    markerIO.trigger([markerIO.observed[0]]);
    expect(uepProgress.getState().flags).toContain('met:novia');
  });

  it('重複過線不重複授予旗標', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom(
      `<div data-role="${PROGRESS_MARKER_ROLE}" data-grants-flags="met:novia"></div>`
    );

    createScanline({ pageId: PAGE_ID, container, sentinel });
    const { markerIO } = getObservers();

    markerIO.trigger([markerIO.observed[0]]);
    markerIO.trigger([markerIO.observed[0]]);
    expect(
      uepProgress.getState().flags.filter((f) => f === 'met:novia')
    ).toHaveLength(1);
  });

  it('通過哨兵時標記頁面完成並授予 completed:* 旗標', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom('<hr />');

    createScanline({ pageId: PAGE_ID, container, sentinel });
    const { sentinelIO } = getObservers();

    sentinelIO.trigger([sentinel]);
    const state = uepProgress.getState();
    expect(state.completedPageIds).toContain(PAGE_ID);
    expect(state.flags).toContain(`completed:${PAGE_ID}`);
  });

  it('通過哨兵時補授所有 FlagMarker 旗標（高速滾動漏報兜底）', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom(
      `<div data-role="${PROGRESS_MARKER_ROLE}" data-grants-flags="met:novia"></div>
       <hr />
       <div data-role="${PROGRESS_MARKER_ROLE}" data-grants-flags="met:dell"></div>`
    );

    createScanline({ pageId: PAGE_ID, container, sentinel });
    const { sentinelIO } = getObservers();

    // 直接跳到文末——中途 FlagMarker 一個都沒觸發
    sentinelIO.trigger([sentinel]);
    const state = uepProgress.getState();
    expect(state.flags).toContain('met:novia');
    expect(state.flags).toContain('met:dell');
    expect(state.completedPageIds).toContain(PAGE_ID);
  });

  it('未通過哨兵不標記完成', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom('<hr /><hr />');

    createScanline({ pageId: PAGE_ID, container, sentinel });
    const { markerIO } = getObservers();

    markerIO.trigger([markerIO.observed[0], markerIO.observed[1]]); // 只過標記，沒過哨兵
    const state = uepProgress.getState();
    expect(state.completedPageIds).not.toContain(PAGE_ID);
    expect(state.flags).toEqual([]);
  });

  it('無內容標記的頁面：哨兵過線即完成（total=0, max=0）', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { container, sentinel } = buildDom('<p>短文，沒有任何標記</p>');

    createScanline({ pageId: PAGE_ID, container, sentinel });
    const { sentinelIO } = getObservers();

    sentinelIO.trigger([sentinel]);
    const state = uepProgress.getState();
    expect(state.completedPageIds).toContain(PAGE_ID);
    const progress = state.pageMarkers[PAGE_ID];
    expect(progress.totalMarkers).toBe(0);
    expect(progress.maxMarkerIdx).toBe(0);
  });

  it('IntersectionObserver 不存在時安靜降級', async () => {
    window.IntersectionObserver =
      undefined as unknown as typeof IntersectionObserver;
    const { createScanline } = await freshScanline();
    const { container, sentinel } = buildDom('<hr />');
    const handle = createScanline({ pageId: PAGE_ID, container, sentinel });
    expect(() => handle.destroy()).not.toThrow();
  });
});
