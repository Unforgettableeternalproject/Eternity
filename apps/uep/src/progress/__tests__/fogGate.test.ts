import { describe, expect, it } from 'vitest';
import {
  FOG_JUMP_THRESHOLD_VH,
  computeContentRatio,
  computeElementRatio,
  isNonScrollable,
  isWithinFogReach,
  ratioToScrollTop,
} from '../fogGate';

const VIEWPORT = 1000;
const SCROLL_HEIGHT = 10000;

describe('computeContentRatio', () => {
  it('量的是掃描線（視窗 80% 處）掃到哪，不是捲動條拉到哪', () => {
    // 尚未捲動時，掃描線已經在 800px 處
    expect(computeContentRatio(0, VIEWPORT, SCROLL_HEIGHT)).toBe(0.08);
    expect(computeContentRatio(4200, VIEWPORT, SCROLL_HEIGHT)).toBe(0.5);
  });

  it('捲到底時 clamp 在 1，不會超過', () => {
    expect(computeContentRatio(9000, VIEWPORT, SCROLL_HEIGHT)).toBe(0.98);
    expect(computeContentRatio(99999, VIEWPORT, SCROLL_HEIGHT)).toBe(1);
  });

  it('scrollHeight 為 0 或非法時回 0，不吐 NaN 汙染 store', () => {
    expect(computeContentRatio(100, VIEWPORT, 0)).toBe(0);
    expect(computeContentRatio(100, VIEWPORT, NaN)).toBe(0);
  });
});

describe('isNonScrollable — 短文死鎖防護', () => {
  it('內容不比視窗高就豁免迷霧', () => {
    expect(isNonScrollable(800, 1000)).toBe(true);
    expect(isNonScrollable(1000, 1000)).toBe(true);
    // 1px 浮點容忍
    expect(isNonScrollable(1001, 1000)).toBe(true);
    expect(isNonScrollable(1002, 1000)).toBe(false);
  });
});

describe('isWithinFogReach — 跳躍判定', () => {
  it('往回捲一律放行（只擋往下跳）', () => {
    expect(isWithinFogReach(0.1, 0.8, VIEWPORT, SCROLL_HEIGHT)).toBe(true);
    expect(isWithinFogReach(0.8, 0.8, VIEWPORT, SCROLL_HEIGHT)).toBe(true);
  });

  it('往下推進不超過門檻（1.5 個視窗高）就放行', () => {
    // 門檻 = 1.5 * 1000 / 10000 = 0.15
    expect(isWithinFogReach(0.24, 0.1, VIEWPORT, SCROLL_HEIGHT)).toBe(true);
    expect(isWithinFogReach(0.25, 0.1, VIEWPORT, SCROLL_HEIGHT)).toBe(true);
    expect(isWithinFogReach(0.26, 0.1, VIEWPORT, SCROLL_HEIGHT)).toBe(false);
  });

  it('直接跳到文末被擋下', () => {
    expect(isWithinFogReach(1, 0.05, VIEWPORT, SCROLL_HEIGHT)).toBe(false);
  });

  /**
   * 這是整套機制最容易誤植的地方：比較基準必須是「已站穩的迷霧線」，
   * 不是「上一次取樣位置」。若比 delta，rush 之後的小幅捲動會把迷霧線
   * 一路拖著追上讀者，防護形同虛設。
   */
  it('rush 到文末後的小幅捲動不會把迷霧線拖上去', () => {
    const stored = 0.1; // 迷霧線還停在 10%
    // 讀者已經 rush 到 95%，接著只小幅捲動（delta 很小）
    expect(isWithinFogReach(0.95, stored, VIEWPORT, SCROLL_HEIGHT)).toBe(false);
    expect(isWithinFogReach(0.96, stored, VIEWPORT, SCROLL_HEIGHT)).toBe(false);
    // 退回迷霧線附近才會重新被接受
    expect(isWithinFogReach(0.2, stored, VIEWPORT, SCROLL_HEIGHT)).toBe(true);
  });

  it('門檻隨文章長度縮放，短文比例上更寬鬆', () => {
    const short = 2000;
    // 同樣 1.5vh，在短文等於 75% 的 ratio 空間
    expect(isWithinFogReach(0.8, 0.1, VIEWPORT, short)).toBe(true);
    // 同樣的 ratio 差距在長文則被擋
    expect(isWithinFogReach(0.8, 0.1, VIEWPORT, 100000)).toBe(false);
  });

  it('門檻常數就是設計文件寫的值（改動要連同實測校準）', () => {
    expect(FOG_JUMP_THRESHOLD_VH).toBe(1.5);
  });
});

describe('ratioToScrollTop — 續讀定位', () => {
  it('是 computeContentRatio 的反函式', () => {
    const scrollTop = 4200;
    const ratio = computeContentRatio(scrollTop, VIEWPORT, SCROLL_HEIGHT);
    expect(ratioToScrollTop(ratio, VIEWPORT, SCROLL_HEIGHT)).toBe(scrollTop);
  });

  it('接近開頭時反推的負值 clamp 成 0', () => {
    expect(ratioToScrollTop(0.01, VIEWPORT, SCROLL_HEIGHT)).toBe(0);
  });

  it('ratio 為 1 時不超過可捲動上限', () => {
    expect(ratioToScrollTop(1, VIEWPORT, SCROLL_HEIGHT)).toBe(9000);
  });
});

describe('computeElementRatio', () => {
  it('用捲動容器的座標系換算元素位置', () => {
    const scrollEl = document.createElement('div');
    const el = document.createElement('div');
    scrollEl.append(el);
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 10000 });
    scrollEl.scrollTop = 2000;
    scrollEl.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    el.getBoundingClientRect = () => ({ top: 600 }) as DOMRect;

    // (600 - 100 + 2000) / 10000
    expect(computeElementRatio(el, scrollEl)).toBe(0.25);
  });

  it('scrollHeight 為 0 時回 0，不吐 NaN', () => {
    const scrollEl = document.createElement('div');
    const el = document.createElement('div');
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 0 });
    scrollEl.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    el.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    expect(computeElementRatio(el, scrollEl)).toBe(0);
  });
});
