import type { APIRoute } from 'astro';

import { getApiBase, TEST_MODE_COOKIE_NAME } from '../../../lib/apiBase';

export const prerender = false;

const JWT_COOKIE = 'uep-admin-jwt';

/**
 * 站台行為設定 SSR proxy — 代理到 content-api 的 `/api/settings*`。
 *
 * `/api/settings` 的 GET／PUT 是 admin only，而 admin JWT 是 httpOnly
 * cookie，瀏覽器端讀不到，必須由 server 端轉發（同 /api/flags proxy）。
 * 前台匿名讀取的 `/api/settings/public` 不經這裡——那條由
 * DesignLayout 直接打 worker（見 T-B4 接線）。
 *
 * rest 參數會匹配零段：`/api/settings` 本身走這裡，`params.path` 為
 * undefined。
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
    const subpath = encodeSubpath(params.path);
    const target = `${contentApi}/api/settings${subpath ? `/${subpath}` : ''}${url.search}`;
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

/** GET /api/settings */
export const GET: APIRoute = makeHandler();

/** PUT /api/settings */
export const PUT: APIRoute = makeHandler();
