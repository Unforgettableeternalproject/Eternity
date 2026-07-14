import type { APIRoute } from 'astro';
import { getApiBase } from '../../../lib/apiBase';

export const prerender = false;

const CONTENT_API = getApiBase();
const JWT_COOKIE = 'uep-admin-jwt';

/** 代理到 content-api，從 httpOnly cookie 取得 JWT，轉換為 Bearer token */
async function proxyToWorker(
  request: Request,
  jwt: string | undefined,
  subpath: string
): Promise<Response> {
  const target = `${CONTENT_API}/api/assets/${subpath}`;
  const headers = new Headers();
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`);
  const contentType = request.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
      ? await request.arrayBuffer()
      : undefined,
  });

  const headersOut = new Headers();
  for (const name of [
    'Content-Type',
    'Content-Length',
    'Content-Range',
    'Accept-Ranges',
    'Cache-Control',
  ]) {
    const value = res.headers.get(name);
    if (value) headersOut.set(name, value);
  }

  return new Response(
    request.method === 'HEAD' ? null : await res.arrayBuffer(),
    {
      status: res.status,
      headers: headersOut,
    }
  );
}

function makeHandler(): APIRoute {
  return async ({ request, cookies, params }) => {
    const jwt = cookies.get(JWT_COOKIE)?.value;
    try {
      return await proxyToWorker(request, jwt, params.path!);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Proxy error';
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}

/** DELETE /api/assets/batch, DELETE /api/assets/:key */
export const DELETE: APIRoute = makeHandler();

/** GET /api/assets/:key, HEAD /api/assets/:key */
export const GET: APIRoute = makeHandler();
export const HEAD: APIRoute = makeHandler();

/** POST /api/assets/rename */
export const POST: APIRoute = makeHandler();
