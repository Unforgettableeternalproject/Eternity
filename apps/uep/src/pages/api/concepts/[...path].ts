import type { APIRoute } from 'astro';

import { getApiBase, TEST_MODE_COOKIE_NAME } from '../../../lib/apiBase';

export const prerender = false;

const JWT_COOKIE = 'uep-admin-jwt';

/**
 * /api/concepts/* 同源 proxy（編輯器層 API_BASE='' 的配套路由）。
 *
 * 編輯器（EntityIndexPicker / EntitySuggestExtension）在 Issue #41
 * 改走同源 proxy 後，只建了 content / assets / homepage / uep-admin
 * 四組轉發路由，漏了 concepts 前綴——導致 /api/concepts/entity-index
 * 在本地、staging、正式的編輯器內一律 404。此路由補上缺口。
 *
 * 仍只轉發 GET（concepts 前綴沒有寫入端點）。JWT 一併轉發：目前 concepts
 * 前綴只剩公開端點（`bound-keys` 隨 entityKey 撞名把關一起於 2026-08-18
 * 退場），多帶一個 header 無害，之後若再加授權端點也不必回頭補。JWT 存在
 * httpOnly cookie，瀏覽器端讀不到也組不出 Bearer header，只能由 server
 * 轉發——同 `/api/interlink/*` 的模式。
 */
export const GET: APIRoute = async ({ cookies, params, url }) => {
  const contentApi = getApiBase(
    cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null
  );
  const target = `${contentApi}/api/concepts/${params.path || ''}${url.search}`;
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
