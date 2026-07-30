import type { APIRoute } from 'astro';

import { getApiBase, TEST_MODE_COOKIE_NAME } from '../../../lib/apiBase';

export const prerender = false;

const JWT_COOKIE = 'uep-admin-jwt';

/**
 * 互聯 key 管理 SSR proxy — 代理到 content-api 的 `/api/interlink/*`。
 *
 * `/api/interlink/keys` 與 `/usage` 都掛 `isAuthorized`，而 admin JWT 存在
 * httpOnly cookie 裡，瀏覽器端讀不到也無法自己組 Bearer header，必須由
 * server 端轉發（同 `/api/assets`、`/api/uep-admin/*` 的模式）。
 *
 * 目標 worker 由 `getApiBase` 依 test mode cookie 解析，所以 admin 切到
 * test 環境時這條 proxy 會跟著轉向 test worker。
 */

/**
 * 逐段重新編碼路徑。
 *
 * Astro 交給我們的 `params.path` 是**解碼後**的值，直接字串串接會讓
 * key 裡的 `:`／`#`／空白等字元在下一段 URL 解析時走位。逐段
 * `encodeURIComponent` 既保住 `/` 的路徑語意，也讓 worker 端的
 * `decodeURIComponent` 一定拿回原值。
 */
function encodeSubpath(path: string | undefined): string {
  if (!path) return '';
  return path.split('/').map(encodeURIComponent).join('/');
}

function makeHandler(): APIRoute {
  return async ({ request, cookies, params, url }) => {
    const contentApi = getApiBase(
      cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null
    );
    const target = `${contentApi}/api/interlink/${encodeSubpath(params.path)}${url.search}`;
    const headers = new Headers();
    const jwt = cookies.get(JWT_COOKIE)?.value;
    if (jwt) headers.set('Authorization', `Bearer ${jwt}`);
    const contentType = request.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);

    try {
      const response = await fetch(target, {
        method: request.method,
        headers,
        body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
          ? await request.arrayBuffer()
          : undefined,
      });
      return new Response(await response.text(), {
        status: response.status,
        headers: {
          'Content-Type':
            response.headers.get('Content-Type') || 'application/json',
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : 'Proxy error',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
  };
}

/** GET /api/interlink/keys, /keys/public, /anchors, /usage */
export const GET: APIRoute = makeHandler();

/** PUT /api/interlink/keys/:keyType/:keyValue */
export const PUT: APIRoute = makeHandler();

/** POST /api/interlink/reindex */
export const POST: APIRoute = makeHandler();
