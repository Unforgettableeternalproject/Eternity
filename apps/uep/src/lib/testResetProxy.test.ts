import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../pages/api/test/reset';

const TEST_URL = 'https://eternity-content-api-test.ptyc4076.workers.dev';
const PROD_URL = 'https://eternity-content-api.ptyc4076.workers.dev';

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
    vi.unstubAllEnvs();
  });

  it('build-time env 指向 test Worker 時不需要 override cookie', async () => {
    vi.stubEnv('PUBLIC_CONTENT_API_URL', TEST_URL);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { version: 1 } }))
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      makeContext({ 'uep-admin-jwt': 'admin-token' })
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${TEST_URL}/api/test/reset`,
      expect.objectContaining({ method: 'POST' })
    );
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
    const snapshot = {
      version: 1,
      pages: [],
      rootProjects: [],
      rootLinks: [],
      rootUpdates: [],
      rootSingletons: [],
      rootCards: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: snapshot }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
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
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${PROD_URL}/api/test/seed-snapshot`
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${TEST_URL}/api/test/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ snapshot }),
    });
  });

  it('snapshot 取得失敗時不會呼叫 reset', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      makeContext({
        'uep-test-api-url': TEST_URL,
        'uep-admin-jwt': 'admin-token',
      })
    );

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
