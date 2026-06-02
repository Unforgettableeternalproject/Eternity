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

/** POST /api/assets — 上傳檔案，代理到 content-api 並自動帶 JWT */
export const POST: APIRoute = async ({ cookies, request }) => {
  const jwt = cookies.get(JWT_COOKIE)?.value;

  try {
    const headers: Record<string, string> = {};
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
    // 保留原始 Content-Type（含 multipart boundary），Worker 才能解析 FormData
    const ct = request.headers.get('Content-Type');
    if (ct) headers['Content-Type'] = ct;

    const res = await fetch(`${CONTENT_API}/api/assets`, {
      method: 'POST',
      headers,
      body: await request.arrayBuffer(),
    });

    // 回傳完整 response（包括 Content-Type）
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Proxy error';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
