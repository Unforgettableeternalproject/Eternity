/**
 * markers.ts 單元測試 — 掃描線標記點的收集與旗標序列化
 */
import { describe, expect, it } from 'vitest';

import {
  PROGRESS_MARKER_ROLE,
  collectMarkers,
  completionFlag,
  isPageCompleted,
  parseFlagsAttr,
  serializeFlagsAttr,
} from '../markers';

describe('parseFlagsAttr', () => {
  it('解析逗號分隔旗標並去空白', () => {
    expect(parseFlagsAttr('met:novia, met:xavier')).toEqual([
      'met:novia',
      'met:xavier',
    ]);
  });

  it('過濾空值與重複', () => {
    expect(parseFlagsAttr('a,,a, b ,')).toEqual(['a', 'b']);
  });

  it('null / undefined / 空字串回傳空陣列', () => {
    expect(parseFlagsAttr(null)).toEqual([]);
    expect(parseFlagsAttr(undefined)).toEqual([]);
    expect(parseFlagsAttr('')).toEqual([]);
  });
});

describe('serializeFlagsAttr', () => {
  it('序列化為逗號分隔（正規化空白與重複）', () => {
    expect(serializeFlagsAttr([' a ', 'b', 'a'])).toBe('a,b');
  });

  it('空陣列回傳空字串', () => {
    expect(serializeFlagsAttr([])).toBe('');
  });
});

describe('collectMarkers', () => {
  function makeContainer(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
  }

  it('以文件順序收集 hr 與手動標記', () => {
    const container = makeContainer(`
      <p>段落一</p>
      <hr />
      <p>段落二</p>
      <div data-role="${PROGRESS_MARKER_ROLE}" data-grants-flags="met:novia"></div>
      <p>段落三</p>
      <hr />
    `);
    const markers = collectMarkers(container);
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.index)).toEqual([0, 1, 2]);
    expect(markers[0].el.tagName).toBe('HR');
    expect(markers[1].grantsFlags).toEqual(['met:novia']);
    expect(markers[2].grantsFlags).toEqual([]);
  });

  it('hr 不解析 grantsFlags（即使意外帶屬性也視為自動標記）', () => {
    const container = makeContainer('<hr data-grants-flags="should:ignore" />');
    expect(collectMarkers(container)[0].grantsFlags).toEqual([]);
  });

  it('無標記時回傳空陣列', () => {
    expect(collectMarkers(makeContainer('<p>純文字</p>'))).toEqual([]);
  });

  it('巢狀結構中的標記也會被收集', () => {
    const container = makeContainer(
      `<blockquote><div data-role="${PROGRESS_MARKER_ROLE}"></div></blockquote>`
    );
    expect(collectMarkers(container)).toHaveLength(1);
  });
});

describe('isPageCompleted', () => {
  it('通過最後一個標記點即完成', () => {
    expect(isPageCompleted(2, 3)).toBe(true);
    expect(isPageCompleted(3, 3)).toBe(true);
  });

  it('未達最後標記點未完成', () => {
    expect(isPageCompleted(1, 3)).toBe(false);
  });

  it('totalMarkers 為 0 時永不完成（防呆）', () => {
    expect(isPageCompleted(0, 0)).toBe(false);
  });
});

describe('completionFlag', () => {
  it('產生 completed: 前綴旗標', () => {
    expect(completionFlag('history/u/chapter-1/1-1')).toBe(
      'completed:history/u/chapter-1/1-1'
    );
  });
});
