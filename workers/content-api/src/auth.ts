import type { Env, JwtPayload } from './types';

// ===== Base64url 編解碼 =====

function base64urlEncode(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const encoder = new TextEncoder();

// ===== JWT (HS256) =====

/** 簽發 JWT */
export async function signJwt(
  payload: JwtPayload,
  secret: string
): Promise<string> {
  const header = base64urlEncode(
    encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  );
  const body = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const data = `${header}.${body}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));

  return `${data}.${base64urlEncode(new Uint8Array(sig))}`;
}

/** 驗證 JWT，回傳 payload 或 null */
export async function verifyJwt(
  token: string,
  secret: string
): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const data = `${header}.${body}`;

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
      base64urlDecode(sig),
      encoder.encode(data)
    );
    if (!valid) return null;

    const payload: JwtPayload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(body))
    );

    // 檢查過期
    if (payload.exp && payload.exp < Date.now() / 1000) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * JWT 驗證 — 用於需要登入的 Admin 保護路由，回傳 payload 或 null。
 * index.ts 與 uep-auth.ts 共用，role 邊界規則只在此處定義一份。
 */
export async function requireJwt(
  request: Request,
  env: Env
): Promise<JwtPayload | null> {
  const auth = request.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : auth;

  if (!env.JWT_SECRET && env.ETERNITY_TEST_ENV === 'true') {
    if (!token || !env.TEST_AUTH_VERIFY_URL) return null;
    try {
      const response = await fetch(env.TEST_AUTH_VERIFY_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return null;
      const result = (await response.json()) as {
        ok?: boolean;
        data?: { username?: string; role?: string; display_name?: string };
      };
      if (!result.ok || !result.data?.username) return null;
      if (result.data.role === 'reader') return null;
      return {
        sub: result.data.username,
        role: result.data.role || 'admin',
        display_name: result.data.display_name || result.data.username,
        iat: 0,
        exp: 0,
        jti: 'remote-verified',
      };
    } catch {
      return null;
    }
  }

  // 僅非 test 的本地開發環境保留無 secret bypass。
  if (!env.JWT_SECRET)
    return {
      sub: 'dev',
      role: 'super_admin',
      display_name: 'Dev',
      iat: 0,
      exp: 0,
      jti: '',
    };
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  // 安全邊界：讀者 token（role='reader'）與 admin token 共用 JWT_SECRET，
  // 僅靠 role 區分權限——admin 保護路由一律拒絕 reader token
  if (payload && payload.role === 'reader') return null;
  return payload;
}

// ===== 密碼雜湊 (PBKDF2-SHA256) =====

// Workers 免費方案 CPU 限制 10ms，310k iterations 會超時
// 10k iterations 在 Workers 環境足夠安全（搭配 rate limiting + 小規模 admin）
const PBKDF2_ITERATIONS = 10_000;

/** 雜湊密碼，回傳格式 pbkdf2:iterations:salt_b64:hash_b64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );

  const saltB64 = base64urlEncode(salt);
  const hashB64 = base64urlEncode(new Uint8Array(bits));

  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltB64}:${hashB64}`;
}

/** 驗證密碼是否符合儲存的雜湊 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = parseInt(parts[1], 10);
  const salt = base64urlDecode(parts[2]);
  const expectedHash = base64urlDecode(parts[3]);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );

  const candidateHash = new Uint8Array(bits);

  // 固定時間比較，防止 timing attack
  if (candidateHash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidateHash.length; i++) {
    diff |= candidateHash[i] ^ expectedHash[i];
  }
  return diff === 0;
}
