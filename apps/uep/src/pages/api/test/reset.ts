import type { APIRoute } from 'astro';

import {
  getApiBase,
  TEST_MODE_COOKIE_NAME,
  TEST_WORKER_BASE_URL,
} from '../../../lib/apiBase';

export const prerender = false;

const JWT_COOKIE = 'uep-admin-jwt';
const PROD_CONTENT_API = 'https://eternity-content-api.ptyc4076.workers.dev';

/**
 * 同源重置 proxy：由 SSR 讀取 httpOnly Admin JWT，並依 test mode cookie
 * 將請求轉發至測試 Worker。瀏覽器端不直接接觸 JWT。
 */
export const POST: APIRoute = async ({ cookies }) => {
  const testCookie = cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null;
  const contentApi = getApiBase(testCookie);
  const jwt = cookies.get(JWT_COOKIE)?.value;

  if (contentApi !== TEST_WORKER_BASE_URL) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Test mode cookie is required' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // seed-snapshot 端點需 admin JWT 授權；SSR 轉送 httpOnly JWT，不經瀏覽器端。
    const snapshotResponse = await fetch(
      `${PROD_CONTENT_API}/api/test/seed-snapshot`,
      jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : undefined
    );
    if (!snapshotResponse.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `無法取得正式 seed snapshot（HTTP ${snapshotResponse.status}）`,
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const snapshotJson = (await snapshotResponse.json()) as {
      ok?: boolean;
      data?: unknown;
    };
    if (!snapshotJson.ok || !snapshotJson.data) {
      return new Response(
        JSON.stringify({ ok: false, error: '正式 seed snapshot 格式錯誤' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (jwt) headers.Authorization = `Bearer ${jwt}`;

    const response = await fetch(`${contentApi}/api/test/reset`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ snapshot: snapshotJson.data }),
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
