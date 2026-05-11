import type { APIRoute } from 'astro';

export const prerender = false;

const CONTENT_API =
  import.meta.env.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';
const JWT_COOKIE = 'uep-admin-jwt';

/** 代理到 content-api，從 httpOnly cookie 取得 JWT，轉換為 Bearer token */
async function proxyToWorker(
  request: Request,
  jwt: string | undefined,
  subpath: string
): Promise<Response> {
  const target = `${CONTENT_API}/api/assets/${subpath}`;
  const headers: Record<string, string> = {};
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  const contentType = request.headers.get('Content-Type');
  if (contentType) headers['Content-Type'] = contentType;

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
      ? await request.text()
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

/** POST /api/assets/rename */
export const POST: APIRoute = makeHandler();
