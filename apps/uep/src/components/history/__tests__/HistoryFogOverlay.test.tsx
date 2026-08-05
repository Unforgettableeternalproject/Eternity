/**
 * HistoryFogOverlay 量測基準測試
 *
 * 釘死一件事：**內容高度量的是 flow，不是捲動容器的 scrollHeight**。
 *
 * 遮罩是捲動容器的 absolute 子元素，而 absolute 後代會計入容器的
 * scrollable overflow——讀 `el.scrollHeight` 等於讓遮罩量到自己。
 * 遮罩底邊又剛好等於量到的高度，於是一次擾動就會啟動正回饋：
 * 底邊超出內容 → 撐大 scrollHeight → 下次量到更大的值 → 遮罩更長。
 *
 * 後果不只是文末多出捲不完的空白：ratio 的分母跟著變大，迷霧線永遠
 * 追不到底，掃描線的位置閘門就會擋掉所有標記（進度整條停擺）。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HistoryFogOverlay from '../HistoryFogOverlay';

/** jsdom 沒有版面，尺寸全部用 defineProperty 假造 */
function makeEl(props: {
  scrollHeight: number;
  clientHeight?: number;
}): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', {
    value: props.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(el, 'clientHeight', {
    value: props.clientHeight ?? 0,
    configurable: true,
  });
  return el;
}

function renderOverlay(opts: {
  ratio: number;
  /** 捲動容器回報的 scrollHeight——已被遮罩自己撐大的那個值 */
  containerScrollHeight: number;
  /** 常規流內容的真實高度 */
  flowScrollHeight: number;
  clientHeight: number;
}) {
  const scrollRef = {
    current: makeEl({
      scrollHeight: opts.containerScrollHeight,
      clientHeight: opts.clientHeight,
    }),
  };
  const flowRef = { current: makeEl({ scrollHeight: opts.flowScrollHeight }) };
  const { container } = render(
    <HistoryFogOverlay
      ratio={opts.ratio}
      scrollRef={scrollRef}
      flowRef={flowRef}
      contentKey="k"
    />
  );
  return container.querySelector<HTMLElement>('.history-fog');
}

describe('HistoryFogOverlay 量測基準', () => {
  it('容器被自己撐大時，仍以 flow 的高度計算——不放大遮罩', () => {
    // 容器多出 800px（正是遮罩自己造成的溢出），內容其實只有 2000px
    const fog = renderOverlay({
      ratio: 0.5,
      containerScrollHeight: 2800,
      flowScrollHeight: 2000,
      clientHeight: 800,
    });

    expect(fog).not.toBeNull();
    // 讀容器的話會是 1400/1400；讀 flow 才是 1000/1000
    expect(fog!.style.top).toBe('1000px');
    expect(fog!.style.height).toBe('1000px');
  });

  it('遮罩底邊等於內容高度——不超出就不會撐大容器', () => {
    const fog = renderOverlay({
      ratio: 0.3,
      containerScrollHeight: 2000,
      flowScrollHeight: 2000,
      clientHeight: 500,
    });

    const top = parseFloat(fog!.style.top);
    const height = parseFloat(fog!.style.height);
    expect(top + height).toBe(2000);
  });

  it('短到不需要捲動的內容不掛遮罩', () => {
    // 內容 900、可視 900：捲不動的頁面遮了只會製造死鎖
    expect(
      renderOverlay({
        ratio: 0.2,
        containerScrollHeight: 900,
        flowScrollHeight: 900,
        clientHeight: 900,
      })
    ).toBeNull();
  });

  it('迷霧散盡即整個卸下', () => {
    expect(
      renderOverlay({
        ratio: 1,
        containerScrollHeight: 2000,
        flowScrollHeight: 2000,
        clientHeight: 500,
      })
    ).toBeNull();
  });
});
