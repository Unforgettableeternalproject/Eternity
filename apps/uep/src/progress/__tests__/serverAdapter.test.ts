/**
 * ServerAdapter 單元測試（Epic 2 S5）
 *
 * 驗證：伺服器優先 load、離線 fallback 本地鏡像、
 * write-through + debounce 合批上傳、401 觸發 onAuthExpired。
 */
/* global RequestInit */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { PROGRESS_STORAGE_KEY } from '../adapters';
import { ServerAdapter } from '../serverAdapter';
import { createInitialState } from '../types';
import type { ProgressState } from '../types';

const API = 'http://api.test';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sampleState(overrides: Partial<ProgressState> = {}): ProgressState {
  return { ...createInitialState(), ...overrides };
}

let fetchMock: ReturnType<typeof vi.fn>;
let adapter: ServerAdapter | null = null;

beforeEach(() => {
  window.localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  // 先清除 fake timers 裡的 debounce，避免 destroy 的 flush 打到 unstub 後的 fetch
  adapter?.destroy();
  adapter = null;
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function createAdapter(
  token: string | null = 'test-token',
  onAuthExpired?: () => void
) {
  adapter = new ServerAdapter({
    apiBase: API,
    getToken: () => token,
    onAuthExpired,
    debounceMs: 1000,
  });
  return adapter;
}

describe('load', () => {
  it('伺服器有進度時回傳正規化後的狀態', async () => {
    const remote = sampleState({ flags: ['completed:history/1-1'] });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: remote }));
    const a = createAdapter();
    const loaded = await a.load();
    expect(loaded?.flags).toEqual(['completed:history/1-1']);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/api/uep/progress`,
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      })
    );
  });

  it('伺服器無進度（data: null）時回傳 null（store 會上傳本地）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }));
    const a = createAdapter();
    expect(await a.load()).toBeNull();
  });

  it('401 時觸發 onAuthExpired 並回傳 null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false }, 401));
    const expired = vi.fn();
    const a = createAdapter('stale-token', expired);
    expect(await a.load()).toBeNull();
    expect(expired).toHaveBeenCalled();
  });

  it('網路失敗時 fallback 本地鏡像', async () => {
    const local = sampleState({ flags: ['met:asvere'] });
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(local));
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const a = createAdapter();
    const loaded = await a.load();
    expect(loaded?.flags).toEqual(['met:asvere']);
  });

  it('無 token 時直接回傳 null 不打 API', async () => {
    const a = createAdapter(null);
    expect(await a.load()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('save（write-through + debounce）', () => {
  it('立即寫入 localStorage 鏡像', async () => {
    const a = createAdapter();
    const state = sampleState({ flags: ['completed:history/1-1'] });
    await a.save(state);
    const mirrored = JSON.parse(
      window.localStorage.getItem(PROGRESS_STORAGE_KEY)!
    );
    expect(mirrored.flags).toEqual(['completed:history/1-1']);
  });

  it('debounce 期間多次 save 只上傳一次（最後狀態）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: {} }));
    const a = createAdapter();
    await a.save(sampleState({ flags: ['a'] }));
    await a.save(sampleState({ flags: ['a', 'b'] }));
    await a.save(sampleState({ flags: ['a', 'b', 'c'] }));
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).flags).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('上傳失敗靜默不拋錯', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const a = createAdapter();
    await a.save(sampleState());
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
  });

  it('flush 收到 401 時觸發 onAuthExpired', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false }, 401));
    const expired = vi.fn();
    const a = createAdapter('stale-token', expired);
    await a.save(sampleState());
    await vi.advanceTimersByTimeAsync(1000);
    expect(expired).toHaveBeenCalled();
  });

  it('登出（token=null）後 flush 放棄上傳', async () => {
    const a = createAdapter(null);
    await a.save(sampleState());
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
