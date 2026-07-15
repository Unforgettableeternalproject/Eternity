import type { APIRoute } from 'astro';

import {
  getApiBase,
  TEST_MODE_COOKIE_NAME,
  TEST_WORKER_BASE_URL,
} from '../../../lib/apiBase';

export const prerender = false;

const JWT_COOKIE = 'uep-admin-jwt';

/**
 * 同源重置 proxy：由 SSR 讀取 httpOnly Admin JWT，並依 test mode cookie
 * 將請求轉發至測試 Worker。瀏覽器端不直接接觸 JWT。
 */
export const POST: APIRoute = async ({ cookies }) => {
  const testCookie = cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null;
  const contentApi = getApiBase(testCookie);
  const jwt = cookies.get(JWT_COOKIE)?.value;

  if (!testCookie || contentApi !== TEST_WORKER_BASE_URL) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Test mode cookie is required' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (jwt) headers.Authorization = `Bearer ${jwt}`;

    const response = await fetch(`${contentApi}/api/test/reset`, {
      method: 'POST',
      headers,
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
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
