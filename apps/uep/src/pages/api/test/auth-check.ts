import type { APIRoute } from 'astro';

import { getApiBase, TEST_MODE_COOKIE_NAME } from '../../../lib/apiBase';

// ⚠️ 臨時診斷端點（Issue #41 unauthorized 排查，確認後移除）。
// 走與 /api/content 相同的 SSR proxy 邏輯，把結果攤開給前端，
// 用來確認 proxy 是否讀到 httpOnly JWT、test worker 是否驗證通過。
export const prerender = false;

const JWT_COOKIE = 'uep-admin-jwt';

export const GET: APIRoute = async ({ cookies }) => {
  const testCookie = cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null;
  const contentApi = getApiBase(testCookie);
  const jwt = cookies.get(JWT_COOKIE)?.value;

  const headers = new Headers();
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`);

  let upstream: unknown = null;
  let upstreamStatus = 0;
  try {
    const res = await fetch(`${contentApi}/api/test/auth-debug`, { headers });
    upstreamStatus = res.status;
    upstream = JSON.parse(await res.text());
  } catch (error) {
    upstream = { error: error instanceof Error ? error.message : 'fetch failed' };
  }

  return new Response(
    JSON.stringify(
      {
        proxyReadJwt: !!jwt,
        jwtLength: jwt?.length ?? 0,
        testCookiePresent: !!testCookie,
        contentApi,
        upstreamStatus,
        upstream,
      },
      null,
      2
    ),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
