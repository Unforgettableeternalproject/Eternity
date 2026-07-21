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
  resolveResumeMarkerIdx,
  serializeFlagsAttr,
} from '../markers';
import { createInitialState } from '../types';
import type { PageMarkerProgress, ProgressState } from '../types';

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

  it('echo spot 納入文件順序，但不冒充 FlagMarker 授旗', () => {
    const container = makeContainer(`
      <hr>
      <div data-role="echo-spot" data-song-id="echoes/stories/a"></div>
      <div data-role="progress-marker" data-grants-flags="met:x"></div>
    `);
    const markers = collectMarkers(container);
    expect(markers.map((marker) => marker.role)).toEqual([
      'hr',
      'echo-spot',
      'progress-marker',
    ]);
    expect(markers[1].grantsFlags).toEqual([]);
    expect(markers[2].grantsFlags).toEqual(['met:x']);
  });

  it('visual clue 起點、切圖 gate、訖點納入文件順序且不授旗', () => {
    const container = makeContainer(`
      <hr>
      <div data-role="visual-clue-start" data-clue-id="clue-1"
        data-grants-flags="should:ignore"></div>
      <p>橋段內容</p>
      <div data-role="visual-clue-gate" data-clue-id="clue-1"
        data-image-id="img-2"></div>
      <div data-role="visual-clue-end" data-clue-id="clue-1"></div>
      <div data-role="progress-marker" data-grants-flags="met:x"></div>
    `);
    const markers = collectMarkers(container);
    expect(markers.map((marker) => marker.role)).toEqual([
      'hr',
      'visual-clue-start',
      'visual-clue-gate',
      'visual-clue-end',
      'progress-marker',
    ]);
    // 起訖錨點不走 grantsFlags——授旗屬 Visual Clue 點擊行為（V-D .32）
    expect(markers[1].grantsFlags).toEqual([]);
    expect(markers[2].grantsFlags).toEqual([]);
    expect(markers[3].grantsFlags).toEqual([]);
    expect(markers.map((marker) => marker.index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('isPageCompleted', () => {
  it('通過哨兵（max = total）即完成', () => {
    expect(isPageCompleted(3, 3)).toBe(true);
    expect(isPageCompleted(4, 3)).toBe(true);
  });

  it('只通過最後一個內容標記（max = total - 1）未完成', () => {
    expect(isPageCompleted(2, 3)).toBe(false);
  });

  it('無內容標記的頁面：哨兵過線（max=0, total=0）即完成', () => {
    expect(isPageCompleted(0, 0)).toBe(true);
  });
});

describe('resolveResumeMarkerIdx', () => {
  const PAGE_ID = 'history/u/chapt-01/1-1';

  function makeState(
    marker: Partial<PageMarkerProgress> | null,
    completed = false
  ): ProgressState {
    const state = createInitialState();
    if (marker) {
      state.pageMarkers[PAGE_ID] = {
        maxMarkerIdx: 0,
        lastMarkerIdx: 0,
        totalMarkers: 0,
        updatedAt: new Date().toISOString(),
        ...marker,
      };
    }
    if (completed) state.completedPageIds.push(PAGE_ID);
    return state;
  }

  it('讀到中途的頁面回傳上次位置索引', () => {
    const state = makeState({
      maxMarkerIdx: 3,
      lastMarkerIdx: 2,
      totalMarkers: 5,
    });
    expect(resolveResumeMarkerIdx(state, PAGE_ID)).toBe(2);
  });

  it('無進度紀錄回傳 null', () => {
    expect(resolveResumeMarkerIdx(makeState(null), PAGE_ID)).toBeNull();
  });

  it('上次位置在開頭（lastMarkerIdx = 0）不提示', () => {
    const state = makeState({
      maxMarkerIdx: 1,
      lastMarkerIdx: 0,
      totalMarkers: 5,
    });
    expect(resolveResumeMarkerIdx(state, PAGE_ID)).toBeNull();
  });

  it('已完成頁面即使讀完後回捲（last 變小）也不提示【回歸：Codex 審核】', () => {
    // 讀完（completedPageIds 已記錄）後回捲到中段，lastMarkerIdx 變小
    const state = makeState(
      { maxMarkerIdx: 5, lastMarkerIdx: 2, totalMarkers: 5 },
      true
    );
    expect(resolveResumeMarkerIdx(state, PAGE_ID)).toBeNull();
  });

  it('max 已達哨兵（= totalMarkers）即使 completedPageIds 缺漏也不提示', () => {
    const state = makeState({
      maxMarkerIdx: 5,
      lastMarkerIdx: 2,
      totalMarkers: 5,
    });
    expect(resolveResumeMarkerIdx(state, PAGE_ID)).toBeNull();
  });

  it('上次位置停在哨兵（無對應內容標記元素）不提示', () => {
    const state = makeState({
      maxMarkerIdx: 4,
      lastMarkerIdx: 5,
      totalMarkers: 5,
    });
    expect(resolveResumeMarkerIdx(state, PAGE_ID)).toBeNull();
  });
});

describe('completionFlag', () => {
  it('產生 completed: 前綴旗標', () => {
    expect(completionFlag('history/u/chapter-1/1-1')).toBe(
      'completed:history/u/chapter-1/1-1'
    );
  });
});
