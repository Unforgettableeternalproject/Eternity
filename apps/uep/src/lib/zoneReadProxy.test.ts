import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET as echoesGet } from '../pages/api/echoes/[...path]';
import { GET as visualsGet } from '../pages/api/visuals/[...path]';

/**
 * /api/echoes/*、/api/visuals/* 同源 proxy：編輯器的綁定候選必須以管理員
 * 身分讀取（content-api 對訪客排除封存內容），JWT 在 httpOnly cookie，
 * 只能由 proxy 轉成 Authorization header。
 */

type RouteContext = Parameters<typeof echoesGet>[0];

function makeContext(
  cookies: Record<string, string>,
  path: string,
  search = ''
): RouteContext {
  return {
    cookies: {
      get(name: string) {
        const value = cookies[name];
        return value ? { value } : undefined;
      },
    },
    params: { path },
    url: new URL(`http://localhost/api/x/${path}${search}`),
  } as unknown as RouteContext;
}

describe.each([
  ['echoes', echoesGet],
  ['visuals', visualsGet],
] as const)('GET /api/%s/* proxy', (zone, GET) => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('轉發 cookie 中的管理員 JWT 與 query，回應不可共用快取', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { entries: [] } }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(
      makeContext({ 'uep-admin-jwt': 'admin-token' }, 'entity-index', '?a=1')
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target).endsWith(`/api/${zone}/entity-index?a=1`)).toBe(true);
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer admin-token'
    );
  });

  it('沒有 JWT 時不帶 Authorization（worker 回訪客視角）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    await GET(makeContext({}, 'entity-index'));

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).has('Authorization')).toBe(false);
  });

  it('上游失敗回 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const res = await GET(makeContext({}, 'entity-index'));
    expect(res.status).toBe(502);
  });
});
