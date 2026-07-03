/**
 * UEP 讀者帳號路由（Epic 2 S5）— /api/uep/*
 *
 * 與 admin 認證完全分離：
 * - 資料表：uep_users（admin_users 不動）
 * - JWT：共用 JWT_SECRET 但 payload.role = 'reader'，
 *   admin 保護路由（requireJwt）拒絕 reader token，
 *   本模組的 requireReaderJwt 也只接受 reader token（雙向隔離）。
 *
 * 端點：
 * - POST /api/uep/auth/register — 註冊（帳密 + 可選 email + 代稱），成功即回 token
 * - POST /api/uep/auth/login    — 登入
 * - GET  /api/uep/auth/me       — 驗證 token，回傳使用者資訊
 * - GET  /api/uep/alias/roll    — 隨機 roll 一個代稱（註冊 UI 用，公開）
 * - GET  /api/uep/progress      — 讀取進度（ProgressState JSON）
 * - PUT  /api/uep/progress      — 寫入進度（observerEver 單向遞增，鏡射至 observer_ever 欄）
 */

import type {
  ApiResponse,
  Env,
  JwtPayload,
  LoginRequest,
  UepRegisterRequest,
  UepUserRow,
} from './types';
import { hashPassword, signJwt, verifyJwt, verifyPassword } from './auth';
import { isValidAlias, rollAlias } from './uep-alias';

/** 讀者 token 有效期：30 天（閱讀進度帳號，不需像 admin 一樣每日過期） */
const READER_TOKEN_TTL = 30 * 86400;

/** progress blob 大小上限（bytes）——防止濫用；正常 ProgressState 遠小於此 */
const PROGRESS_MAX_BYTES = 131072; // 128 KB

function json<T>(
  data: ApiResponse<T>,
  status = 200,
  cors: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** 讀者 JWT 驗證 — 只接受 role='reader' 的 token */
export async function requireReaderJwt(
  request: Request,
  env: Env
): Promise<JwtPayload | null> {
  // 開發模式（無 JWT_SECRET）：注入預設讀者
  if (!env.JWT_SECRET)
    return {
      sub: 'dev-reader',
      role: 'reader',
      display_name: '開發用讀者',
      iat: 0,
      exp: 0,
      jti: '',
    };
  const auth = request.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || payload.role !== 'reader') return null;
  return payload;
}

/** 簽發讀者 token */
async function issueReaderToken(
  user: Pick<UepUserRow, 'username' | 'alias'>,
  jwtSecret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jti = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const payload: JwtPayload = {
    sub: user.username,
    role: 'reader',
    display_name: user.alias,
    iat: now,
    exp: now + READER_TOKEN_TTL,
    jti,
  };
  return signJwt(payload, jwtSecret);
}

/** 使用者公開資訊（回應用，不含敏感欄位） */
function publicUser(row: UepUserRow) {
  return {
    username: row.username,
    alias: row.alias,
    email: row.email,
    observerEver: row.observer_ever === 1,
    hasProgress: row.progress !== null,
    createdAt: row.created_at,
  };
}

// ===== 註冊 =====

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/;
// 寬鬆 email 格式檢查（真正的驗證交給之後的信箱確認機制，S5 只存字串）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleRegister(
  body: UepRegisterRequest,
  db: D1Database,
  jwtSecret: string,
  cors: Record<string, string>
): Promise<Response> {
  const username = (body.username || '').trim();
  const password = body.password || '';
  const email = (body.email || '').trim();

  if (!USERNAME_RE.test(username)) {
    return json(
      {
        ok: false,
        error: '帳號需為 3-32 字元的英數字（可含 - 與 _，開頭需為英數字）',
      },
      400,
      cors
    );
  }
  if (password.length < 8 || password.length > 128) {
    return json({ ok: false, error: '密碼長度需為 8-128 字元' }, 400, cors);
  }
  if (email && !EMAIL_RE.test(email)) {
    return json({ ok: false, error: '郵件信箱格式不正確' }, 400, cors);
  }

  // 代稱：客戶端 roll 過的必須是詞庫合法組合，否則由伺服器 roll
  const alias =
    body.alias && isValidAlias(body.alias) ? body.alias : rollAlias();

  // 檢查帳號是否已存在（COLLATE NOCASE 由 schema 保證，這裡先查避免吃 constraint error）
  const existing = await db
    .prepare('SELECT id FROM uep_users WHERE username = ?')
    .bind(username)
    .first<{ id: number }>();
  if (existing) {
    return json({ ok: false, error: '這個帳號已經被使用了' }, 409, cors);
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO uep_users (username, password_hash, email, alias, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(username, passwordHash, email || null, alias, now, now)
    .run();

  const token = await issueReaderToken({ username, alias }, jwtSecret);

  return json(
    {
      ok: true,
      data: {
        token,
        username,
        alias,
        observerEver: false,
        hasProgress: false,
      },
    },
    201,
    cors
  );
}

// ===== 登入 =====

async function handleLogin(
  body: LoginRequest,
  db: D1Database,
  jwtSecret: string,
  cors: Record<string, string>
): Promise<Response> {
  const row = await db
    .prepare('SELECT * FROM uep_users WHERE username = ? AND is_active = 1')
    .bind(body.username || '')
    .first<UepUserRow>();

  if (!row) {
    // 與 admin login 相同：固定延遲防 timing 洩漏帳號存在性
    await new Promise((r) => setTimeout(r, 200));
    return json({ ok: false, error: '憑證錯誤' }, 401, cors);
  }

  const valid = await verifyPassword(body.password || '', row.password_hash);
  if (!valid) {
    await new Promise((r) => setTimeout(r, 200));
    return json({ ok: false, error: '憑證錯誤' }, 401, cors);
  }

  const token = await issueReaderToken(row, jwtSecret);

  return json(
    {
      ok: true,
      data: {
        token,
        username: row.username,
        alias: row.alias,
        observerEver: row.observer_ever === 1,
        hasProgress: row.progress !== null,
      },
    },
    200,
    cors
  );
}

// ===== me =====

async function handleMe(
  request: Request,
  db: D1Database,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const payload = await requireReaderJwt(request, env);
  if (!payload) {
    return json({ ok: false, error: 'Unauthorized' }, 401, cors);
  }
  const row = await db
    .prepare('SELECT * FROM uep_users WHERE username = ? AND is_active = 1')
    .bind(payload.sub)
    .first<UepUserRow>();
  if (!row) {
    return json({ ok: false, error: '帳號不存在或已停用' }, 401, cors);
  }
  return json({ ok: true, data: publicUser(row) }, 200, cors);
}

// ===== 進度同步 =====

async function handleGetProgress(
  request: Request,
  db: D1Database,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const payload = await requireReaderJwt(request, env);
  if (!payload) {
    return json({ ok: false, error: 'Unauthorized' }, 401, cors);
  }
  const row = await db
    .prepare(
      'SELECT progress FROM uep_users WHERE username = ? AND is_active = 1'
    )
    .bind(payload.sub)
    .first<Pick<UepUserRow, 'progress'>>();
  if (!row) {
    return json({ ok: false, error: '帳號不存在或已停用' }, 401, cors);
  }

  if (!row.progress) {
    return json({ ok: true, data: null }, 200, cors);
  }
  try {
    return json({ ok: true, data: JSON.parse(row.progress) }, 200, cors);
  } catch {
    // 資料毀損：視為無進度（客戶端會以本地資料重新上傳）
    return json({ ok: true, data: null }, 200, cors);
  }
}

async function handlePutProgress(
  request: Request,
  db: D1Database,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const payload = await requireReaderJwt(request, env);
  if (!payload) {
    return json({ ok: false, error: 'Unauthorized' }, 401, cors);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: '無效的 JSON' }, 400, cors);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ ok: false, error: '進度資料必須是物件' }, 400, cors);
  }

  const row = await db
    .prepare(
      'SELECT observer_ever FROM uep_users WHERE username = ? AND is_active = 1'
    )
    .bind(payload.sub)
    .first<Pick<UepUserRow, 'observer_ever'>>();
  if (!row) {
    return json({ ok: false, error: '帳號不存在或已停用' }, 401, cors);
  }

  // 觀測者印記單向遞增：DB 已標記者不可透過上傳復原為 false
  const observerEver = row.observer_ever === 1 || body.observerEver === true;
  body.observerEver = observerEver;

  const serialized = JSON.stringify(body);
  if (serialized.length > PROGRESS_MAX_BYTES) {
    return json({ ok: false, error: '進度資料過大' }, 413, cors);
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      'UPDATE uep_users SET progress = ?, observer_ever = ?, updated_at = ? WHERE username = ?'
    )
    .bind(serialized, observerEver ? 1 : 0, now, payload.sub)
    .run();

  return json({ ok: true, data: { observerEver, savedAt: now } }, 200, cors);
}

// ===== 路由分派 =====

/**
 * 處理 /api/uep/* 路由。無匹配時回傳 null（交回主路由繼續）。
 * ⚠️ 必須掛在 index.ts 的 isWriteMethod/API_TOKEN guard 之前——
 * 註冊與登入是公開 POST 端點，不需要 API_TOKEN。
 */
export async function handleUepRoutes(
  path: string,
  method: string,
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response | null> {
  if (!path.startsWith('/api/uep/')) return null;

  const db = env.CONTENT_DB;

  // 公開端點：代稱 roll（註冊 UI 的重 roll 按鈕）
  if (path === '/api/uep/alias/roll' && method === 'GET') {
    return json({ ok: true, data: { alias: rollAlias() } }, 200, cors);
  }

  if (path === '/api/uep/auth/register' && method === 'POST') {
    if (!env.JWT_SECRET) {
      return json({ ok: false, error: 'JWT_SECRET not configured' }, 500, cors);
    }
    const body = (await request.json()) as UepRegisterRequest;
    return handleRegister(body, db, env.JWT_SECRET, cors);
  }

  if (path === '/api/uep/auth/login' && method === 'POST') {
    if (!env.JWT_SECRET) {
      return json({ ok: false, error: 'JWT_SECRET not configured' }, 500, cors);
    }
    const body = (await request.json()) as LoginRequest;
    return handleLogin(body, db, env.JWT_SECRET, cors);
  }

  if (path === '/api/uep/auth/me' && method === 'GET') {
    return handleMe(request, db, env, cors);
  }

  if (path === '/api/uep/progress' && method === 'GET') {
    return handleGetProgress(request, db, env, cors);
  }

  if (path === '/api/uep/progress' && method === 'PUT') {
    return handlePutProgress(request, db, env, cors);
  }

  return json({ ok: false, error: 'Not found' }, 404, cors);
}
