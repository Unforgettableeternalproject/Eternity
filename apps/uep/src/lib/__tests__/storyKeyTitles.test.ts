/**
 * storyKeyTitles 測試
 *
 * 核心契約：同一個 storyKey 不論被幾個呼叫端／幾次重入要求，都只打一次
 * 端點；查詢失敗不落快取（下次還有機會），查無則落 null（不重查）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getCachedStoryTitle,
  loadStoryTitles,
  resetStoryTitleCache,
} from '../storyKeyTitles';

const API = 'https://api.test';

/** 回應可控時機的 fetch mock：呼叫端拿到 pending Promise，測試決定何時 resolve */
function deferredFetch(metas: Record<string, { title: string | null }>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const fetchMock = vi.fn(async (_url: string) => {
    await gate;
    return {
      ok: true,
      json: async () => ({ ok: true, data: { keyMetas: metas } }),
    } as Response;
  });
  return { fetchMock, release };
}

beforeEach(() => {
  resetStoryTitleCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadStoryTitles', () => {
  it('第一次查完後把名稱與查無都落快取', async () => {
    const { fetchMock, release } = deferredFetch({
      'story/a': { title: '劇情一號' },
    });
    vi.stubGlobal('fetch', fetchMock);
    release();

    await loadStoryTitles(API, ['story/a', 'story/b']);

    expect(getCachedStoryTitle('story/a')).toBe('劇情一號');
    expect(getCachedStoryTitle('story/b')).toBeNull();
    // 全部落快取後再呼叫不該發請求
    await loadStoryTitles(API, ['story/a', 'story/b']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('第一次尚未回來時重入，同一批 key 只發一次請求', async () => {
    const { fetchMock, release } = deferredFetch({
      'story/a': { title: '劇情一號' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = loadStoryTitles(API, ['story/a']);
    const second = loadStoryTitles(API, ['story/a']);
    release();
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getCachedStoryTitle('story/a')).toBe('劇情一號');
  });

  it('重入時只替真正沒人在查的 key 組新批次', async () => {
    const { fetchMock, release } = deferredFetch({
      'story/a': { title: '劇情一號' },
      'story/b': { title: '劇情二號' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = loadStoryTitles(API, ['story/a']);
    const second = loadStoryTitles(API, ['story/a', 'story/b']);
    release();
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(secondUrl).toContain(encodeURIComponent('story/b'));
    expect(secondUrl).not.toContain(encodeURIComponent('story/a'));
  });

  it('查詢失敗不落快取，下次呼叫會重查', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', failing);
    await loadStoryTitles(API, ['story/a']);
    expect(getCachedStoryTitle('story/a')).toBeNull();

    const { fetchMock, release } = deferredFetch({
      'story/a': { title: '劇情一號' },
    });
    vi.stubGlobal('fetch', fetchMock);
    release();
    await loadStoryTitles(API, ['story/a']);
    expect(getCachedStoryTitle('story/a')).toBe('劇情一號');
  });

  it('超過端點上限 100 就分批', async () => {
    const { fetchMock, release } = deferredFetch({});
    vi.stubGlobal('fetch', fetchMock);
    release();

    const keys = Array.from({ length: 150 }, (_, i) => `story/${i}`);
    await loadStoryTitles(API, keys);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
