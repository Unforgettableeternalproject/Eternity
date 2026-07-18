import type { APIRoute } from 'astro';

import { getApiBase, TEST_MODE_COOKIE_NAME } from '../../../lib/apiBase';

export const prerender = false;

const JWT_COOKIE = 'uep-admin-jwt';

/**
 * 使用者管理 SSR proxy — 代理到 content-api 的 /api/uep/admin/*，
 * 從 httpOnly cookie 取得 admin JWT 轉換為 Bearer token。
 * 與 /api/assets 的 proxy 模式一致（瀏覽器端讀不到 httpOnly cookie，
 * 必須由 server 端轉發）。
 */
async function proxyToWorker(
  request: Request,
  jwt: string | undefined,
  subpath: string,
  search: string,
  contentApi: string
): Promise<Response> {
  const target = `${contentApi}/api/uep/admin/${subpath}${search}`;
  const headers = new Headers();
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`);
  const contentType = request.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
      ? await request.arrayBuffer()
      : undefined,
  });

  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json',
    },
  });
}

function makeHandler(): APIRoute {
  return async ({ request, cookies, params, url }) => {
    const jwt = cookies.get(JWT_COOKIE)?.value;
    const contentApi = getApiBase(
      cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null
    );
    try {
      return await proxyToWorker(
        request,
        jwt,
        params.path!,
        url.search,
        contentApi
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Proxy error';
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}

/** GET /api/uep-admin/users, GET /api/uep-admin/users/:id */
export const GET: APIRoute = makeHandler();

/** PUT /api/uep-admin/users/:id */
export const PUT: APIRoute = makeHandler();

/** POST /api/uep-admin/users/:id/restore */
export const POST: APIRoute = makeHandler();

/** DELETE /api/uep-admin/users/:id */
export const DELETE: APIRoute = makeHandler();
