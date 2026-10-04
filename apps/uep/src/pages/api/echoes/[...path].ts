import type { APIRoute } from 'astro';

import { getApiBase, TEST_MODE_COOKIE_NAME } from '../../../lib/apiBase';

export const prerender = false;

const JWT_COOKIE = 'uep-admin-jwt';

/**
 * /api/echoes/* 同源 proxy（編輯器專用）。
 *
 * content-api 的 Echoes 讀取端點依身分回應：訪客看不到封存（metadata.locked）
 * 內容，管理員拿完整資料。JWT 存在 httpOnly cookie，瀏覽器端組不出
 * Bearer header，只能由 server 轉發——同 `/api/concepts/*` 的模式。
 * 前台讀者仍直接打 worker，不經過這裡。
 *
 * 只轉發 GET：echoes 前綴沒有寫入端點。
 */
export const GET: APIRoute = async ({ cookies, params, url }) => {
  const contentApi = getApiBase(
    cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null
  );
  const target = `${contentApi}/api/echoes/${params.path || ''}${url.search}`;
  const headers = new Headers();
  const jwt = cookies.get(JWT_COOKIE)?.value;
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`);

  try {
    const response = await fetch(target, { headers });
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: {
        'Content-Type':
          response.headers.get('Content-Type') || 'application/json',
        // 帶認證的回應依身分而異，不可進任何共用快取
        'Cache-Control': 'private, no-store',
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
