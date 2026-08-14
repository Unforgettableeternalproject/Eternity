/**
 * collectVisualClues 單元測試 — 前台孤兒容錯（第二層防禦）。
 * 區間幾何判定依賴真實 layout（getBoundingClientRect），屬手動測試
 * 範圍；此處鎖定配對規則與編輯器存檔閘同構。
 */
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { collectVisualClues, useVisualClues } from '../useVisualClues';

function makeContainer(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

const START = (
  clueId: string,
  targetKey = 'xavier-colsono',
  extra = 'data-target-type="entity" data-gallery-id="visuals/profiles/x" data-gallery-title="艾斯維爾" data-image-id="portrait" data-image-title="肖像" data-image-file="images/profiles/x/portrait.png"'
) =>
  `<div data-role="visual-clue-start" data-clue-id="${clueId}" data-target-key="${targetKey}" ${extra}></div>`;
// 真實持久化 HTML 的訖點錨點同樣帶目標屬性（renderHTML 起訖共用 attrs）
const END = (
  clueId: string,
  targetKey = 'xavier-colsono',
  extra = 'data-target-type="entity"'
) =>
  `<div data-role="visual-clue-end" data-clue-id="${clueId}" data-target-key="${targetKey}" ${extra}></div>`;

describe('collectVisualClues — 配對與孤兒容錯', () => {
  it('正常成對回傳完整 entry（目標引用讀自起點錨點）', () => {
    const container = makeContainer(
      `<p>前文</p>${START('c1')}<p>橋段</p>${END('c1')}`
    );
    const clues = collectVisualClues(container);
    expect(clues).toHaveLength(1);
    expect(clues[0]).toMatchObject({
      clueId: 'c1',
      targetType: 'entity',
      targetKey: 'xavier-colsono',
      galleryId: 'visuals/profiles/x',
      title: '艾斯維爾',
      imageId: 'portrait',
      imageTitle: '肖像',
      imageFile: 'images/profiles/x/portrait.png',
    });
    expect(clues[0].startEl).toBeInstanceOf(Element);
    expect(clues[0].endEl).toBeInstanceOf(Element);
  });

  it('illustration 目標種類正確解析', () => {
    const container = makeContainer(
      START(
        'c1',
        'scene-1',
        'data-target-type="story" data-gallery-title="初光"'
      ) + END('c1', 'scene-1', 'data-target-type="story"')
    );
    expect(collectVisualClues(container)[0].targetType).toBe('story');
  });

  it('起訖目標 key 不一致（資料損壞）整組略過', () => {
    const container = makeContainer(
      `${START('c1', 'xavier-colsono')}${END('c1', 'someone-else')}`
    );
    expect(collectVisualClues(container)).toEqual([]);
  });

  it('起訖目標種類不一致整組略過', () => {
    const container = makeContainer(
      `${START('c1', 'scene-1', 'data-target-type="story"')}` +
        END('c1', 'scene-1', 'data-target-type="entity"')
    );
    expect(collectVisualClues(container)).toEqual([]);
  });

  it('孤兒起點（無訖點）整組略過', () => {
    const container = makeContainer(`${START('c1')}<p>橋段</p>`);
    expect(collectVisualClues(container)).toEqual([]);
  });

  it('孤兒訖點（無起點）整組略過', () => {
    const container = makeContainer(`<p>橋段</p>${END('c1')}`);
    expect(collectVisualClues(container)).toEqual([]);
  });

  it('重複起點（同 clueId 兩個 start）整組略過', () => {
    const container = makeContainer(`${START('c1')}${START('c1')}${END('c1')}`);
    expect(collectVisualClues(container)).toEqual([]);
  });

  it('訖點在起點之前（亂序）整組略過', () => {
    const container = makeContainer(`${END('c1')}<p>橋段</p>${START('c1')}`);
    expect(collectVisualClues(container)).toEqual([]);
  });

  it('缺 targetKey 整組略過', () => {
    const container = makeContainer(`${START('c1', '')}${END('c1')}`);
    expect(collectVisualClues(container)).toEqual([]);
  });

  it('缺 clueId 的錨點不參與配對', () => {
    const container = makeContainer(
      `<div data-role="visual-clue-start" data-target-key="k"></div>` +
        `<div data-role="visual-clue-end"></div>`
    );
    expect(collectVisualClues(container)).toEqual([]);
  });

  it('多組 clue 各自獨立：壞的略過、好的保留', () => {
    const container = makeContainer(
      `${START('good')}<p></p>${END('good')}${START('orphan')}<p></p>`
    );
    const clues = collectVisualClues(container);
    expect(clues).toHaveLength(1);
    expect(clues[0].clueId).toBe('good');
  });

  it('巢狀結構中的錨點也會被收集配對', () => {
    const container = makeContainer(
      `<blockquote>${START('c1')}</blockquote><p></p>${END('c1')}`
    );
    expect(collectVisualClues(container)).toHaveLength(1);
  });
});

/**
 * 迷霧過濾（S10-2）。useVisualClues 是唯一繞過掃描線閘門的消費端——
 * 它自己跑捲動幾何迴圈，所以必須自己讀迷霧線，否則 rush 到文章底部時
 * 書籤照樣浮現，等於繞過 rush prevention。
 */
describe('useVisualClues — 迷霧過濾', () => {
  const SCROLL_HEIGHT = 10000;
  const CLIENT_HEIGHT = 1000;

  /** 起點在 5%、訖點在 20%，掃描線（80% 線）落在區間內 */
  function setupDom() {
    const scroller = document.createElement('div');
    const container = document.createElement('div');
    scroller.append(container);
    document.body.append(scroller);
    Object.defineProperty(scroller, 'scrollHeight', {
      value: SCROLL_HEIGHT,
      configurable: true,
    });
    scroller.getBoundingClientRect = () =>
      ({ top: 0, height: CLIENT_HEIGHT }) as DOMRect;
    container.innerHTML = `${START('c1')}<p>橋段</p>${END('c1')}`;

    const [startEl] = Array.from(
      container.querySelectorAll('[data-role="visual-clue-start"]')
    );
    const [endEl] = Array.from(
      container.querySelectorAll('[data-role="visual-clue-end"]')
    );
    startEl.getBoundingClientRect = () => ({ top: 500 }) as DOMRect; // ratio 0.05
    endEl.getBoundingClientRect = () => ({ top: 2000 }) as DOMRect;

    const containerRef = createRef<HTMLElement>();
    const scrollRef = createRef<HTMLElement>();
    (containerRef as { current: HTMLElement }).current = container;
    (scrollRef as { current: HTMLElement }).current = scroller;
    return { containerRef, scrollRef };
  }

  function render(fog: number | undefined) {
    const { containerRef, scrollRef } = setupDom();
    const fogRatioRef =
      fog === undefined ? undefined : ({ current: fog } as { current: number });
    return renderHook(() =>
      useVisualClues({
        pageId: 'history/p1',
        containerRef,
        scrollRef,
        contentKey: 'k',
        fogRatioRef,
      })
    );
  }

  it('迷霧散盡（ratio=1）時照常顯示', () => {
    expect(render(1).result.current).toHaveLength(1);
  });

  it('未提供 fogRatioRef 時不過濾（其他 zone 復用時預設不受影響）', () => {
    expect(render(undefined).result.current).toHaveLength(1);
  });

  it('起點還在迷霧線以下時不顯示書籤', () => {
    expect(render(0.01).result.current).toEqual([]);
  });

  it('迷霧線推過起點後恢復顯示', () => {
    expect(render(0.06).result.current).toHaveLength(1);
  });
});
