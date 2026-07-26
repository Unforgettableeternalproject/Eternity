/**
 * readerAuth 單元測試（Epic 2 S5）
 *
 * module singleton，比照 progressStore 測試模式：
 * 每個測試 vi.resetModules() 取全新實例、清空 localStorage 與 window bridge。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SESSION_KEY = 'uep.reader.session.v1';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

async function freshAuth() {
  vi.resetModules();
  const mod = await import('../readerAuth');
  return mod;
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.__uepReaderAuth;
  delete window.__uepProgress;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const AUTH_DATA = {
  token: 'reader-token',
  username: 'reader-one',
  alias: '拾光的旅人',
  observerEver: false,
};

describe('訪客狀態', () => {
  it('無 session 時為訪客，顯示統一稱呼', async () => {
    const { uepReaderAuth, GUEST_ALIAS } = await freshAuth();
    expect(uepReaderAuth.isLoggedIn()).toBe(false);
    expect(uepReaderAuth.getSession()).toBeNull();
    expect(uepReaderAuth.displayAlias()).toBe(GUEST_ALIAS);
  });

  it('localStorage 有毀損 session 時視為訪客', async () => {
    window.localStorage.setItem(SESSION_KEY, '{broken!!');
    const { uepReaderAuth } = await freshAuth();
    expect(uepReaderAuth.isLoggedIn()).toBe(false);
  });
});

describe('登入', () => {
  it('登入成功後保存 session 並持久化', async () => {
    const { uepReaderAuth } = await freshAuth();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/uep/auth/login')) {
        return Promise.resolve(jsonResponse({ ok: true, data: AUTH_DATA }));
      }
      // ServerAdapter 的 progress load
      return Promise.resolve(jsonResponse({ ok: true, data: null }));
    });

    const result = await uepReaderAuth.login('reader-one', 'password-123');
    expect(result.ok).toBe(true);
    expect(uepReaderAuth.isLoggedIn()).toBe(true);
    expect(uepReaderAuth.getSession()?.alias).toBe('拾光的旅人');

    const raw = JSON.parse(window.localStorage.getItem(SESSION_KEY)!);
    expect(raw.token).toBe('reader-token');
  });

  it('登入失敗回傳錯誤且不建立 session', async () => {
    const { uepReaderAuth } = await freshAuth();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: '憑證錯誤' }, 401)
    );
    const result = await uepReaderAuth.login('reader-one', 'wrong');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('憑證錯誤');
    expect(uepReaderAuth.isLoggedIn()).toBe(false);
  });

  it('網路失敗回傳連線錯誤', async () => {
    const { uepReaderAuth } = await freshAuth();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const result = await uepReaderAuth.login('reader-one', 'password-123');
    expect(result.ok).toBe(false);
    expect(uepReaderAuth.isLoggedIn()).toBe(false);
  });
});

describe('註冊', () => {
  it('註冊成功後自動登入', async () => {
    const { uepReaderAuth } = await freshAuth();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/uep/auth/register')) {
        return Promise.resolve(
          jsonResponse({ ok: true, data: AUTH_DATA }, 201)
        );
      }
      return Promise.resolve(jsonResponse({ ok: true, data: null }));
    });

    const result = await uepReaderAuth.register({
      username: 'reader-one',
      password: 'password-123',
      alias: '拾光的旅人',
    });
    expect(result.ok).toBe(true);
    expect(uepReaderAuth.isLoggedIn()).toBe(true);
  });
});

describe('登出', () => {
  it('登出清除 session 並通知訂閱者', async () => {
    const { uepReaderAuth } = await freshAuth();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/uep/auth/login')) {
        return Promise.resolve(jsonResponse({ ok: true, data: AUTH_DATA }));
      }
      return Promise.resolve(jsonResponse({ ok: true, data: null }));
    });
    await uepReaderAuth.login('reader-one', 'password-123');

    const listener = vi.fn();
    uepReaderAuth.subscribe(listener);
    await uepReaderAuth.logout();

    expect(uepReaderAuth.isLoggedIn()).toBe(false);
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledWith(null);
  });

  /**
   * 【回歸】登出必須清空本機進度。
   *
   * ServerAdapter 一路 write-through 本地鏡像，登出後那份鏡像仍完整
   * 保有上一位登入者的 flags／完成頁／便條／閱讀時數。不清的話，
   * 共用瀏覽器的下一位訪客會直接繼承別人的閱讀足跡。
   */
  it('登出清空本機進度，觀測者印記一併清除', async () => {
    const { uepReaderAuth } = await freshAuth();
    const { getProgressManager } = await import('../../progress');
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/uep/auth/login')) {
        return Promise.resolve(jsonResponse({ ok: true, data: AUTH_DATA }));
      }
      return Promise.resolve(jsonResponse({ ok: true, data: null }));
    });
    await uepReaderAuth.login('reader-one', 'password-123');

    const progress = getProgressManager();
    progress.grantFlags(['met:asvere']);
    progress.markPageCompleted('history/1-1');
    progress.unlockIsland('history');
    progress.setView('observer');

    await uepReaderAuth.logout();

    const state = progress.getState();
    expect(state.flags).toEqual([]);
    expect(state.completedPageIds).toEqual([]);
    expect(state.islandsUnlocked).toEqual([]);
    /* 印記屬於帳號而非裝置，登出必須一起清。
       留著的話：下一位新註冊者登入 → 遠端進度為空 → setAdapter 走
       「遠端無資料則上傳本地」把殘留的 observerEver 推上去 →
       Worker 單向 OR 讓它永久生效 → 無辜帳號被蓋上觀測者印記。
       該帳號自己的印記存在伺服器 observer_ever 欄位，下次登入自然回來。 */
    expect(state.observerEver).toBe(false);
  });

  /**
   * 【回歸】跨帳號印記污染的完整重現。
   */
  it('觀測者登出後，新帳號的初始上傳不得帶著上一位的印記', async () => {
    const { uepReaderAuth } = await freshAuth();
    const { getProgressManager } = await import('../../progress');
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/uep/auth/')) {
        return Promise.resolve(jsonResponse({ ok: true, data: AUTH_DATA }));
      }
      // 新帳號：遠端無進度 → setAdapter 會上傳本地作為初始值
      return Promise.resolve(jsonResponse({ ok: true, data: null }));
    });

    // A 帳號是觀測者
    await uepReaderAuth.login('reader-observer', 'password-123');
    getProgressManager().setView('observer');
    expect(getProgressManager().getState().observerEver).toBe(true);
    await uepReaderAuth.logout();

    // B 帳號登入（同一台裝置）
    fetchMock.mockClear();
    await uepReaderAuth.login('reader-newcomer', 'password-123');

    expect(getProgressManager().getState().observerEver).toBe(false);
    type FetchInit = { method?: string; body?: unknown };
    const uploads = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/api/uep/progress') &&
        (init as FetchInit | undefined)?.method === 'PUT'
    );
    for (const [, init] of uploads) {
      const body = JSON.parse(String((init as FetchInit).body));
      expect(body.observerEver).not.toBe(true);
    }
  });

  /**
   * 【回歸】順序不可對調。
   *
   * `flush()` 靠 `getToken()` 回 null 才放棄上傳。若 reset 排在清 session
   * 之前，重置後的空進度會被 PUT 上去，**直接清空伺服器上的帳號進度**。
   */
  it('登出不得把重置後的空進度上傳到伺服器', async () => {
    const { uepReaderAuth } = await freshAuth();
    const { getProgressManager } = await import('../../progress');
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/uep/auth/login')) {
        return Promise.resolve(jsonResponse({ ok: true, data: AUTH_DATA }));
      }
      return Promise.resolve(jsonResponse({ ok: true, data: null }));
    });
    await uepReaderAuth.login('reader-one', 'password-123');
    getProgressManager().grantFlags(['met:asvere']);

    fetchMock.mockClear();
    await uepReaderAuth.logout();

    // 區域結構型別：DOM 的 RequestInit 在本專案 eslint 下會被 no-undef 判死
    type FetchInit = { method?: string; body?: unknown };
    const progressPuts = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/api/uep/progress') &&
        (init as FetchInit | undefined)?.method === 'PUT'
    );
    for (const [, init] of progressPuts) {
      const body = JSON.parse(String((init as FetchInit).body));
      expect(body.flags).not.toEqual([]);
    }
  });
});

describe('顯示代稱', () => {
  it('有觀測者印記的註冊者加上「已見證的」前綴', async () => {
    const { uepReaderAuth, WITNESSED_PREFIX } = await freshAuth();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/uep/auth/login')) {
        return Promise.resolve(
          jsonResponse({ ok: true, data: { ...AUTH_DATA, observerEver: true } })
        );
      }
      return Promise.resolve(jsonResponse({ ok: true, data: null }));
    });
    await uepReaderAuth.login('reader-one', 'password-123');
    expect(uepReaderAuth.displayAlias()).toBe(`${WITNESSED_PREFIX}拾光的旅人`);
  });
});

describe('代稱 roll', () => {
  it('rollAlias 回傳伺服器給的代稱', async () => {
    const { uepReaderAuth } = await freshAuth();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { alias: '未名的過客' } })
    );
    expect(await uepReaderAuth.rollAlias()).toBe('未名的過客');
  });

  it('rollAlias 失敗回傳 null', async () => {
    const { uepReaderAuth } = await freshAuth();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await uepReaderAuth.rollAlias()).toBeNull();
  });
});

describe('token 驗證（refresh）', () => {
  it('token 失效（401）時自動登出', async () => {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...AUTH_DATA, token: 'stale-token' })
    );
    // 阻止 import 時 auto-attach 的干擾：全部回 401
    fetchMock.mockResolvedValue(jsonResponse({ ok: false }, 401));
    const { uepReaderAuth } = await freshAuth();
    await uepReaderAuth.refresh();
    expect(uepReaderAuth.isLoggedIn()).toBe(false);
  });

  it('暫時性錯誤（500）時維持 session', async () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(AUTH_DATA));
    fetchMock.mockResolvedValue(jsonResponse({ ok: false }, 500));
    const { uepReaderAuth } = await freshAuth();
    await uepReaderAuth.refresh();
    expect(uepReaderAuth.isLoggedIn()).toBe(true);
  });
});

describe('印記即時同步（progress → session）', () => {
  it('登入者切換觀測者後 session.observerEver 立即更新，前綴即時生效', async () => {
    const { uepReaderAuth, WITNESSED_PREFIX } = await freshAuth();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/uep/auth/login')) {
        return Promise.resolve(jsonResponse({ ok: true, data: AUTH_DATA }));
      }
      return Promise.resolve(jsonResponse({ ok: true, data: null }));
    });
    await uepReaderAuth.login('reader-one', 'password-123');
    expect(uepReaderAuth.getSession()?.observerEver).toBe(false);

    const listener = vi.fn();
    uepReaderAuth.subscribe(listener);

    // 模擬 ViewSwitch：只呼叫 progress store 的 setView（印記寫入 store）
    const { getProgressManager } = await import('../../progress/progressStore');
    getProgressManager().setView('observer');

    // session 不等 refresh/重載即同步印記並通知消費端
    expect(uepReaderAuth.getSession()?.observerEver).toBe(true);
    expect(uepReaderAuth.displayAlias()).toBe(`${WITNESSED_PREFIX}拾光的旅人`);
    expect(listener).toHaveBeenCalled();
  });

  it('訪客切換觀測者不會產生 session', async () => {
    const { uepReaderAuth } = await freshAuth();
    const { getProgressManager } = await import('../../progress/progressStore');
    getProgressManager().setView('observer');
    expect(uepReaderAuth.getSession()).toBeNull();
  });
});
