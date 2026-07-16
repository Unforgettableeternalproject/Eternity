import type { APIRoute } from 'astro';

import { getApiBase, TEST_MODE_COOKIE_NAME } from '../../../lib/apiBase';

export const prerender = false;

const JWT_COOKIE = 'uep-admin-jwt';

function makeHandler(): APIRoute {
  return async ({ request, cookies, params, url }) => {
    const contentApi = getApiBase(
      cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null
    );
    const target = `${contentApi}/api/content/${params.path || ''}${url.search}`;
    const headers = new Headers();
    const jwt = cookies.get(JWT_COOKIE)?.value;
    if (jwt) headers.set('Authorization', `Bearer ${jwt}`);
    const contentType = request.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);

    try {
      const response = await fetch(target, {
        method: request.method,
        headers,
        body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
          ? await request.arrayBuffer()
          : undefined,
      });
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
}

export const GET: APIRoute = makeHandler();
export const POST: APIRoute = makeHandler();
export const PUT: APIRoute = makeHandler();
export const PATCH: APIRoute = makeHandler();
export const DELETE: APIRoute = makeHandler();
