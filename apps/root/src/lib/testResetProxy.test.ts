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

describe('root POST /api/test/reset proxy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('拒絕缺少 test cookie 的請求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(
      makeContext({ 'root-admin-jwt': 'admin-token' })
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('取得 snapshot 後以 httpOnly JWT 呼叫 test reset', async () => {
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
        new Response(JSON.stringify({ ok: true, data: snapshot }))
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      makeContext({
        'root-test-api-url': encodeURIComponent(TEST_URL),
        'root-admin-jwt': 'admin-token',
      })
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(`${TEST_URL}/api/test/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ snapshot }),
    });
  });
});
