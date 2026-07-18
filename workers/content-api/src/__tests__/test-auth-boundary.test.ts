import { describe, expect, it } from 'vitest';

import { requireJwt, signJwt } from '../auth';
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
