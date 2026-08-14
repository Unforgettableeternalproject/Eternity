/**
 * zoneContentTargets 測試（S9-A.5）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findContentContainers,
  findScrollContainer,
  getContentSelector,
  getContentSelectorForPath,
  supportsElementAnchor,
} from '../zoneContentTargets';

describe('supportsElementAnchor', () => {
  it('文字頁 zone 支援 element 錨點', () => {
    expect(supportsElementAnchor('history')).toBe(true);
    expect(supportsElementAnchor('echoes')).toBe(true);
    expect(supportsElementAnchor('storage')).toBe(true);
  });

  it('互動元件頁 zone 不支援 → 走 page 級降級', () => {
    expect(supportsElementAnchor('visuals')).toBe(false);
    expect(supportsElementAnchor('concepts')).toBe(false);
  });

  it('null zone 不支援', () => {
    expect(supportsElementAnchor(null)).toBe(false);
  });
});

describe('getContentSelector', () => {
  it('回文字頁對應的 CSS selector', () => {
    expect(getContentSelector('history')).toBe('.history-prose');
    expect(getContentSelector('echoes')).toBe('.echoes-prose');
    expect(getContentSelector('storage')).toBe('.sto-prose');
  });

  it('互動頁 / null → null', () => {
    expect(getContentSelector('visuals')).toBeNull();
    expect(getContentSelector('concepts')).toBeNull();
    expect(getContentSelector(null)).toBeNull();
  });
});

describe('getContentSelectorForPath', () => {
  it('從 pathname 推導', () => {
    expect(getContentSelectorForPath('/history')).toBe('.history-prose');
    expect(getContentSelectorForPath('/echoes')).toBe('.echoes-prose');
    expect(getContentSelectorForPath('/storage')).toBe('.sto-prose');
  });

  it('起始頁 / 互動頁 → null', () => {
    expect(getContentSelectorForPath('/')).toBeNull();
    expect(getContentSelectorForPath('/visuals')).toBeNull();
  });
});

describe('findContentContainers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('掃 document 找所有 zone 內容容器實例', () => {
    document.body.innerHTML = `
      <div class="history-prose">A</div>
      <div class="history-prose">B</div>
      <div class="other">X</div>
    `;
    const found = findContentContainers('history');
    expect(found).toHaveLength(2);
    expect(found[0].textContent).toBe('A');
    expect(found[1].textContent).toBe('B');
  });

  it('zone 不支援 → 回空陣列', () => {
    document.body.innerHTML = `<div class="history-prose">A</div>`;
    expect(findContentContainers('visuals')).toEqual([]);
  });

  it('null zone → 回空陣列', () => {
    expect(findContentContainers(null)).toEqual([]);
  });
});

/*【回歸:07/25 四驗】首頁的區塊轉場只是**呈現**模式不同——不論 wheel delta
 * 累積後的 scrollTo 瞬跳、還是 Verse 內部手動推進，寫的都是同一個
 * `.journey-scroll.scrollTop`。因此首頁必須登記捲動容器，否則
 * findScrollContainer 會退到 document.scrollingElement，而首頁外層是
 * `height:100dvh; overflow:hidden`、document 的 scrollTop 恆為 0
 * → page 級便條的補償公式失效，便條凍結在螢幕座標不跟頁面走。 */
describe('首頁捲動容器（07/25 四驗）', () => {
  it('home zone → .journey-scroll', () => {
    document.body.innerHTML = `<div class="journey-scroll">首頁內容</div>`;
    const found = findScrollContainer('home');
    expect(found?.className).toBe('journey-scroll');
  });

  it('首頁不支援 element 錨點 → 只走 page 級', () => {
    expect(supportsElementAnchor('home')).toBe(false);
    expect(getContentSelector('home')).toBeNull();
    expect(getContentSelectorForPath('/')).toBeNull();
  });

  it('根路徑會解析到 home 的捲動容器（走 extractZone 那條鏈）', () => {
    document.body.innerHTML = `<div class="journey-scroll">首頁內容</div>`;
    // getContentSelectorForPath 內部走 extractZone('/') → 'home'
    expect(getContentSelectorForPath('/')).toBeNull(); // element 錨點不支援
    // 但捲動容器要查得到（page 級定位靠這個）
    expect(findScrollContainer('home')).not.toBeNull();
  });
});
