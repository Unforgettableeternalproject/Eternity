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
import {
  assembleProgress,
  buildNoteSyncStatements,
  loadNotes,
  sanitizeNotes,
  stripNotes,
} from './uep-notes';

/** 讀者 token 有效期：30 天（閱讀進度帳號，不需像 admin 一樣每日過期） */
const READER_TOKEN_TTL = 30 * 86400;

/**
 * 開發模式 fallback secret——只在本機 `wrangler dev`（`ETERNITY_DEV=true`）
 * 且未設定 JWT_SECRET 時使用，讓註冊/登入/進度同步在本地走完整的簽驗流程。
 * 與 admin 的開發模式哲學一致，任何部署出去的 worker 都不會用到此值。
 */
const DEV_JWT_SECRET = 'uep-dev-jwt-secret';

/**
 * 取得讀者 JWT 用的 secret（正式 secret 優先，本機 dev fallback）。
 *
 * ⚠️ 與 admin 的 `requireJwt` 對稱：部署出去的 worker 未設 `JWT_SECRET` 屬
 * 部署錯誤，**fail closed 回 null**，不可退回 `DEV_JWT_SECRET`——那個值就
 * 寫在原始碼裡，任何人都能拿它簽一個 `role: 'reader'` 的 token 冒充任意
 * 讀者，讀寫其進度與便條。而且是靜默的：端點會「正常運作」，沒有任何跡象
 * 顯示 secret 漏設。
 *
 * ⚠️ 判斷依據是 `ETERNITY_DEV` 白名單，不是「非 test 即開發」——正式 worker
 * 同樣沒有 test 旗標，用排除法等於把正式環境也放進 fallback。
 */
function readerSecret(env: Env): string | null {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  if (env.ETERNITY_DEV === 'true') return DEV_JWT_SECRET;
  return null;
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
  const secret = readerSecret(env);
  if (!secret) return null;
  const payload = await verifyJwt(token, secret);
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
  const identifier = (body.username || '').trim();

  /* 識別名或信箱都可以登入。兩者不會互撞——USERNAME_RE 不允許 `@`，
     所以任何帶 `@` 的字串一定是信箱、不帶的一定是識別名。
     信箱沒有 unique 約束（多個帳號可以填同一個），所以取兩筆判斷歧義；
     識別名是 UNIQUE，命中就一定只有一筆，故排序讓它優先。 */
  const matches = await db
    .prepare(
      `SELECT * FROM uep_users
       WHERE deleted_at IS NULL
         AND (username = ? OR (email IS NOT NULL AND email = ? COLLATE NOCASE))
       ORDER BY CASE WHEN username = ? THEN 0 ELSE 1 END, id
       LIMIT 2`
    )
    .bind(identifier, identifier, identifier)
    .all<UepUserRow>();
  const rows = matches.results || [];
  const row = rows[0];

  if (!row) {
    // 與 admin login 相同：固定延遲防 timing 洩漏帳號存在性
    await new Promise((r) => setTimeout(r, 200));
    return json({ ok: false, error: '憑證錯誤' }, 401, cors);
  }

  /* 同一個信箱掛在多個帳號上時無從得知要登入哪一個。這裡不能猜，
     但也不該回「憑證錯誤」讓人反覆試密碼——直接說清楚要改用識別名。
     識別名命中時 rows[0] 一定是它（見上方排序），不會走到這裡。 */
  if (rows.length > 1 && row.username !== identifier) {
    return json(
      { ok: false, error: '這個信箱對應到多個紀錄，請改用識別名登入' },
      409,
      cors
    );
  }

  const valid = await verifyPassword(body.password || '', row.password_hash);
  if (!valid) {
    await new Promise((r) => setTimeout(r, 200));
    return json({ ok: false, error: '憑證錯誤' }, 401, cors);
  }

  /* 停用的帳號在密碼**驗過之後**才回報。順序不能顛倒：先擋的話等於
     不用知道密碼就能問出「這個帳號存在且被停用」。
     訊息刻意不說「帳號已停用」——對讀者而言那是世界裡的一道阻力，
     不是系統管理狀態。 */
  if (row.is_active !== 1) {
    return json(
      {
        ok: false,
        error: '有一股未知的力量阻止你回復這段紀錄。',
        data: { reason: 'inactive' },
      },
      403,
      cors
    );
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
      'SELECT id, progress, progress_rev, observer_ever FROM uep_users WHERE username = ? AND is_active = 1 AND deleted_at IS NULL'
    )
    .bind(payload.sub)
    .first<
      Pick<UepUserRow, 'id' | 'progress' | 'progress_rev' | 'observer_ever'>
    >();
  if (!row) {
    return json({ ok: false, error: '帳號不存在或已停用' }, 401, cors);
  }

  /* meta 與 data 平行回傳，尚未更新的客戶端只讀 data、完全不受影響。
     observerEver 取自 DB 欄位而非 blob——admin 清空 progress 時 blob 變
     NULL 但印記保留，只看 blob 會把印記歸零，讓 pristineOnly
     （純潔者限定）內容對印記者誤判為可見而外洩劇透。 */
  const meta = {
    rev: row.progress_rev,
    observerEver: row.observer_ever === 1,
  };

  if (!row.progress) {
    return json({ ok: true, data: null, meta }, 200, cors);
  }
  let blob: Record<string, unknown> | null = null;
  try {
    blob = JSON.parse(row.progress) as Record<string, unknown>;
  } catch {
    // 資料毀損：視為無進度（客戶端會以本地資料重新上傳）
    return json({ ok: true, data: null, meta }, 200, cors);
  }

  const notes = await loadNotes(db, row.id);

  /* lazy migration：blob 還帶著便條（0026 之前的存量）就搬進表、清欄位。
     不遞增 rev——組裝後的邏輯內容沒有變，客戶端手上的 rev 仍然有效。
     UPDATE 帶 CAS 防止蓋掉並發 PUT（PUT 自己會處理便條），失敗就留給
     下一次 GET 重試；INSERT OR REPLACE 讓中途失敗的重跑天然冪等。 */
  const legacyNotes = sanitizeNotes(blob.storageNotes);
  if (legacyNotes.length > 0) {
    const statements = buildNoteSyncStatements(
      db,
      row.id,
      // 遷移是「疊加」不是「取代」：表內已有的列（前次部分遷移）保留
      [...new Map([...notes, ...legacyNotes].map((n) => [n.id, n])).values()],
      notes,
      { rev: row.progress_rev }
    );
    statements.push(
      db
        .prepare(
          'UPDATE uep_users SET progress = ? WHERE id = ? AND progress_rev = ?'
        )
        .bind(JSON.stringify(stripNotes(blob)), row.id, row.progress_rev)
    );
    await db.batch(statements);
  }

  return json(
    { ok: true, data: assembleProgress(blob, notes), meta },
    200,
    cors
  );
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
      'SELECT id, observer_ever, progress_reset_at, progress_rev, progress FROM uep_users WHERE username = ? AND is_active = 1 AND deleted_at IS NULL'
    )
    .bind(payload.sub)
    .first<
      Pick<
        UepUserRow,
        | 'id'
        | 'observer_ever'
        | 'progress_reset_at'
        | 'progress_rev'
        | 'progress'
      >
    >();
  if (!row) {
    return json({ ok: false, error: '帳號不存在或已停用' }, 401, cors);
  }

  /** 版本衝突回應：帶上最新 rev 與 progress，客戶端可直接收斂不必再 GET。
      blob 必須經 assembleProgress 組裝便條——客戶端會拿這份 data 當
      收斂基準，缺了便條的話下一次 PUT 的差分同步會把整張表清掉。 */
  const conflict = async (): Promise<Response> => {
    let current: Record<string, unknown> | null = null;
    if (row.progress) {
      try {
        current = JSON.parse(row.progress) as Record<string, unknown>;
      } catch {
        current = null;
      }
    }
    const assembled = current
      ? assembleProgress(current, await loadNotes(db, row.id))
      : null;
    return json(
      {
        ok: false,
        error: '進度已被更新，請重新載入',
        data: assembled,
        meta: { rev: row.progress_rev, observerEver: row.observer_ever === 1 },
      },
      409,
      cors
    );
  };

  const revHeader = request.headers.get('X-Progress-Rev');

  /* ── 併發控制：優先走 compare-and-swap ──
     帶了 X-Progress-Rev 就用伺服器發放的版本號比對；沒帶則退回舊的
     時間戳檢查，讓尚未更新的前端仍有基本保護。

     ⚠️ 時間戳那條路是弱鎖，**擋不住真正的衝突**：admin 改寫後，舊分頁
     只要再發生任何 mutation（滑一下觸發 marker-update 就夠），blob 的
     updatedAt 便刷新成當下、比 progress_reset_at 新而直接通過，整份舊
     state 照樣覆蓋 admin 的編輯。它只擋得住「完全沒動作的過期分頁」。
     待兩站前端全面上線後，此分支應改為一律拒絕（要求帶 rev）。 */
  if (revHeader !== null) {
    const clientRev = Number(revHeader);
    if (!Number.isInteger(clientRev) || clientRev < 0) {
      return json({ ok: false, error: 'X-Progress-Rev 格式錯誤' }, 400, cors);
    }
    if (clientRev !== row.progress_rev) return conflict();
  } else if (row.progress_reset_at) {
    const clientUpdatedAt =
      typeof body.updatedAt === 'string' ? body.updatedAt : null;
    if (!clientUpdatedAt || clientUpdatedAt <= row.progress_reset_at) {
      return conflict();
    }
  }

  // 觀測者印記單向遞增：DB 已標記者不可透過上傳復原為 false
  const observerEver = row.observer_ever === 1 || body.observerEver === true;
  body.observerEver = observerEver;

  /* ── 便條拆分（S11 C 段）──
     storageNotes 剝出 blob 差分寫入 uep_user_notes；blob 只存剩餘欄位，
     128KB 守門也只量剝離後的體積（便條的上限由硬 cap 60×400 自己管）。
     body 沒帶 storageNotes 陣列時不動表——防禦缺欄位的舊資料把表清空。 */
  const hasNotesField = Array.isArray(body.storageNotes);
  const incomingNotes = hasNotesField ? sanitizeNotes(body.storageNotes) : null;
  const stripped = stripNotes(body);

  const serialized = JSON.stringify(stripped);
  if (serialized.length > PROGRESS_MAX_BYTES) {
    return json({ ok: false, error: '進度資料過大' }, 413, cors);
  }

  /* compare-and-swap：WHERE 帶上剛讀到的 rev，寫入才 +1。
     即使客戶端沒送 X-Progress-Rev 也有這層保護——它擋的是本次
     read-modify-write 之間插進來的另一個寫入（admin 或另一個分頁）。

     便條陳述式與 blob 更新走同一個 db.batch（具交易性），且每條便條
     陳述式都掛同一個 rev 守門——rev 已被推進時整批一起 no-op，
     不會出現「表反映輸家、blob 反映贏家」的撕裂。blob 更新必須是
     batch 的最後一條：守門檢查的是遞增前的 rev。 */
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (incomingNotes !== null) {
    const existingNotes = await loadNotes(db, row.id);
    statements.push(
      ...buildNoteSyncStatements(db, row.id, incomingNotes, existingNotes, {
        rev: row.progress_rev,
      })
    );
  }
  statements.push(
    db
      .prepare(
        'UPDATE uep_users SET progress = ?, observer_ever = ?, progress_rev = progress_rev + 1, updated_at = ? WHERE username = ? AND progress_rev = ?'
      )
      .bind(
        serialized,
        observerEver ? 1 : 0,
        now,
        payload.sub,
        row.progress_rev
      )
  );
  const results = await db.batch(statements);
  const blobResult = results[results.length - 1];
  if (blobResult.meta.changes === 0) return conflict();

  return json(
    {
      ok: true,
      data: { observerEver, savedAt: now },
      meta: { rev: row.progress_rev + 1, observerEver },
    },
    200,
    cors
  );
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

  /* ── 印記 + 進度 ──
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
  /* 便條同步陳述式（S11 C 段拆分）：與最終的使用者 UPDATE 走同一個
     db.batch。admin 路徑自己遞增 rev、無並發競爭語意，不掛 rev 守門。 */
  const noteStatements: D1PreparedStatement[] = [];
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

    /* ── 便條拆分（S11 C 段）──
       - 重置進度（progress: null）連帶清空便條表：便條屬於進度的一部分，
         維持拆分前「重置＝便條也沒了」的語意。
       - admin 給整包 blob（進度編輯器）：storageNotes 為權威 replace-all。
       - 純 observerEver toggle 沿用既有 blob：blob 內殘留的便條（0026 前
         的存量）疊加進表（機會性遷移），不刪表內既有列。
       兩種寫入路徑最後都把 storageNotes 從存入的 blob 剝掉。 */
    if (hasProgressEdit && body.progress === null) {
      noteStatements.push(
        db.prepare('DELETE FROM uep_user_notes WHERE user_id = ?').bind(userId)
      );
    } else if (progressObj && Array.isArray(progressObj.storageNotes)) {
      const incoming = sanitizeNotes(progressObj.storageNotes);
      const existingNotes = await loadNotes(db, userId);
      const target = hasProgressEdit
        ? incoming
        : [
            ...new Map(
              [...existingNotes, ...incoming].map((n) => [n.id, n])
            ).values(),
          ];
      noteStatements.push(
        ...buildNoteSyncStatements(db, userId, target, existingNotes, null)
      );
      progressObj = stripNotes(progressObj);
    }

    // blob 只在有內容要寫時才動：純 observerEver toggle 且進度已是 null 時
    // 沒有 blob 可鏡射，欄位自己改就夠了。
    if (hasProgressEdit || (hasObserverEdit && progressObj)) {
      const serialized = progressObj ? JSON.stringify(progressObj) : null;
      if (serialized && serialized.length > PROGRESS_MAX_BYTES) {
        return json({ ok: false, error: '進度資料過大' }, 413, cors);
      }
      updates.push('progress = ?');
      values.push(serialized);
    }

    /* 樂觀鎖戳記 + 版本遞增：admin 動過讀者端的 canonical 狀態之後，
       使用者端所有更早的快照一律失效（handlePutProgress 回 409）。
       否則還開著的分頁會把寫入前的鏡像 debounce PUT 回來，悄悄復原
       這次的操作。

       ⚠️ 條件是 `hasProgressEdit || hasObserverEdit`，**不能**再加
       「有 blob」的前提。progress
       已是 null 時單獨清除 observerEver，DB 欄位改了但 rev 沒動，客戶端
       手上的同 rev 快照仍會通過 CAS，讀者端的單向 OR 又把印記升回
       true——admin 的操作被復原。凡是改變 reader canonical
       progress/meta 的 admin 操作，都必須遞增 rev，即使 blob 為 null。

       欄位名 `progress_reset_at` 是初版命名的遺留，語意實為
       「admin 最後改寫讀者 canonical 狀態的時刻」。
       客戶端收到 409 一律走 hydrateAuthoritative（以伺服器為準），
       不是 reset——後者會把空 state 推回去蓋掉 admin 存的內容。 */
    updates.push('progress_reset_at = ?');
    values.push(new Date().toISOString());
    updates.push('progress_rev = progress_rev + 1');

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

  // 便條同步與使用者欄位更新走同一個 batch（具交易性），避免只寫到一半
  await db.batch([
    ...noteStatements,
    db
      .prepare(`UPDATE uep_users SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values),
  ]);

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
    const blob = JSON.parse(row.progress) as Record<string, unknown>;
    // 便條組裝回 blob——admin 進度編輯器看到的必須是完整 state，
    // 它 PUT 回來時 storageNotes 才會走 replace-all 同步而不是清空
    const assembled = assembleProgress(blob, await loadNotes(db, userId));
    return json({ ok: true, data: assembled }, 200, cors);
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
  /* 只有已停用的帳號可以刪。刪除是清單上最容易點錯的一格，而「先停用、
     確認沒事再刪」讓誤刪需要兩個刻意的動作。停用本身可以直接復原，
     刪除雖然是軟刪但要走另一個端點。 */
  const result = await db
    .prepare(
      'UPDATE uep_users SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL AND is_active = 0'
    )
    .bind(now, now, userId)
    .run();

  if (result.meta.changes === 0) {
    const existing = await db
      .prepare(
        'SELECT is_active FROM uep_users WHERE id = ? AND deleted_at IS NULL'
      )
      .bind(userId)
      .first<{ is_active: number }>();
    if (existing && existing.is_active === 1) {
      return json(
        { ok: false, error: '請先停用這個紀錄，才能刪除' },
        409,
        cors
      );
    }
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
    const secret = readerSecret(env);
    // secret 缺席時不可簽發 token——簽了也是用一個公開已知的字串
    if (!secret)
      return json({ ok: false, error: '服務暫時無法使用' }, 503, cors);
    const body = (await request.json()) as UepRegisterRequest;
    return handleRegister(body, db, secret, cors);
  }

  if (path === '/api/uep/auth/login' && method === 'POST') {
    const secret = readerSecret(env);
    if (!secret)
      return json({ ok: false, error: '服務暫時無法使用' }, 503, cors);
    const body = (await request.json()) as LoginRequest;
    return handleLogin(body, db, secret, cors);
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
