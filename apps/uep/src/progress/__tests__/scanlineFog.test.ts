/**
 * 掃描線的迷霧閘門（S10-2 rush prevention）
 *
 * 掃描線這邊只做**判定**：迷霧線以下的標記當作不存在。推進迷霧線是
 * 呼叫端捲動取樣的職責（HistoryReader.sampleFog）——只有那裡有時間軸
 * 可以套速率上限，若閘門自己順手推進，標記通過就等於免費跳過限速。
 */
/* global IntersectionObserverEntry, IntersectionObserverInit */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROGRESS_MARKER_ROLE } from '../markers';

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

  trigger(els: Element[], isIntersecting = true) {
    this.callback(els.map((el) => ({ target: el, isIntersecting })));
  }
}

async function freshScanline() {
  vi.resetModules();
  const scanlineMod = await import('../scanline');
  const storeMod = await import('../progressStore');
  return { ...scanlineMod, ...storeMod };
}

function getObservers() {
  const [markerIO, sentinelIO] = MockIntersectionObserver.instances;
  return { markerIO, sentinelIO };
}

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
const SCROLL_HEIGHT = 10000;
const CLIENT_HEIGHT = 1000;
// 跳躍門檻 = FOG_JUMP_THRESHOLD_VH(1.5) * 1000 / 10000 = 0.15

/**
 * 建立帶捲動容器的 DOM，並把每個標記釘在指定的 ratio 位置。
 * `computeElementRatio` 讀 getBoundingClientRect + scrollTop，
 * 這裡 scrollTop 維持 0，top 直接等於 ratio * scrollHeight。
 */
function buildFogDom(markerRatios: number[], flagsAt?: Record<number, string>) {
  const root = document.createElement('div');
  const container = document.createElement('div');
  const sentinel = document.createElement('div');
  root.append(container, sentinel);
  document.body.append(root);

  Object.defineProperty(root, 'scrollHeight', {
    value: SCROLL_HEIGHT,
    configurable: true,
  });
  Object.defineProperty(root, 'clientHeight', {
    value: CLIENT_HEIGHT,
    configurable: true,
  });
  root.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;

  container.innerHTML = markerRatios
    .map((_, i) => {
      const flags = flagsAt?.[i];
      const attr = flags ? ' data-grants-flags="' + flags + '"' : '';
      return '<div data-role="' + PROGRESS_MARKER_ROLE + '"' + attr + '></div>';
    })
    .join('');
  Array.from(container.querySelectorAll('[data-role]')).forEach((el, i) => {
    el.getBoundingClientRect = () =>
      ({ top: markerRatios[i] * SCROLL_HEIGHT }) as DOMRect;
  });

  return { root, container, sentinel };
}

describe('createScanline — 迷霧閘門', () => {
  it('迷霧線以下的標記當作不存在：不授旗、不發事件、不記進度', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    // 第二個標記遠在 90%，超過 0.15 門檻
    const { root, container, sentinel } = buildFogDom([0.05, 0.9], {
      1: 'met:should-not-grant',
    });
    const passed: { index: number }[] = [];

    createScanline({
      pageId: PAGE_ID,
      container,
      sentinel,
      root,
      fogApplies: true,
      onMarkerPassed: (info) => passed.push(info),
    });
    const { markerIO } = getObservers();

    markerIO.trigger([markerIO.observed[0]]);
    markerIO.trigger([markerIO.observed[1]]); // rush 到 90%
    vi.runAllTimers();

    expect(passed.map((p) => p.index)).toEqual([0]);
    expect(uepProgress.getState().flags).not.toContain('met:should-not-grant');
    expect(uepProgress.getState().pageMarkers[PAGE_ID].maxMarkerIdx).toBe(0);
  });

  /** 閘門是純判定——推進歸捲動取樣，否則標記通過等於免費跳過限速 */
  it('通過閘門不會順手推進迷霧線', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { root, container, sentinel } = buildFogDom([0.05]);

    createScanline({
      pageId: PAGE_ID,
      container,
      sentinel,
      root,
      fogApplies: true,
    });
    const { markerIO } = getObservers();
    markerIO.trigger([markerIO.observed[0]]);
    expect(uepProgress.getState().fogRatio[PAGE_ID]).toBeUndefined();
  });

  /** 凍結只到迷霧線推進過去為止——不是 rush 一次就永久失效 */
  it('迷霧線推進後，原本被凍結的標記恢復觸發', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { root, container, sentinel } = buildFogDom([0.5], {
      0: 'met:novia',
    });
    const passed: { index: number }[] = [];

    createScanline({
      pageId: PAGE_ID,
      container,
      sentinel,
      root,
      fogApplies: true,
      onMarkerPassed: (info) => passed.push(info),
    });
    const { markerIO } = getObservers();

    markerIO.trigger([markerIO.observed[0]]); // 迷霧線在 0，50% 太遠
    expect(passed).toHaveLength(0);
    expect(uepProgress.getState().flags).not.toContain('met:novia');

    // 讀者一路讀過去（捲動取樣推進迷霧線）
    uepProgress.advanceFog(PAGE_ID, 0.4);
    markerIO.trigger([markerIO.observed[0]]);
    expect(passed.map((p) => p.index)).toEqual([0]);
    expect(uepProgress.getState().flags).toContain('met:novia');
  });

  it('哨兵進視窗但迷霧沒推到底 → 不完成、不補授旗標', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { root, container, sentinel } = buildFogDom([0.05, 0.9], {
      1: 'met:dell',
    });

    createScanline({
      pageId: PAGE_ID,
      container,
      sentinel,
      root,
      fogApplies: true,
    });
    getObservers().sentinelIO.trigger([sentinel]); // 拖捲軸直接到底

    const state = uepProgress.getState();
    expect(state.completedPageIds).not.toContain(PAGE_ID);
    expect(state.flags).not.toContain('met:dell');
    expect(state.flags).not.toContain('completed:' + PAGE_ID);
  });

  it('迷霧推到底後哨兵放行完成', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { root, container, sentinel } = buildFogDom([0.05]);

    createScanline({
      pageId: PAGE_ID,
      container,
      sentinel,
      root,
      fogApplies: true,
    });
    uepProgress.advanceFog(PAGE_ID, 1);
    // 補判需要哨兵在視窗內；此時尚未進入
    expect(uepProgress.getState().completedPageIds).not.toContain(PAGE_ID);

    getObservers().sentinelIO.trigger([sentinel]);
    expect(uepProgress.getState().completedPageIds).toContain(PAGE_ID);
  });

  /**
   * 捲到底時哨兵 IO 與迷霧取樣的先後不保證。哨兵先跑會被合取擋下，
   * 而 IO 只在交集狀態變化時回呼——沒有這個補判，讀者停在底部不動
   * 就再也等不到第二次事件，明明讀完卻卡著不完成。
   */
  it('哨兵先於迷霧到底觸發 → 迷霧補到 1 時自動補完成', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { root, container, sentinel } = buildFogDom([0.05]);

    createScanline({
      pageId: PAGE_ID,
      container,
      sentinel,
      root,
      fogApplies: true,
    });
    getObservers().sentinelIO.trigger([sentinel]); // 哨兵先到，迷霧還在 0
    expect(uepProgress.getState().completedPageIds).not.toContain(PAGE_ID);

    uepProgress.advanceFog(PAGE_ID, 1);
    expect(uepProgress.getState().completedPageIds).toContain(PAGE_ID);
  });

  it('哨兵不在視窗內時，迷霧推到底不會誤判完成', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { root, container, sentinel } = buildFogDom([0.05]);

    createScanline({
      pageId: PAGE_ID,
      container,
      sentinel,
      root,
      fogApplies: true,
    });
    getObservers().sentinelIO.trigger([sentinel], false);
    uepProgress.advanceFog(PAGE_ID, 1);
    expect(uepProgress.getState().completedPageIds).not.toContain(PAGE_ID);
  });

  it('非進度頁且無解鎖條件（fogApplies=false）完全不受限', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { root, container, sentinel } = buildFogDom([0.95], {
      0: 'met:novia',
    });

    createScanline({ pageId: PAGE_ID, container, sentinel, root });
    const { markerIO, sentinelIO } = getObservers();

    markerIO.trigger([markerIO.observed[0]]); // 直接跳到 95%
    sentinelIO.trigger([sentinel]);
    const state = uepProgress.getState();
    expect(state.flags).toContain('met:novia');
    expect(state.completedPageIds).toContain(PAGE_ID);
  });

  it('已完成過的頁面重讀時完全不受迷霧限制', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    uepProgress.markPageCompleted(PAGE_ID);
    const { root, container, sentinel } = buildFogDom([0.95], {
      0: 'met:novia',
    });

    createScanline({
      pageId: PAGE_ID,
      container,
      sentinel,
      root,
      fogApplies: true,
    });
    const { markerIO } = getObservers();
    markerIO.trigger([markerIO.observed[0]]);
    expect(uepProgress.getState().flags).toContain('met:novia');
  });

  it('短文（不需捲動）豁免迷霧，否則讀者沒有捲動空間可解鎖', async () => {
    const { createScanline, uepProgress } = await freshScanline();
    const { root, container, sentinel } = buildFogDom([0.9], {
      0: 'met:novia',
    });
    Object.defineProperty(root, 'scrollHeight', {
      value: 900,
      configurable: true,
    });

    createScanline({
      pageId: PAGE_ID,
      container,
      sentinel,
      root,
      fogApplies: true,
    });
    const { markerIO, sentinelIO } = getObservers();

    markerIO.trigger([markerIO.observed[0]]);
    sentinelIO.trigger([sentinel]);

    const state = uepProgress.getState();
    expect(state.flags).toContain('met:novia');
    expect(state.completedPageIds).toContain(PAGE_ID);
  });
});
