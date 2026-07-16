import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireJwt } from '../auth';
import type { Env } from '../types';

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ETERNITY_TEST_ENV: 'true',
    ALLOWED_ORIGINS: '',
    ...overrides,
  } as Env;
}

function authorizedRequest(): Request {
  return new Request('https://test.example/api/content/history', {
    headers: { Authorization: 'Bearer production-admin-jwt' },
  });
}

describe('Test Worker Admin JWT 邊界', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('test env 無 JWT secret 且無正式驗證端點時 fail closed', async () => {
    expect(await requireJwt(authorizedRequest(), testEnv())).toBeNull();
  });

  it('透過正式 /api/auth/me 驗證 Admin JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            username: 'admin',
            role: 'super_admin',
            display_name: 'Admin',
          },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const payload = await requireJwt(
      authorizedRequest(),
      testEnv({
        TEST_AUTH_VERIFY_URL: 'https://prod.example/api/auth/me',
      })
    );

    expect(payload?.sub).toBe('admin');
    expect(payload?.role).toBe('super_admin');
    expect(fetchMock).toHaveBeenCalledWith('https://prod.example/api/auth/me', {
      headers: { Authorization: 'Bearer production-admin-jwt' },
    });
  });

  it('正式驗證端點回傳 reader role 時拒絕', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            data: { username: 'reader', role: 'reader' },
          })
        )
      )
    );

    expect(
      await requireJwt(
        authorizedRequest(),
        testEnv({ TEST_AUTH_VERIFY_URL: 'https://prod.example/api/auth/me' })
      )
    ).toBeNull();
  });
});
