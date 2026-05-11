import type { APIRoute } from 'astro';

export const prerender = false;

const CONTENT_API =
  import.meta.env.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';
const JWT_COOKIE = 'uep-admin-jwt';

/** GET /api/assets — 代理到 content-api，從 httpOnly cookie 取得 JWT */
export const GET: APIRoute = async ({ cookies, url }) => {
  const jwt = cookies.get(JWT_COOKIE)?.value;

  try {
    const target = new URL(`${CONTENT_API}/api/assets`);
    url.searchParams.forEach((value, key) =>
      target.searchParams.set(key, value)
    );

    const headers: Record<string, string> = {};
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

    const res = await fetch(target.toString(), { headers });

    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Proxy error';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
