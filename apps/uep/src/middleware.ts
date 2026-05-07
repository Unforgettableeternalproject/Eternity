/* eslint-disable no-undef */
import { defineMiddleware } from 'astro:middleware';

const JWT_COOKIE = 'uep-admin-jwt';
const ACTIVE_COOKIE = 'uep-admin-active';

// ===== JWT 驗證（與 Worker auth.ts 相同邏輯） =====

interface JwtPayload {
  sub: string;
  role: string;
  display_name: string;
  iat: number;
  exp: number;
  jti: string;
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function verifyJwt(
  token: string,
  secret: string
): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const encoder = new TextEncoder();

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      new Uint8Array(base64urlDecode(sig)) as unknown as ArrayBuffer,
      encoder.encode(data)
    );
    if (!valid) return null;

    const payload: JwtPayload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(body))
    );

    if (payload.exp && payload.exp < Date.now() / 1000) return null;

    return payload;
  } catch {
    return null;
  }
}

// ===== Middleware =====

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // 登出處理
  if (pathname === '/admin/logout' || pathname === '/admin/logout/') {
    context.cookies.delete(JWT_COOKIE, { path: '/' });
    context.cookies.delete(ACTIVE_COOKIE, { path: '/' });
    return context.redirect('/admin/login');
  }

  // 保護 /admin 路由，排除登入頁
  // 開發模式直接放行，僅正式環境驗證 JWT
  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) {
    if (import.meta.env.DEV) {
      // 開發模式：注入預設使用者，不需登入
      context.locals.user = {
        username: 'dev',
        role: 'super_admin',
        displayName: 'Developer',
      };
    } else {
      const jwtSecret = import.meta.env.JWT_SECRET;
      if (!jwtSecret) {
        console.error('[middleware] JWT_SECRET 未設定，請檢查環境變數');
        return new Response('Server configuration error', { status: 500 });
      }

      const jwtCookie = context.cookies.get(JWT_COOKIE);
      if (!jwtCookie?.value) {
        const redirect = encodeURIComponent(pathname);
        return context.redirect(`/admin/login?redirect=${redirect}`);
      }

      const payload = await verifyJwt(jwtCookie.value, jwtSecret);
      if (!payload) {
        // JWT 無效或過期 — 清除 cookie
        context.cookies.delete(JWT_COOKIE, { path: '/' });
        context.cookies.delete(ACTIVE_COOKIE, { path: '/' });
        const redirect = encodeURIComponent(pathname);
        return context.redirect(`/admin/login?redirect=${redirect}`);
      }

      // 附加使用者資訊到 locals，供下游頁面使用
      context.locals.user = {
        username: payload.sub,
        role: payload.role,
        displayName: payload.display_name,
      };
    }
  }

  return next();
});
