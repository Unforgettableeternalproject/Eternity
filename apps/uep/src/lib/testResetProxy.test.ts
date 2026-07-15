import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../pages/api/test/reset';

const TEST_URL = 'https://eternity-content-api-test.ptyc4076.workers.dev';

type RouteContext = Parameters<typeof POST>[0];

function makeContext(values: Record<string, string>): RouteContext {
  return {
    cookies: {
      get(name: string) {
        const value = values[name];
        return value ? { value } : undefined;
      },
    },
  } as unknown as RouteContext;
}

describe('POST /api/test/reset proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('沒有 test mode cookie 時拒絕轉發', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      makeContext({ 'uep-admin-jwt': 'admin-token' })
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('使用 test cookie 路由並轉發 httpOnly JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      makeContext({
        'uep-test-api-url': TEST_URL,
        'uep-admin-jwt': 'admin-token',
      })
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(`${TEST_URL}/api/test/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
    });
  });
});
