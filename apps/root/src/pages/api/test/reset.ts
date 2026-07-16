import type { APIRoute } from 'astro';

import {
  TEST_MODE_COOKIE_NAME,
  TEST_WORKER_BASE_URL,
} from '../../../lib/apiBase';

export const prerender = false;

const JWT_COOKIE = 'root-admin-jwt';
const PROD_CONTENT_API = 'https://eternity-content-api.ptyc4076.workers.dev';

function decodeCookie(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export const POST: APIRoute = async ({ cookies }) => {
  const testCookie = decodeCookie(cookies.get(TEST_MODE_COOKIE_NAME)?.value);
  if (testCookie !== TEST_WORKER_BASE_URL) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Test mode cookie is required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const snapshotResponse = await fetch(
      `${PROD_CONTENT_API}/api/test/seed-snapshot`
    );
    if (!snapshotResponse.ok) {
      throw new Error(
        `無法取得正式 seed snapshot（HTTP ${snapshotResponse.status}）`
      );
    }
    const snapshotJson = (await snapshotResponse.json()) as {
      ok?: boolean;
      data?: unknown;
    };
    if (!snapshotJson.ok || !snapshotJson.data) {
      throw new Error('正式 seed snapshot 格式錯誤');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const jwt = cookies.get(JWT_COOKIE)?.value;
    if (jwt) headers.Authorization = `Bearer ${jwt}`;

    const response = await fetch(`${TEST_WORKER_BASE_URL}/api/test/reset`, {
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
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
