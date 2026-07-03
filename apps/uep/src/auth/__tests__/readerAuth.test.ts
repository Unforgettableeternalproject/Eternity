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
