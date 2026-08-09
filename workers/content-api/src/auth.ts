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

  if (!env.JWT_SECRET) {
    // test worker 必須設定與正式相同的 JWT_SECRET 做本地驗證。
    // ⚠️ 不可改回「向正式 worker fetch /api/auth/me 遠端驗證」——兩者同屬
    // 一個 Cloudflare 帳號，worker-to-worker 的 HTTP fetch 會被擋成 error 1042，
    // 遠端驗證在真實環境永遠失敗。test env 未設 JWT_SECRET 屬部署錯誤，fail closed。
    if (env.ETERNITY_TEST_ENV === 'true') return null;
    // 僅非 test 的本地開發環境保留無 secret bypass。
    return {
      sub: 'dev',
      role: 'super_admin',
      display_name: 'Dev',
      iat: 0,
      exp: 0,
      jti: '',
    };
  }
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  // 安全邊界：讀者 token（role='reader'）與 admin token 共用 JWT_SECRET，
  // 僅靠 role 區分權限——admin 保護路由一律拒絕 reader token
  if (payload && payload.role === 'reader') return null;
  return payload;
}

/**
 * CLI 授權閘：`API_TOKEN` 或 admin JWT。
 *
 * 存在的理由：`isAuthorized`（內容端點用）一直都認 API_TOKEN，但
 * `/api/root/*` 與 `/api/assets/*` 只認 admin JWT——同一個 token 打得進
 * 前者、打不進後者。CLI 設了 API_TOKEN 之後，sync 讀遠端清單會拿到 401，
 * 而那些清單函式把讀取失敗**靜默當成「遠端是空的」**，於是本地每一筆都
 * 被算成「要推送」（2026-08-10 實際踩到，差點對正式站送出整批覆蓋）。
 *
 * API_TOKEN 的語意本來就是「CLI 的完整寫入授權」，能打內容端點卻打不進
 * 資產端點是不一致，不是刻意的權限分級。
 *
 * ⚠️ 回傳的 payload 是合成的，只為了讓既有 `if (!jwtUser) 401` 這種純
 * 授權閘沿用同一個形狀。**不要拿它的 sub 當真實使用者記錄**——需要知道
 * 「誰做的」的地方應該另外要求真正的 admin JWT。
 */
export async function requireJwtOrApiToken(
  request: Request,
  env: Env
): Promise<JwtPayload | null> {
  const auth = request.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (env.API_TOKEN && token === env.API_TOKEN) {
    return {
      sub: 'cli',
      role: 'super_admin',
      display_name: 'CLI (API_TOKEN)',
      iat: 0,
      exp: 0,
      jti: 'api-token',
    };
  }
  return requireJwt(request, env);
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
