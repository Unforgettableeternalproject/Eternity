import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dispatchIslandRelated,
  getRelatedPendingFlag,
  setRelatedPendingFlag,
  subscribeIslandRelated,
  subscribeRelatedPending,
  triggerStoryRelated,
} from '../interlinkTrigger';
import { ISLAND_RELATED_EVENT } from '../types';

/** 建立回傳指定錨點清單的 fetch stub */
function stubAnchors(anchors: unknown[] | null, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok,
        json: () =>
          Promise.resolve(
            anchors === null
              ? { ok: false, error: 'nope' }
              : { ok: true, data: { anchors } }
          ),
      })
    )
  );
}

const anchor = (pageId: string) => ({
  pageId,
  pageTitle: `標題 ${pageId}`,
  anchorKind: 'echo-spot',
  anchorId: 'spot-1',
  label: '雨海終曲',
});

describe('triggerStoryRelated', () => {
  let received: unknown[];
  let unsubscribe: () => void;

  beforeEach(() => {
    received = [];
    unsubscribe?.();
    unsubscribe = subscribeIslandRelated((detail) => received.push(detail));
    window.__uepIslandRelatedPending = {};
  });

  it('查到錨點 → 廣播給 History 島，帶去重後的頁面與標題', async () => {
    stubAnchors([
      anchor('history/ch1'),
      anchor('history/ch1'), // 同頁多個錨點（start/end）
      anchor('history/ch2'),
    ]);
    const broadcast = await triggerStoryRelated({
      apiBase: 'http://api',
      sourceZone: 'echoes',
      storyKey: 'rain-sea-finale',
      label: '雨海終曲',
    });
    expect(broadcast).toBe(true);
    expect(received).toEqual([
      {
        targetIsland: 'history',
        sourceZone: 'echoes',
        items: [
          { pageId: 'history/ch1', title: '標題 history/ch1' },
          { pageId: 'history/ch2', title: '標題 history/ch2' },
        ],
        label: '雨海終曲',
      },
    ]);
  });

  /* entityKey 不再連 History（艾斯維爾 2026-07-27）——這裡只吃 storyKey，
   * 端點也只用 keyType=story 查，不再有 entity 那條分支 */
  it('一律以 keyType=story 查詢', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        requested.push(String(url));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { anchors: [] } }),
        });
      })
    );
    await triggerStoryRelated({
      apiBase: 'http://api',
      sourceZone: 'echoes',
      storyKey: 'k',
      label: 'x',
    });
    expect(requested[0]).toContain('keyType=story');
  });

  it('查無錨點 → 不廣播（不彈空卡片），回傳 false 供手動觸發端給回饋', async () => {
    stubAnchors([]);
    const broadcast = await triggerStoryRelated({
      apiBase: 'http://api',
      sourceZone: 'visuals',
      storyKey: 'nobody',
      label: '沒人提過',
    });
    expect(broadcast).toBe(false);
    expect(received).toEqual([]);
  });

  it('端點回 ok:false → 不廣播', async () => {
    stubAnchors(null);
    await triggerStoryRelated({
      apiBase: 'http://api',
      sourceZone: 'echoes',
      storyKey: 'x',
      label: 'x',
    });
    expect(received).toEqual([]);
  });

  it('HTTP 失敗 → 不廣播', async () => {
    stubAnchors([anchor('history/ch1')], false);
    await triggerStoryRelated({
      apiBase: 'http://api',
      sourceZone: 'echoes',
      storyKey: 'x',
      label: 'x',
    });
    expect(received).toEqual([]);
  });

  it('網路例外 → 靜默略過，不讓 Reader 爆掉', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline')))
    );
    await expect(
      triggerStoryRelated({
        apiBase: 'http://api',
        sourceZone: 'echoes',
        storyKey: 'x',
        label: 'x',
      })
    ).resolves.toBe(false);
    expect(received).toEqual([]);
  });

  it('空 key 直接跳過，不打端點', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await triggerStoryRelated({
      apiBase: 'http://api',
      sourceZone: 'echoes',
      storyKey: '',
      label: 'x',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('key 會被 URL 編碼', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        requested.push(String(url));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { anchors: [] } }),
        });
      })
    );
    await triggerStoryRelated({
      apiBase: 'http://api',
      sourceZone: 'echoes',
      storyKey: 'a b',
      label: 'x',
    });
    expect(requested[0]).toContain('key=a%20b');
  });
});

describe('setRelatedPendingFlag', () => {
  beforeEach(() => {
    window.__uepIslandRelatedPending = {};
  });

  it('讀寫待處理旗標', () => {
    expect(getRelatedPendingFlag('history')).toBe(false);
    setRelatedPendingFlag('history', true);
    expect(getRelatedPendingFlag('history')).toBe(true);
    setRelatedPendingFlag('history', false);
    expect(getRelatedPendingFlag('history')).toBe(false);
  });

  it('值沒變時不重複廣播', () => {
    const seen: boolean[] = [];
    const off = subscribeRelatedPending((_zone, hasPending) =>
      seen.push(hasPending)
    );
    setRelatedPendingFlag('history', true);
    setRelatedPendingFlag('history', true);
    setRelatedPendingFlag('history', false);
    off();
    expect(seen).toEqual([true, false]);
  });

  it('各島的旗標互不影響', () => {
    setRelatedPendingFlag('history', true);
    expect(getRelatedPendingFlag('echoes')).toBe(false);
    expect(getRelatedPendingFlag('history')).toBe(true);
  });
});

describe('subscribeIslandRelated', () => {
  it('解除訂閱後不再收到事件', () => {
    const seen: unknown[] = [];
    const off = subscribeIslandRelated((detail) => seen.push(detail));
    dispatchIslandRelated({
      targetIsland: 'history',
      sourceZone: 'echoes',
      items: [{ pageId: 'history/a', title: 'A' }],
      label: 'A',
    });
    off();
    dispatchIslandRelated({
      targetIsland: 'history',
      sourceZone: 'echoes',
      items: [{ pageId: 'history/b', title: 'B' }],
      label: 'B',
    });
    expect(seen).toHaveLength(1);
  });

  it('沒有 detail 的事件不觸發 listener', () => {
    const seen: unknown[] = [];
    const off = subscribeIslandRelated((detail) => seen.push(detail));
    window.dispatchEvent(new CustomEvent(ISLAND_RELATED_EVENT));
    off();
    expect(seen).toEqual([]);
  });
});
