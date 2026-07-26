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
  onAuthExpired?: () => void,
  onRevMissing?: () => void
) {
  adapter = new ServerAdapter({
    apiBase: API,
    getToken: () => token,
    onAuthExpired,
    onRevMissing,
    debounceMs: 1000,
  });
  return adapter;
}

/**
 * 讓 adapter 取得伺服器版本號——**上傳的前置條件**。
 *
 * rev 未知時 `flush()` 一律放棄上傳（沒有 rev 只能走擋不住 admin 寫入的
 * 時間戳弱鎖），所以任何測上傳行為的案例都得先讓一次 GET 成功。
 */
async function primeRev(a: ServerAdapter, rev = 7) {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ ok: true, data: null, meta: { rev } })
  );
  await a.load();
  fetchMock.mockClear();
  return rev;
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
    const a = createAdapter();
    await primeRev(a);
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: {} }));
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
    const expired = vi.fn();
    const a = createAdapter('stale-token', expired);
    await primeRev(a);
    fetchMock.mockResolvedValue(jsonResponse({ ok: false }, 401));
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

  it('上傳一律帶 X-Progress-Rev，成功後採用回傳的新 rev', async () => {
    const a = createAdapter();
    const rev = await primeRev(a, 3);
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, data: {}, meta: { rev: rev + 1 } })
    );

    await a.save(sampleState({ flags: ['first'] }));
    await vi.advanceTimersByTimeAsync(1000);
    const [, first] = fetchMock.mock.calls[0];
    expect(
      (first as RequestInit).headers as Record<string, string>
    ).toMatchObject({ 'X-Progress-Rev': '3' });

    // 第二次上傳必須用伺服器發回的新 rev，不能重放舊的
    await a.save(sampleState({ flags: ['second'] }));
    await vi.advanceTimersByTimeAsync(1000);
    const [, second] = fetchMock.mock.calls[1];
    expect(
      (second as RequestInit).headers as Record<string, string>
    ).toMatchObject({ 'X-Progress-Rev': '4' });
  });
});

/**
 * 【回歸】rev 未知時不得走弱鎖上傳。
 *
 * 初次 GET 只要短暫失敗，rev 就是 null。舊實作此時直接省略
 * `X-Progress-Rev`、讓 worker 退回時間戳弱鎖——而弱鎖擋不住 admin 的
 * 寫入（舊分頁一次 mutation 就刷新 updatedAt 而通過）。於是「更新版
 * 前端 + 一次網路抖動」= 照樣覆蓋 admin 剛存的內容。
 */
describe('rev 未知時的上傳防線', () => {
  it('初次 GET 失敗後不得送出無 rev 的 PUT', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const revMissing = vi.fn();
    const a = createAdapter('test-token', undefined, revMissing);
    await a.load(); // 失敗 → rev 仍為 null
    fetchMock.mockClear();

    await a.save(sampleState({ flags: ['made-offline'] }));
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchMock).not.toHaveBeenCalled();
    // 改為要求呼叫端做權威 hydrate 取回 rev
    expect(revMissing).toHaveBeenCalled();
  });

  it('權威 hydrate 取回 rev 後恢復正常上傳', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const a = createAdapter();
    await a.load();

    // 呼叫端的 hydrateAuthoritative 走 loadAuthoritative，順帶補上 rev
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: null, meta: { rev: 5 } })
    );
    await a.loadAuthoritative();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: {} }));

    await a.save(sampleState({ flags: ['now-ok'] }));
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(
      (init as RequestInit).headers as Record<string, string>
    ).toMatchObject({ 'X-Progress-Rev': '5' });
  });

  it('409 之後在重新取得 rev 前不會再送出上傳', async () => {
    const a = createAdapter();
    await primeRev(a, 2);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false }, 409));
    await a.save(sampleState({ flags: ['stale'] }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 409 讓 rev 作廢；hydrate 還沒完成前的 mutation 不可帶著舊/新 rev 硬送
    fetchMock.mockClear();
    await a.save(sampleState({ flags: ['stale', 'more'] }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * 【回歸】flush 必須序列化。
 *
 * 慢網路下第一個 PUT 還沒回來，第二次 debounce 到期就帶著**同一個** rev
 * 送出：伺服器讓先到的通過、後到的回 409，而 409 觸發的權威 hydrate 會
 * 把 state 收斂成**較舊**的第一筆，較新的第二筆憑空消失。
 */
describe('flush 序列化', () => {
  it('前一個 PUT 未回來時，第二次 flush 必須排隊而非共用同一個 rev', async () => {
    const a = createAdapter();
    await primeRev(a, 1);

    // 第一個 PUT 卡住，可手動放行
    let releaseFirst!: (v: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          releaseFirst = r;
        })
    );

    await a.save(sampleState({ flags: ['first'] }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 第一個還在飛，第二次 mutation 的 debounce 就到期了
    await a.save(sampleState({ flags: ['first', 'second'] }));
    await vi.advanceTimersByTimeAsync(1000);
    // 必須還沒送出——否則兩筆共用 rev 1
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 放行第一筆，伺服器回新 rev
    releaseFirst(jsonResponse({ ok: true, data: {}, meta: { rev: 2 } }));
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, data: {}, meta: { rev: 3 } })
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, second] = fetchMock.mock.calls[1];
    // 第二筆帶的是第一筆更新過的 rev，不會撞 409
    expect(
      (second as RequestInit).headers as Record<string, string>
    ).toMatchObject({ 'X-Progress-Rev': '2' });
    expect(JSON.parse((second as RequestInit).body as string).flags).toEqual([
      'first',
      'second',
    ]);
  });
});

/**
 * 【回歸】空 blob 的兩種來歷必須分開。
 *
 * `load()` 用同一個 null 表達「新帳號」與「admin 剛重置」，呼叫端只能
 * 一律上傳本地 → admin 的重置被舊鏡像原地復原。靠 rev 分辨：
 * rev === 0 才是全新帳號。
 */
describe('loadRemote（四態語意）', () => {
  it('有 blob → present，並帶回 canonical observerEver', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: sampleState({ flags: ['remote'] }),
        meta: { rev: 4, observerEver: true },
      })
    );
    const a = createAdapter();
    const result = await a.loadRemote();
    expect(result.kind).toBe('present');
    if (result.kind !== 'present') return;
    expect(result.state.flags).toEqual(['remote']);
    expect(result.observerEver).toBe(true);
  });

  it('空 blob + rev 0 → absent（全新帳號，可匯入匿名進度）', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: null, meta: { rev: 0 } })
    );
    const a = createAdapter();
    expect((await a.loadRemote()).kind).toBe('absent');
  });

  it('空 blob + rev > 0 → empty（admin 已重置，不可上傳本地）', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: null, meta: { rev: 9 } })
    );
    const a = createAdapter();
    expect((await a.loadRemote()).kind).toBe('empty');
  });

  it('空 blob 且 meta 缺 rev（舊 worker）→ 保守當 empty', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }));
    const a = createAdapter();
    expect((await a.loadRemote()).kind).toBe('empty');
  });

  it('清空後仍保留印記：empty 也帶回 canonical observerEver', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: null,
        meta: { rev: 3, observerEver: true },
      })
    );
    const a = createAdapter();
    const result = await a.loadRemote();
    expect(result.kind).toBe('empty');
    if (result.kind !== 'empty') return;
    expect(result.observerEver).toBe(true);
  });

  it('網路失敗 → unavailable（不拿本地鏡像充數）', async () => {
    window.localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify(sampleState({ flags: ['local'] }))
    );
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const a = createAdapter();
    expect((await a.loadRemote()).kind).toBe('unavailable');
  });

  it('401 → unavailable 並觸發 onAuthExpired', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false }, 401));
    const expired = vi.fn();
    const a = createAdapter('stale-token', expired);
    expect((await a.loadRemote()).kind).toBe('unavailable');
    expect(expired).toHaveBeenCalled();
  });
});
