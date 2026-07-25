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
import {
  hashPassword,
  requireJwt,
  signJwt,
  verifyJwt,
  verifyPassword,
} from './auth';
import { isValidAlias, rollAlias } from './uep-alias';

/** 讀者 token 有效期：30 天（閱讀進度帳號，不需像 admin 一樣每日過期） */
const READER_TOKEN_TTL = 30 * 86400;

/**
 * 開發模式 fallback secret——未設定 JWT_SECRET 時（本地 wrangler dev）使用，
 * 讓註冊/登入/進度同步在本地走完整的簽驗流程。
 * 與 admin 的開發模式哲學一致（requireJwt 未設 secret 時全通），
 * 正式環境一律以 `wrangler secret put JWT_SECRET` 設定，永遠不會用到此值。
 */
const DEV_JWT_SECRET = 'uep-dev-jwt-secret';

/** 取得讀者 JWT 用的 secret（正式 secret 優先，本地 fallback） */
function readerSecret(env: Env): string {
  return env.JWT_SECRET || DEV_JWT_SECRET;
}

/** progress blob 大小上限（bytes）——防止濫用；正常 ProgressState 遠小於此 */
const PROGRESS_MAX_BYTES = 131072; // 128 KB

/** admin 備註長度上限（字元）——與 progress 上限同理，防止濫用 */
const ADMIN_NOTE_MAX_CHARS = 4096;

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

/**
 * 讀者 JWT 驗證 — 只接受 role='reader' 的 token。
 * 開發模式（無 JWT_SECRET）以 fallback secret 驗證，
 * 本地註冊/登入拿到的 token 一樣能走完整流程。
 */
export async function requireReaderJwt(
  request: Request,
  env: Env
): Promise<JwtPayload | null> {
  const auth = request.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token) return null;
  const payload = await verifyJwt(token, readerSecret(env));
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

/**
 * Admin 端使用者資訊（含管理欄位，不含密碼與 progress blob）。
 * 查詢一律用 ADMIN_USER_COLS（以 has_progress 取代 progress 本體），
 * list/get 共用此映射，欄位格式只定義一份。
 */
function adminUser(row: UepUserRow & { has_progress: number }) {
  return {
    id: row.id,
    username: row.username,
    alias: row.alias,
    email: row.email,
    observerEver: row.observer_ever === 1,
    hasProgress: row.has_progress === 1,
    isActive: row.is_active === 1,
    adminNote: row.admin_note,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    .prepare(
      'SELECT * FROM uep_users WHERE username = ? AND is_active = 1 AND deleted_at IS NULL'
    )
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
    .prepare(
      'SELECT * FROM uep_users WHERE username = ? AND is_active = 1 AND deleted_at IS NULL'
    )
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
      'SELECT progress FROM uep_users WHERE username = ? AND is_active = 1 AND deleted_at IS NULL'
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
      'SELECT observer_ever, progress_reset_at FROM uep_users WHERE username = ? AND is_active = 1 AND deleted_at IS NULL'
    )
    .bind(payload.sub)
    .first<Pick<UepUserRow, 'observer_ever' | 'progress_reset_at'>>();
  if (!row) {
    return json({ ok: false, error: '帳號不存在或已停用' }, 401, cors);
  }

  /* ── 樂觀鎖：拒收 admin 重置之前產生的快照（2026-07-26）──
     使用者分頁還開著時，ServerAdapter 的 debounce PUT 與 pagehide flush
     會把重置前的本地鏡像整包送上來，把 admin 的重置悄悄復原。
     blob 的 updatedAt 早於重置時刻即視為過期，回 409 要求客戶端改為
     重新 hydrate。progress_reset_at 為 NULL（從未重置）時完全略過。

     ⚠️ 已知限制：updatedAt 由**客戶端時鐘**產生，裝置時間顯著超前的
     使用者，其過期快照會被誤判為新資料而放行。要根除得改成伺服器端
     發放的版本號（PUT 需帶回上次 GET 的 version），那會動到讀寫協定。
     目前接受此風險——重置與 flush 之間的窗口是秒級，而時鐘偏差要達到
     分鐘級才會漏擋，且漏擋的後果僅是 admin 需再重置一次。 */
  if (row.progress_reset_at) {
    const clientUpdatedAt =
      typeof body.updatedAt === 'string' ? body.updatedAt : null;
    if (!clientUpdatedAt || clientUpdatedAt <= row.progress_reset_at) {
      // 409 本身即是客戶端的判斷依據（ServerAdapter.flush 只看 status）
      return json(
        { ok: false, error: '進度已被管理者重置，請重新載入' },
        409,
        cors
      );
    }
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

// ===== Admin 使用者管理（JWT admin 保護）=====

/** Admin 端列出使用者清單欄位（不含 password_hash 和 progress blob） */
const ADMIN_USER_COLS =
  'id, username, email, alias, observer_ever, is_active, admin_note, deleted_at, created_at, updated_at, CASE WHEN progress IS NOT NULL THEN 1 ELSE 0 END AS has_progress';

/** GET /api/uep/admin/users — 列出所有使用者（admin JWT） */
async function handleAdminListUsers(
  url: URL,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const includeDeleted = url.searchParams.get('include_deleted') === 'true';
  const search = url.searchParams.get('search')?.trim() || '';

  let query = `SELECT ${ADMIN_USER_COLS} FROM uep_users`;
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (!includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }
  if (search) {
    conditions.push(
      "(username LIKE ? ESCAPE '\\' OR alias LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')"
    );
    // escape LIKE 萬用字元，避免使用者輸入 % / _ 被當成 pattern
    const escaped = search.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${escaped}%`;
    binds.push(pattern, pattern, pattern);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY created_at DESC';

  const result = await db
    .prepare(query)
    .bind(...binds)
    .all<UepUserRow & { has_progress: number }>();

  return json(
    { ok: true, data: (result.results || []).map(adminUser) },
    200,
    cors
  );
}

/** GET /api/uep/admin/users/:id — 取得單一使用者詳情（admin JWT） */
async function handleAdminGetUser(
  userId: number,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const row = await db
    .prepare(`SELECT ${ADMIN_USER_COLS} FROM uep_users WHERE id = ?`)
    .bind(userId)
    .first<UepUserRow & { has_progress: number }>();

  if (!row) {
    return json({ ok: false, error: '使用者不存在' }, 404, cors);
  }

  return json({ ok: true, data: adminUser(row) }, 200, cors);
}

/** PUT /api/uep/admin/users/:id — 更新使用者
 *（admin_note、alias、email、is_active、observer_ever、progress） */
async function handleAdminUpdateUser(
  userId: number,
  request: Request,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: '無效的 JSON' }, 400, cors);
  }

  // 確認使用者存在（印記/進度編輯需要現值做鏡射同步）
  const existing = await db
    .prepare('SELECT id, observer_ever, progress FROM uep_users WHERE id = ?')
    .bind(userId)
    .first<{ id: number; observer_ever: number; progress: string | null }>();
  if (!existing) {
    return json({ ok: false, error: '使用者不存在' }, 404, cors);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.adminNote !== undefined) {
    const note = typeof body.adminNote === 'string' ? body.adminNote : null;
    if (note && note.length > ADMIN_NOTE_MAX_CHARS) {
      return json({ ok: false, error: '備註過長' }, 400, cors);
    }
    updates.push('admin_note = ?');
    values.push(note);
  }
  if (body.alias !== undefined) {
    // 與註冊相同規則：詞庫為代稱合法性的唯一來源（isValidAlias）
    const alias = typeof body.alias === 'string' ? body.alias.trim() : '';
    if (!isValidAlias(alias)) {
      return json({ ok: false, error: '代稱必須是詞庫的合法組合' }, 400, cors);
    }
    updates.push('alias = ?');
    values.push(alias);
  }
  if (body.email !== undefined) {
    // 與註冊相同規則：空值存 NULL，非空需通過 EMAIL_RE
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (email && !EMAIL_RE.test(email)) {
      return json({ ok: false, error: '郵件信箱格式不正確' }, 400, cors);
    }
    updates.push('email = ?');
    values.push(email || null);
  }
  if (typeof body.isActive === 'boolean') {
    updates.push('is_active = ?');
    values.push(body.isActive ? 1 : 0);
  }

  /* ── 印記 + 進度（S7 驗收加碼，2026-07-10）──
     observer_ever 欄位與 progress blob 內的 observerEver 是鏡射雙份，
     必須一起動，否則讀者端 PUT 的單向遞增規則會把清掉的印記升回去：
     - 明確給 observerEver（admin 雙向覆寫，取消印記＝恢復純潔者）→ 以它為準
     - 只給 progress → 欄位跟隨 blob 內的 observerEver
     - 兩者皆無 → 不動
     注意：admin 清印記後，若使用者當下仍有開著的分頁，本地鏡像的
     debounced PUT 可能把印記回寫（讀者端單向規則）；下次載入由
     ServerAdapter 伺服器優先 hydrate 即對齊。 */
  const hasObserverEdit = typeof body.observerEver === 'boolean';
  const hasProgressEdit = body.progress !== undefined;
  if (hasObserverEdit || hasProgressEdit) {
    // 解析目標 progress：本次上傳的優先，否則沿用既有 blob
    let progressObj: Record<string, unknown> | null = null;
    if (hasProgressEdit) {
      if (body.progress === null) {
        progressObj = null; // 重置進度
      } else if (typeof body.progress === 'string') {
        try {
          progressObj = JSON.parse(body.progress) as Record<string, unknown>;
        } catch {
          return json({ ok: false, error: '進度必須是合法 JSON' }, 400, cors);
        }
      } else if (
        typeof body.progress === 'object' &&
        !Array.isArray(body.progress)
      ) {
        progressObj = body.progress as Record<string, unknown>;
      }
      if (
        body.progress !== null &&
        (progressObj === null ||
          typeof progressObj !== 'object' ||
          Array.isArray(progressObj))
      ) {
        return json({ ok: false, error: '進度資料必須是物件' }, 400, cors);
      }
    } else if (existing.progress) {
      try {
        progressObj = JSON.parse(existing.progress) as Record<string, unknown>;
      } catch {
        progressObj = null; // 既有 blob 毀損：只動欄位
      }
    }

    // 最終印記：明確 toggle 優先 → blob 內值 → 維持欄位現值
    const finalObserver = hasObserverEdit
      ? body.observerEver === true
      : progressObj && typeof progressObj.observerEver === 'boolean'
        ? progressObj.observerEver
        : existing.observer_ever === 1;

    if (progressObj) progressObj.observerEver = finalObserver;

    if (hasProgressEdit || (hasObserverEdit && progressObj)) {
      const serialized = progressObj ? JSON.stringify(progressObj) : null;
      if (serialized && serialized.length > PROGRESS_MAX_BYTES) {
        return json({ ok: false, error: '進度資料過大' }, 413, cors);
      }
      updates.push('progress = ?');
      values.push(serialized);
      /* 樂觀鎖戳記：admin 動過 progress 之後，使用者端所有更早的快照一律
         失效（handlePutProgress 回 409）。否則還開著的分頁會把寫入前的
         鏡像 debounce PUT 回來，悄悄復原這次的操作。

         ⚠️ 涵蓋**所有** admin 對 progress 的寫入，不只 `progress: null`
         的清除——存入非空進度、乃至只 toggle observerEver 而連帶重寫
         blob，同樣需要擋掉使用者端的舊快照，否則 admin 的編輯會被覆蓋。
         欄位名 `progress_reset_at` 是初版命名的遺留，語意實為
         「admin 最後改寫 progress 的時刻」。
         客戶端收到 409 一律走 hydrateAuthoritative（以伺服器為準），
         不是 reset——後者會把空 state 推回去蓋掉 admin 存的內容。 */
      updates.push('progress_reset_at = ?');
      values.push(new Date().toISOString());
    }
    updates.push('observer_ever = ?');
    values.push(finalObserver ? 1 : 0);
  }

  if (updates.length === 0) {
    return json({ ok: false, error: '沒有要更新的欄位' }, 400, cors);
  }

  updates.push('updated_at = ?');
  const now = new Date().toISOString();
  values.push(now);
  values.push(userId);

  await db
    .prepare(`UPDATE uep_users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  // 回傳更新後的資料
  return handleAdminGetUser(userId, db, cors);
}

/** GET /api/uep/admin/users/:id/progress — 取得使用者進度 blob
 *（S7 驗收加碼：admin 進度編輯用；無進度或毀損回 null） */
async function handleAdminGetUserProgress(
  userId: number,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const row = await db
    .prepare('SELECT progress FROM uep_users WHERE id = ?')
    .bind(userId)
    .first<{ progress: string | null }>();
  if (!row) {
    return json({ ok: false, error: '使用者不存在' }, 404, cors);
  }
  if (!row.progress) {
    return json({ ok: true, data: null }, 200, cors);
  }
  try {
    return json({ ok: true, data: JSON.parse(row.progress) }, 200, cors);
  } catch {
    return json({ ok: true, data: null }, 200, cors);
  }
}

/** DELETE /api/uep/admin/users/:id — 軟刪除使用者 */
async function handleAdminDeleteUser(
  userId: number,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      'UPDATE uep_users SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    )
    .bind(now, now, userId)
    .run();

  if (result.meta.changes === 0) {
    return json({ ok: false, error: '使用者不存在或已被刪除' }, 404, cors);
  }

  return json({ ok: true, data: { deletedAt: now } }, 200, cors);
}

/** POST /api/uep/admin/users/:id/restore — 恢復軟刪除的使用者 */
async function handleAdminRestoreUser(
  userId: number,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      'UPDATE uep_users SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL'
    )
    .bind(now, userId)
    .run();

  if (result.meta.changes === 0) {
    return json({ ok: false, error: '使用者不存在或未被刪除' }, 404, cors);
  }

  return json({ ok: true }, 200, cors);
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
  const url = new URL(request.url);

  // 公開端點：代稱 roll（註冊 UI 的重 roll 按鈕）
  if (path === '/api/uep/alias/roll' && method === 'GET') {
    return json({ ok: true, data: { alias: rollAlias() } }, 200, cors);
  }

  if (path === '/api/uep/auth/register' && method === 'POST') {
    const body = (await request.json()) as UepRegisterRequest;
    return handleRegister(body, db, readerSecret(env), cors);
  }

  if (path === '/api/uep/auth/login' && method === 'POST') {
    const body = (await request.json()) as LoginRequest;
    return handleLogin(body, db, readerSecret(env), cors);
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

  // ---- Admin 使用者管理路由（/api/uep/admin/users/*，需 admin JWT） ----

  if (path === '/api/uep/admin/users' && method === 'GET') {
    const adminPayload = await requireJwt(request, env);
    if (!adminPayload) {
      return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    }
    return handleAdminListUsers(url, db, cors);
  }

  // 匹配 /api/uep/admin/users/:id（+ /restore、/progress 子路徑）
  const adminUserMatch = path.match(
    /^\/api\/uep\/admin\/users\/(\d+)(\/restore|\/progress)?$/
  );
  if (adminUserMatch) {
    const adminPayload = await requireJwt(request, env);
    if (!adminPayload) {
      return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    }

    const userId = parseInt(adminUserMatch[1], 10);
    const sub = adminUserMatch[2];

    if (sub === '/restore' && method === 'POST') {
      return handleAdminRestoreUser(userId, db, cors);
    }
    if (sub === '/progress' && method === 'GET') {
      return handleAdminGetUserProgress(userId, db, cors);
    }
    if (!sub) {
      if (method === 'GET') return handleAdminGetUser(userId, db, cors);
      if (method === 'PUT')
        return handleAdminUpdateUser(userId, request, db, cors);
      if (method === 'DELETE') return handleAdminDeleteUser(userId, db, cors);
    }
  }

  return json({ ok: false, error: 'Not found' }, 404, cors);
}
