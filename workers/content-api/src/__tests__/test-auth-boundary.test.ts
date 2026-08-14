import { describe, expect, it } from 'vitest';

import { requireJwt, requireJwtOrApiToken, signJwt } from '../auth';
import { requireReaderJwt } from '../uep-auth';
import type { Env } from '../types';

// test worker 的 Admin JWT 邊界：改用本地 verifyJwt（與正式相同 JWT_SECRET），
// 不再向正式 worker 遠端 fetch 驗證（同帳號 worker-to-worker fetch 會 1042）。
const SECRET = 'test-jwt-secret';

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ETERNITY_TEST_ENV: 'true',
    ALLOWED_ORIGINS: '',
    ...overrides,
  } as Env;
}

/** 正式 worker 的 env 形狀：兩個旗標都沒有 */
function prodEnv(overrides: Partial<Env> = {}): Env {
  return { ALLOWED_ORIGINS: '', ...overrides } as Env;
}

/** 本機 `wrangler dev --var ETERNITY_DEV:true` 的 env 形狀 */
function devEnv(overrides: Partial<Env> = {}): Env {
  return { ETERNITY_DEV: 'true', ALLOWED_ORIGINS: '', ...overrides } as Env;
}

async function requestWithRole(
  role: 'super_admin' | 'editor' | 'reader',
  secret = SECRET
): Promise<Request> {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    {
      sub: `test-${role}`,
      role,
      display_name: `Test ${role}`,
      iat: now,
      exp: now + 3600,
      jti: `jti-${role}`,
    },
    secret
  );
  return new Request('https://test.example/api/content/history', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('Test Worker Admin JWT 邊界（本地驗證）', () => {
  it('test env 未設 JWT_SECRET 時 fail closed（不再遠端驗證，避開 1042）', async () => {
    const req = await requestWithRole('super_admin');
    expect(await requireJwt(req, testEnv())).toBeNull();
  });

  it('test env 設 JWT_SECRET 時本地驗證有效 Admin JWT', async () => {
    const req = await requestWithRole('super_admin');
    const payload = await requireJwt(req, testEnv({ JWT_SECRET: SECRET }));
    expect(payload?.sub).toBe('test-super_admin');
    expect(payload?.role).toBe('super_admin');
  });

  it('reader token 一律拒絕', async () => {
    const req = await requestWithRole('reader');
    expect(await requireJwt(req, testEnv({ JWT_SECRET: SECRET }))).toBeNull();
  });

  it('無 token 時回 null', async () => {
    const req = new Request('https://test.example/api/content/history');
    expect(await requireJwt(req, testEnv({ JWT_SECRET: SECRET }))).toBeNull();
  });

  it('JWT_SECRET 不符（jwt 由他站簽發）時驗證失敗', async () => {
    const req = await requestWithRole('super_admin', 'a-different-secret');
    expect(await requireJwt(req, testEnv({ JWT_SECRET: SECRET }))).toBeNull();
  });
});

// 讀者路徑必須與 admin 對稱地 fail closed。原本只有 admin 有這道防護，
// 讀者側無條件退回原始碼裡寫死的 DEV_JWT_SECRET——任何人都能拿那個公開字串
// 簽一個 role='reader' 的 token 冒充任意讀者，而且端點看起來完全正常。
describe('Test Worker 讀者 JWT 邊界（本地驗證）', () => {
  /** 與 uep-auth.ts 的 DEV_JWT_SECRET 同值——攻擊者手上會有的那個字串 */
  const LEAKED_DEV_SECRET = 'uep-dev-jwt-secret';

  async function readerRequest(secret: string): Promise<Request> {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        sub: 'victim',
        role: 'reader',
        display_name: '受害者',
        iat: now,
        exp: now + 3600,
        jti: 'jti-reader',
      },
      secret
    );
    return new Request('https://test.example/api/uep/progress', {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it('test env 未設 JWT_SECRET 時，用寫死的 dev secret 簽的 token 一律拒絕', async () => {
    const req = await readerRequest(LEAKED_DEV_SECRET);
    expect(await requireReaderJwt(req, testEnv())).toBeNull();
  });

  it('test env 設 JWT_SECRET 時本地驗證有效讀者 JWT', async () => {
    const req = await readerRequest(SECRET);
    const payload = await requireReaderJwt(
      req,
      testEnv({ JWT_SECRET: SECRET })
    );
    expect(payload?.sub).toBe('victim');
    expect(payload?.role).toBe('reader');
  });

  it('設了 JWT_SECRET 之後，dev secret 簽的 token 不再通過', async () => {
    const req = await readerRequest(LEAKED_DEV_SECRET);
    expect(
      await requireReaderJwt(req, testEnv({ JWT_SECRET: SECRET }))
    ).toBeNull();
  });

  it('admin token 打讀者端點一律拒絕', async () => {
    const req = await requestWithRole('super_admin');
    expect(
      await requireReaderJwt(req, testEnv({ JWT_SECRET: SECRET }))
    ).toBeNull();
  });

  it('本機 wrangler dev（ETERNITY_DEV）仍保留 dev secret fallback', async () => {
    const req = await readerRequest(LEAKED_DEV_SECRET);
    const payload = await requireReaderJwt(req, devEnv());
    expect(payload?.sub).toBe('victim');
  });
});

// 正式 worker 既沒有 ETERNITY_TEST_ENV 也沒有 ETERNITY_DEV。原本兩處認證都用
// 「非 test 即開發」的排除法判斷 fallback，於是正式環境一旦漏設／失去
// JWT_SECRET，讀者端會接受原始碼裡公開字串簽的 token，admin 端更是直接發一張
// super_admin——而且完全靜默。這組測試鎖住「白名單放行、其餘 fail closed」。
describe('正式環境形狀（無 test 旗標、無 dev 旗標）缺 JWT_SECRET 時 fail closed', () => {
  const LEAKED_DEV_SECRET = 'uep-dev-jwt-secret';

  it('admin：requireJwt 不再發放 dev super_admin 身分', async () => {
    const req = await requestWithRole('super_admin');
    expect(await requireJwt(req, prodEnv())).toBeNull();
  });

  it('admin：連無 token 的裸請求也不通過', async () => {
    const req = new Request('https://test.example/api/content/history');
    expect(await requireJwt(req, prodEnv())).toBeNull();
  });

  it('讀者：寫死的 dev secret 簽的 token 一律拒絕', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        sub: 'victim',
        role: 'reader',
        display_name: '受害者',
        iat: now,
        exp: now + 3600,
        jti: 'jti-reader-prod',
      },
      LEAKED_DEV_SECRET
    );
    const req = new Request('https://test.example/api/uep/progress', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await requireReaderJwt(req, prodEnv())).toBeNull();
  });

  it('CLI 閘：沒有 API_TOKEN 也沒有 JWT_SECRET 時不放行', async () => {
    const req = new Request('https://test.example/api/root/assets', {
      headers: { Authorization: 'Bearer anything' },
    });
    expect(await requireJwtOrApiToken(req, prodEnv())).toBeNull();
  });

  it('本機 dev 旗標下 admin 才回到無 secret bypass', async () => {
    const req = new Request('https://test.example/api/content/history');
    const payload = await requireJwt(req, devEnv());
    expect(payload?.role).toBe('super_admin');
  });
});

// API_TOKEN 一度只對內容端點有效，`/api/root/*` 與 `/api/assets/*` 卻只認
// admin JWT。CLI 設了 token 之後讀遠端清單會拿到 401，而那些清單函式把
// 讀取失敗靜默當成「遠端是空的」——差異表於是顯示「本地整批要推送」。
// 這組測試鎖住兩條路徑的一致性。
describe('CLI 授權閘（API_TOKEN 或 admin JWT）', () => {
  const API_TOKEN = 'cli-api-token';

  function tokenRequest(token: string): Request {
    return new Request('https://test.example/api/root/assets', {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it('正確的 API_TOKEN 放行，並標記為 CLI 而非真實使用者', async () => {
    const payload = await requireJwtOrApiToken(
      tokenRequest(API_TOKEN),
      testEnv({ API_TOKEN, JWT_SECRET: SECRET })
    );
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('cli');
    expect(payload?.role).toBe('super_admin');
  });

  it('錯誤的 API_TOKEN 不放行', async () => {
    expect(
      await requireJwtOrApiToken(
        tokenRequest('wrong-token'),
        testEnv({ API_TOKEN, JWT_SECRET: SECRET })
      )
    ).toBeNull();
  });

  it('未設 API_TOKEN 時不會因為湊巧相符而放行', async () => {
    expect(
      await requireJwtOrApiToken(
        tokenRequest('anything'),
        testEnv({ JWT_SECRET: SECRET })
      )
    ).toBeNull();
  });

  it('沒有 API_TOKEN 的情況下仍接受有效 admin JWT', async () => {
    const req = await requestWithRole('super_admin');
    const payload = await requireJwtOrApiToken(
      req,
      testEnv({ API_TOKEN, JWT_SECRET: SECRET })
    );
    expect(payload?.sub).toBe('test-super_admin');
  });

  it('reader token 一律拒絕（不因為多了 API_TOKEN 而鬆綁）', async () => {
    const req = await requestWithRole('reader');
    expect(
      await requireJwtOrApiToken(
        req,
        testEnv({ API_TOKEN, JWT_SECRET: SECRET })
      )
    ).toBeNull();
  });
});
