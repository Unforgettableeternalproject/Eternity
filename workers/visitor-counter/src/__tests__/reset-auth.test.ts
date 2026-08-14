import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * `/api/visitor/reset` 的授權邊界
 *
 * `JWT_SECRET` 與 content-api 共用，所以那邊簽出的**讀者** token 帶的是同一把
 * secret、簽章一定驗得過。原本這裡只驗簽章，於是任何人自行註冊一個讀者帳號就能
 * 重置兩站的訪客計數，而且過期之後仍然可以——沒有 exp 檢查等於簽過一次永久有效。
 */

const SECRET = 'shared-jwt-secret';
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as ExecutionContext;

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** 用共用 secret 簽一個 token；claims 由呼叫端全權決定 */
async function signToken(claims: Record<string, unknown>): Promise<string> {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson(claims);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

const now = () => Math.floor(Date.now() / 1000);

/** 帶 JWT_SECRET 的 env——正式環境的形狀（dev bypass 需要兩個 secret 都缺席） */
function authedEnv(overrides: Record<string, unknown> = {}) {
  return { ...env, JWT_SECRET: SECRET, ...overrides };
}

function resetRequest(token?: string): Request {
  const headers = new Headers({
    Origin: 'http://localhost:4321',
    'Content-Type': 'application/json',
  });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return new Request('http://localhost/api/visitor/reset', {
    method: 'POST',
    headers,
    body: JSON.stringify({ value: 0 }),
  });
}

describe('POST /api/visitor/reset — 授權邊界', () => {
  it('讀者 token 一律拒絕（即使簽章有效）', async () => {
    const token = await signToken({
      sub: 'attacker',
      role: 'reader',
      exp: now() + 3600,
    });
    const res = await worker.fetch(resetRequest(token), authedEnv(), ctx);
    expect(res.status).toBe(401);
  });

  it('過期的 admin token 拒絕', async () => {
    const token = await signToken({
      sub: 'admin',
      role: 'super_admin',
      exp: now() - 1,
    });
    const res = await worker.fetch(resetRequest(token), authedEnv(), ctx);
    expect(res.status).toBe(401);
  });

  it('沒有 exp 的 token 拒絕（永久有效的 token 不該存在）', async () => {
    const token = await signToken({ sub: 'admin', role: 'super_admin' });
    const res = await worker.fetch(resetRequest(token), authedEnv(), ctx);
    expect(res.status).toBe(401);
  });

  it('沒有 role 的 token 拒絕', async () => {
    const token = await signToken({ sub: 'admin', exp: now() + 3600 });
    const res = await worker.fetch(resetRequest(token), authedEnv(), ctx);
    expect(res.status).toBe(401);
  });

  it('別的 secret 簽的 admin token 拒絕', async () => {
    const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
    const payload = b64urlJson({ role: 'super_admin', exp: now() + 3600 });
    const res = await worker.fetch(
      resetRequest(`${header}.${payload}.bm90LWEtc2ln`),
      authedEnv(),
      ctx
    );
    expect(res.status).toBe(401);
  });

  it.each(['super_admin', 'editor', 'viewer'])(
    '有效的 %s token 放行',
    async (role) => {
      const token = await signToken({ sub: 'admin', role, exp: now() + 3600 });
      const res = await worker.fetch(resetRequest(token), authedEnv(), ctx);
      expect(res.status).toBe(200);
    }
  );

  it('API_TOKEN 仍可直接放行（CLI 用）', async () => {
    const res = await worker.fetch(
      resetRequest('cli-token'),
      authedEnv({ API_TOKEN: 'cli-token' }),
      ctx
    );
    expect(res.status).toBe(200);
  });

  it('無 token 拒絕', async () => {
    const res = await worker.fetch(resetRequest(), authedEnv(), ctx);
    expect(res.status).toBe(401);
  });
});

/**
 * 缺 secret 時的行為。
 *
 * 原本的判斷是「`API_TOKEN` 與 `JWT_SECRET` 都沒設就跳過授權」——正式 worker
 * 也可能因為 secret 漏設或被移除而落入這個形狀，匿名請求就能重置兩站計數。
 * 改成只認 `ETERNITY_DEV` 白名單後，缺 secret 一律 fail closed。
 */
describe('POST /api/visitor/reset — 缺 secret 的 fail-closed 邊界', () => {
  /** 部署環境形狀：沒有任何 secret，也沒有 dev 旗標 */
  function bareEnv(overrides: Record<string, unknown> = {}) {
    return {
      ...env,
      API_TOKEN: undefined,
      JWT_SECRET: undefined,
      ETERNITY_DEV: undefined,
      ...overrides,
    };
  }

  it('兩個 secret 都缺席時匿名請求拒絕（不再 fail-open）', async () => {
    const res = await worker.fetch(resetRequest(), bareEnv(), ctx);
    expect(res.status).toBe(401);
  });

  it('兩個 secret 都缺席時任意 token 也拒絕', async () => {
    const res = await worker.fetch(resetRequest('anything'), bareEnv(), ctx);
    expect(res.status).toBe(401);
  });

  it('只缺 API_TOKEN 時仍走 JWT 驗證（不因缺一個就放行）', async () => {
    const res = await worker.fetch(
      resetRequest('anything'),
      bareEnv({ JWT_SECRET: SECRET }),
      ctx
    );
    expect(res.status).toBe(401);
  });

  it('本機 wrangler dev（ETERNITY_DEV=true）保留無 token bypass', async () => {
    const res = await worker.fetch(
      resetRequest(),
      bareEnv({ ETERNITY_DEV: 'true' }),
      ctx
    );
    expect(res.status).toBe(200);
  });

  it('ETERNITY_DEV 不是字串 "true" 就不算 dev（避免誤設值放行）', async () => {
    const res = await worker.fetch(
      resetRequest(),
      bareEnv({ ETERNITY_DEV: '1' }),
      ctx
    );
    expect(res.status).toBe(401);
  });
});
