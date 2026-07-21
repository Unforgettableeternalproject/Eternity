/**
 * collectVisualClues 單元測試 — 前台孤兒容錯（第二層防禦）。
 * 區間幾何判定依賴真實 layout（getBoundingClientRect），屬手動測試
 * 範圍；此處鎖定配對規則與編輯器存檔閘同構。
 */
import { describe, expect, it } from 'vitest';

import { collectVisualClues } from '../useVisualClues';

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
        'data-target-type="illustration" data-gallery-title="初光"'
      ) + END('c1', 'scene-1', 'data-target-type="illustration"')
    );
    expect(collectVisualClues(container)[0].targetType).toBe('illustration');
  });

  it('起訖目標 key 不一致（資料損壞）整組略過', () => {
    const container = makeContainer(
      `${START('c1', 'xavier-colsono')}${END('c1', 'someone-else')}`
    );
    expect(collectVisualClues(container)).toEqual([]);
  });

  it('起訖目標種類不一致整組略過', () => {
    const container = makeContainer(
      `${START('c1', 'scene-1', 'data-target-type="illustration"')}` +
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
