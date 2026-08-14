import type { APIRoute } from 'astro';

import { getApiBase, TEST_MODE_COOKIE_NAME } from '../../../lib/apiBase';

export const prerender = false;

const JWT_COOKIE = 'uep-admin-jwt';

/**
 * 旗標註冊表 SSR proxy — 代理到 content-api 的 `/api/flags/*`。
 *
 * `/api/flags` 全段 admin only（旗標名稱本身會洩漏未公開的劇情結構），
 * 而 admin JWT 是 httpOnly cookie，瀏覽器端讀不到，必須由 server 端轉發。
 *
 * ⚠️ rest 參數會匹配零段，`/api/flags` 本身（清單 GET／註冊 POST）也走這裡，
 * 此時 `params.path` 為 undefined，target 結尾多一條斜線也能被 worker 正確
 * 比對，但仍明確收斂成無尾斜線，避免與 `path === '/api/flags'` 的判斷擦邊。
 */

/**
 * 逐段重新編碼路徑。
 *
 * `params.path` 是解碼後的值，而旗標名稱帶 `:`（`met:xxx` 這類形狀）是常態，
 * 直接串接會在下一段 URL 解析時走位。逐段編碼保住 `/` 的路徑語意，讓 worker
 * 端的 `decodeURIComponent` 一定拿回原本的旗標名。
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
    const target = `${contentApi}/api/flags${subpath ? `/${subpath}` : ''}${url.search}`;
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

/** GET /api/flags, /api/flags/audit */
export const GET: APIRoute = makeHandler();

/** POST /api/flags */
export const POST: APIRoute = makeHandler();

/** PUT /api/flags/:name */
export const PUT: APIRoute = makeHandler();

/** DELETE /api/flags/:name */
export const DELETE: APIRoute = makeHandler();
