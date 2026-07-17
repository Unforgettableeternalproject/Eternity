import type { APIRoute } from 'astro';

import { getApiBase, TEST_MODE_COOKIE_NAME } from '../../../lib/apiBase';

export const prerender = false;

/**
 * /api/concepts/* 同源 proxy（編輯器層 API_BASE='' 的配套路由）。
 *
 * 編輯器（EntityIndexPicker / EntitySuggestExtension）在 Issue #41
 * 改走同源 proxy 後，只建了 content / assets / homepage / uep-admin
 * 四組轉發路由，漏了 concepts 前綴——導致 /api/concepts/entity-index
 * 在本地、staging、正式的編輯器內一律 404。此路由補上缺口。
 *
 * concepts 前綴目前只有公開唯讀端點（entity-index、widget 摘要），
 * 因此僅轉發 GET，不需要帶 admin JWT。
 */
export const GET: APIRoute = async ({ cookies, params, url }) => {
  const contentApi = getApiBase(
    cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null
  );
  const target = `${contentApi}/api/concepts/${params.path || ''}${url.search}`;

  try {
    const response = await fetch(target);
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
