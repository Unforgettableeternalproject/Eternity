import type { APIRoute } from 'astro';

import { getApiBase, TEST_MODE_COOKIE_NAME } from '../../../lib/apiBase';

export const prerender = false;

const JWT_COOKIE = 'uep-admin-jwt';

export const GET: APIRoute = async ({ cookies }) => {
  const contentApi = getApiBase(
    cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null
  );
  const headers = new Headers();
  const jwt = cookies.get(JWT_COOKIE)?.value;
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`);
  try {
    const response = await fetch(`${contentApi}/api/homepage`, { headers });
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
