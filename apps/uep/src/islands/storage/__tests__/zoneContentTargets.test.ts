/**
 * zoneContentTargets 測試（S9-A.5）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findContentContainers,
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
