import type {
  Env,
  PageRow,
  Page,
  PageListItem,
  PageTreeNode,
  UpsertPageRequest,
  ImportPageRequest,
  ApiResponse,
  AdminUserRow,
  JwtPayload,
  LoginRequest,
  BootstrapRequest,
  AssetItem,
  ListAssetsResponse,
  BatchDeleteRequest,
} from './types';
import { signJwt, verifyJwt, hashPassword, verifyPassword } from './auth';

// ===== 工具函式 =====

/** 將資料庫列轉換為 API 回應格式 */
function rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    area: row.area,
    title: row.title,
    slug: row.slug,
    sortOrder: row.sort_order,
    content: JSON.parse(row.content),
    sourceFile: row.source_file,
    baseContentHash: row.base_content_hash,
    status: row.status,
    metadata: JSON.parse(row.metadata),
    parentId: row.parent_id,
    depth: row.depth,
    pageType: row.page_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** 將資料庫列轉換為列表項目 */
function rowToListItem(row: PageRow): PageListItem {
  return {
    id: row.id,
    area: row.area,
    title: row.title,
    slug: row.slug,
    sortOrder: row.sort_order,
    status: row.status,
    sourceFile: row.source_file,
    parentId: row.parent_id,
    depth: row.depth,
    pageType: row.page_type,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** 將扁平列表轉換為樹狀結構 */
function buildTree(
  items: (PageListItem & { metadata?: Record<string, unknown> })[]
): PageTreeNode[] {
  const map = new Map<string, PageTreeNode>();
  const roots: PageTreeNode[] = [];

  // 先建立所有節點
  for (const item of items) {
    map.set(item.id, {
      id: item.id,
      title: item.title,
      slug: item.slug,
      sortOrder: item.sortOrder,
      pageType: item.pageType,
      depth: item.depth,
      status: item.status,
      metadata: item.metadata || {},
      updatedAt: item.updatedAt,
      children: [],
    });
  }

  // 建立父子關係
  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // 排序
  const sortNodes = (nodes: PageTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);

  return roots;
}

function jsonResponse<T>(
  data: ApiResponse<T>,
  status = 200,
  corsHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ===== CORS =====

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const headers: Record<string, string> = {};

  // 沒設定 ALLOWED_ORIGINS 時允許所有 origin（開發模式）
  if (!env.ALLOWED_ORIGINS) {
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] =
        'GET, HEAD, POST, PUT, DELETE, OPTIONS';
      headers['Access-Control-Allow-Headers'] =
        'Content-Type, Authorization, Range';
    }
    return headers;
  }

  // localhost 一律允許（開發環境各 port 都能存取）
  if (
    origin &&
    (origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:'))
  ) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] =
      'GET, HEAD, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] =
      'Content-Type, Authorization, Range';
    return headers;
  }

  const allowedOrigins = env.ALLOWED_ORIGINS.split(',');

  const isAllowed = allowedOrigins.some((allowed) => {
    allowed = allowed.trim();
    if (allowed === origin) return true;
    if (allowed.includes('*.')) {
      const domain = allowed.split('*.')[1];
      return origin.endsWith(domain);
    }
    return false;
  });

  if (isAllowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] =
      'GET, HEAD, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] =
      'Content-Type, Authorization, Range';
  }

  return headers;
}

// ===== 驗證 =====

function isAuthorized(request: Request, env: Env): boolean {
  // 如果沒設定 API_TOKEN，允許所有請求（開發模式）
  if (!env.API_TOKEN) return true;

  const auth = request.headers.get('Authorization');
  if (!auth) return false;

  const token = auth.replace('Bearer ', '');
  return token === env.API_TOKEN;
}

/** JWT 驗證 — 用於需要登入的 Admin 路由，回傳 payload 或 null */
async function requireJwt(
  request: Request,
  env: Env
): Promise<JwtPayload | null> {
  // 開發模式（無 JWT_SECRET）：允許所有請求
  if (!env.JWT_SECRET)
    return {
      sub: 'dev',
      role: 'super_admin',
      display_name: 'Dev',
      iat: 0,
      exp: 0,
      jti: '',
    };
  const auth = request.headers.get('Authorization');
  const token = auth?.replace('Bearer ', '');
  if (!token) return null;
  return verifyJwt(token, env.JWT_SECRET);
}

// ===== 路由處理 =====

/** GET /api/content/:area — 列出區域內所有頁面 */
async function listPages(
  area: string,
  db: D1Database,
  cors: Record<string, string>,
  includeDeleted = false
): Promise<Response> {
  const query = includeDeleted
    ? 'SELECT * FROM pages WHERE area = ? ORDER BY sort_order ASC'
    : 'SELECT * FROM pages WHERE area = ? AND deleted_at IS NULL ORDER BY sort_order ASC';
  const result = await db.prepare(query).bind(area).all<PageRow>();

  const items: PageListItem[] = (result.results || []).map(rowToListItem);
  return jsonResponse({ ok: true, data: items }, 200, cors);
}

/** GET /api/content/:area/:slug — 取得單一頁面 */
async function getPage(
  area: string,
  slug: string,
  db: D1Database,
  cors: Record<string, string>,
  includeDeleted = false
): Promise<Response> {
  const id = `${area}/${slug}`;
  const query = includeDeleted
    ? 'SELECT * FROM pages WHERE id = ?'
    : 'SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL';
  const row = await db.prepare(query).bind(id).first<PageRow>();

  if (!row) {
    return jsonResponse({ ok: false, error: 'Page not found' }, 404, cors);
  }

  return jsonResponse({ ok: true, data: rowToPage(row) }, 200, cors);
}

/** PUT /api/content/:area/:slug — 建立或更新頁面 */
async function upsertPage(
  area: string,
  slug: string,
  body: UpsertPageRequest,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const id = `${area}/${slug}`;
  const now = body.updatedAt || new Date().toISOString();

  // 檢查是否已存在（包含已軟刪除的記錄）
  const existing = await db
    .prepare(
      'SELECT id, source_file, status, deleted_at FROM pages WHERE id = ?'
    )
    .bind(id)
    .first<Pick<PageRow, 'id' | 'source_file' | 'status' | 'deleted_at'>>();

  if (existing) {
    // 更新現有頁面
    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.title !== undefined) {
      updates.push('title = ?');
      values.push(body.title);
    }
    if (body.content !== undefined) {
      updates.push('content = ?');
      values.push(JSON.stringify(body.content));
    }
    if (body.sortOrder !== undefined) {
      updates.push('sort_order = ?');
      values.push(body.sortOrder);
    }
    if (body.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(body.metadata));
    }
    if (body.parentId !== undefined) {
      updates.push('parent_id = ?');
      values.push(body.parentId);
    }
    if (body.depth !== undefined) {
      updates.push('depth = ?');
      values.push(body.depth);
    }
    if (body.pageType !== undefined) {
      updates.push('page_type = ?');
      values.push(body.pageType);
    }

    // 如果請求明確指定 status（同步腳本會傳 'synced'），優先使用
    if (body.status !== undefined) {
      updates.push('status = ?');
      values.push(body.status);
    } else if (body.content !== undefined && existing.source_file) {
      // 未指定 status 但有來源檔案且內容被修改 → 標記為 modified
      updates.push("status = 'modified'");
    }

    // 如果頁面已被軟刪除，PUT 操作會恢復它
    if (existing.deleted_at) {
      updates.push('deleted_at = NULL');
    }

    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    await db
      .prepare(`UPDATE pages SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  } else {
    // 建立新頁面
    const insertStatus = body.status || 'local_only';
    await db
      .prepare(
        `INSERT INTO pages (id, area, title, slug, sort_order, content, status, metadata, parent_id, depth, page_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        area,
        body.title || '',
        slug,
        body.sortOrder || 0,
        JSON.stringify(body.content || []),
        insertStatus,
        JSON.stringify(body.metadata || {}),
        body.parentId || null,
        body.depth || 0,
        body.pageType || 'page',
        now,
        now
      )
      .run();
  }

  // 回傳更新後的頁面
  const updated = await db
    .prepare('SELECT * FROM pages WHERE id = ?')
    .bind(id)
    .first<PageRow>();
  return jsonResponse(
    { ok: true, data: updated ? rowToPage(updated) : null },
    existing ? 200 : 201,
    cors
  );
}

/** DELETE /api/content/:area/:slug — 軟刪除頁面（標記 deleted_at） */
async function deletePage(
  area: string,
  slug: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const id = `${area}/${slug}`;
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      'UPDATE pages SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    )
    .bind(now, now, id)
    .run();

  if (result.meta.changes === 0) {
    return jsonResponse({ ok: false, error: 'Page not found' }, 404, cors);
  }

  return jsonResponse({ ok: true }, 200, cors);
}

/** POST /api/content/sync/import — 批次匯入頁面（從子倉庫） */
async function importPages(
  body: { pages: ImportPageRequest[]; sourceCommit?: string },
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const now = new Date().toISOString();
  const imported: string[] = [];
  const skipped: string[] = [];
  const updated: string[] = [];

  for (const page of body.pages) {
    const existing = await db
      .prepare('SELECT id, status, base_content_hash FROM pages WHERE id = ?')
      .bind(page.id)
      .first<Pick<PageRow, 'id' | 'status' | 'base_content_hash'>>();

    if (!existing) {
      // 新頁面：直接匯入
      await db
        .prepare(
          `INSERT INTO pages (id, area, title, slug, sort_order, content, source_file, base_content_hash, status, metadata, parent_id, depth, page_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          page.id,
          page.area,
          page.title,
          page.slug,
          page.sortOrder || 0,
          JSON.stringify(page.content),
          page.sourceFile,
          page.contentHash,
          JSON.stringify(page.metadata || {}),
          page.parentId || null,
          page.depth || 0,
          page.pageType || 'page',
          now,
          now
        )
        .run();
      imported.push(page.id);
    } else if (existing.status === 'synced') {
      // 同步中的頁面：來源有變更時自動更新
      if (existing.base_content_hash !== page.contentHash) {
        await db
          .prepare(
            `UPDATE pages SET title = ?, content = ?, base_content_hash = ?, source_file = ?, updated_at = ? WHERE id = ?`
          )
          .bind(
            page.title,
            JSON.stringify(page.content),
            page.contentHash,
            page.sourceFile,
            now,
            page.id
          )
          .run();
        updated.push(page.id);
      } else {
        skipped.push(page.id);
      }
    } else {
      // 已修改的頁面：不自動覆蓋，只更新 base hash 供比對
      if (existing.base_content_hash !== page.contentHash) {
        // 標記來源有新版本（metadata 裡記錄）
        await db
          .prepare(
            `UPDATE pages SET metadata = json_set(COALESCE(metadata, '{}'), '$.pendingSourceHash', ?), updated_at = ? WHERE id = ?`
          )
          .bind(page.contentHash, now, page.id)
          .run();
        skipped.push(page.id);
      } else {
        skipped.push(page.id);
      }
    }
  }

  // 記錄同步日誌
  await db
    .prepare(
      `INSERT INTO sync_log (action, affected_pages, source_commit, details, created_at)
       VALUES ('import', ?, ?, ?, ?)`
    )
    .bind(
      JSON.stringify([...imported, ...updated]),
      body.sourceCommit || null,
      JSON.stringify({
        imported: imported.length,
        updated: updated.length,
        skipped: skipped.length,
      }),
      now
    )
    .run();

  return jsonResponse(
    {
      ok: true,
      data: {
        imported: imported.length,
        updated: updated.length,
        skipped: skipped.length,
        details: { imported, updated, skipped },
      },
    },
    200,
    cors
  );
}

/** POST /api/content/purge — 硬刪除超過指定天數的軟刪除記錄 */
async function purgeDeletedPages(
  url: URL,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const days = parseInt(url.searchParams.get('days') || '30', 10);
  if (isNaN(days) || days < 0) {
    return jsonResponse(
      { ok: false, error: 'days 參數必須為非負整數' },
      400,
      cors
    );
  }

  const cutoff = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000
  ).toISOString();

  // 先查詢會被清除的頁面
  const toDelete = await db
    .prepare(
      'SELECT id, area, title, deleted_at FROM pages WHERE deleted_at IS NOT NULL AND deleted_at <= ?'
    )
    .bind(cutoff)
    .all<{ id: string; area: string; title: string; deleted_at: string }>();

  const ids = (toDelete.results || []).map((r) => r.id);

  if (ids.length === 0) {
    return jsonResponse(
      { ok: true, data: { purged: 0, message: '沒有需要清除的記錄' } },
      200,
      cors
    );
  }

  // 執行硬刪除
  const result = await db
    .prepare(
      'DELETE FROM pages WHERE deleted_at IS NOT NULL AND deleted_at <= ?'
    )
    .bind(cutoff)
    .run();

  return jsonResponse(
    {
      ok: true,
      data: {
        purged: result.meta.changes,
        cutoffDate: cutoff,
        days,
        ids,
      },
    },
    200,
    cors
  );
}

/** GET /api/content/sync/status — 取得同步狀態總覽 */
async function getSyncStatus(
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const counts = await db
    .prepare(
      `SELECT
        area,
        status,
        COUNT(*) as count
       FROM pages
       WHERE deleted_at IS NULL
       GROUP BY area, status
       ORDER BY area`
    )
    .all<{ area: string; status: string; count: number }>();

  const pendingUpdates = await db
    .prepare(
      `SELECT id, area, title FROM pages
       WHERE deleted_at IS NULL
         AND json_extract(metadata, '$.pendingSourceHash') IS NOT NULL`
    )
    .all<{ id: string; area: string; title: string }>();

  const lastSync = await db
    .prepare('SELECT * FROM sync_log ORDER BY created_at DESC LIMIT 1')
    .first();

  return jsonResponse(
    {
      ok: true,
      data: {
        pageCounts: counts.results || [],
        pendingUpdates: pendingUpdates.results || [],
        lastSync,
      },
    },
    200,
    cors
  );
}

// ===== Auth 路由 =====

/** POST /api/auth/login — 驗證帳密，回傳 JWT */
async function handleLogin(
  body: LoginRequest,
  db: D1Database,
  jwtSecret: string,
  cors: Record<string, string>
): Promise<Response> {
  const row = await db
    .prepare('SELECT * FROM admin_users WHERE username = ? AND is_active = 1')
    .bind(body.username)
    .first<AdminUserRow>();

  if (!row) {
    // 防止 timing 差異洩漏使用者名稱是否存在
    await new Promise((r) => setTimeout(r, 200));
    return jsonResponse({ ok: false, error: '憑證錯誤' }, 401, cors);
  }

  const valid = await verifyPassword(body.password, row.password_hash);
  if (!valid) {
    return jsonResponse({ ok: false, error: '憑證錯誤' }, 401, cors);
  }

  const now = Math.floor(Date.now() / 1000);
  const jti = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const payload: JwtPayload = {
    sub: row.username,
    role: row.role,
    display_name: row.display_name,
    iat: now,
    exp: now + 86400, // 24 小時
    jti,
  };

  const token = await signJwt(payload, jwtSecret);

  return jsonResponse(
    {
      ok: true,
      data: {
        token,
        username: row.username,
        role: row.role,
        display_name: row.display_name,
      },
    },
    200,
    cors
  );
}

/** GET /api/auth/me — 驗證 JWT，回傳使用者資訊 */
async function handleMe(
  request: Request,
  jwtSecret: string,
  cors: Record<string, string>
): Promise<Response> {
  const auth = request.headers.get('Authorization');
  const token = auth?.replace('Bearer ', '');
  if (!token) {
    return jsonResponse({ ok: false, error: 'No token provided' }, 401, cors);
  }

  const payload = await verifyJwt(token, jwtSecret);
  if (!payload) {
    return jsonResponse(
      { ok: false, error: 'Invalid or expired token' },
      401,
      cors
    );
  }

  return jsonResponse(
    {
      ok: true,
      data: {
        username: payload.sub,
        role: payload.role,
        display_name: payload.display_name,
      },
    },
    200,
    cors
  );
}

/** POST /api/auth/bootstrap — 建立首位管理員（僅限 table 為空） */
async function handleBootstrap(
  body: BootstrapRequest,
  request: Request,
  db: D1Database,
  bootstrapToken: string | undefined,
  cors: Record<string, string>
): Promise<Response> {
  // 驗證 bootstrap token
  if (bootstrapToken) {
    const auth = request.headers.get('Authorization');
    const token = auth?.replace('Bearer ', '');
    if (token !== bootstrapToken) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
    }
  }

  // 確認 table 為空
  const count = await db
    .prepare('SELECT COUNT(*) as cnt FROM admin_users')
    .first<{ cnt: number }>();

  if (count && count.cnt > 0) {
    return jsonResponse(
      { ok: false, error: 'Admin users already exist. Bootstrap is disabled.' },
      403,
      cors
    );
  }

  const passwordHash = await hashPassword(body.password);
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO admin_users (username, password_hash, role, display_name, is_active, created_at, updated_at)
       VALUES (?, ?, 'super_admin', ?, 1, ?, ?)`
    )
    .bind(
      body.username,
      passwordHash,
      body.display_name || body.username,
      now,
      now
    )
    .run();

  return jsonResponse(
    {
      ok: true,
      data: {
        username: body.username,
        role: 'super_admin',
        display_name: body.display_name || body.username,
      },
    },
    201,
    cors
  );
}

// ===== 媒體庫處理 =====

/** GET /api/assets — 列出 R2 資產並交叉比對 D1 引用 */
async function listAssets(
  url: URL,
  bucket: R2Bucket,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const prefix = url.searchParams.get('prefix') || undefined;
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || '200', 10) || 200,
    500
  );
  const cursor = url.searchParams.get('cursor') || undefined;

  // 1. R2 列表
  const listed = await bucket.list({ prefix, limit, cursor });

  // 2. D1 交叉比對 — 建立引用 Map
  const referenceMap = new Map<string, string[]>();

  // 查詢 song 頁面的 metadata（audioFile, coverImage）
  const songRows = await db
    .prepare("SELECT id, metadata FROM pages WHERE page_type = 'song'")
    .all<{ id: string; metadata: string }>();

  for (const row of songRows.results || []) {
    try {
      const meta = JSON.parse(row.metadata || '{}');
      for (const field of ['audioFile', 'coverImage']) {
        const key: string | undefined = meta[field];
        if (key) {
          if (!referenceMap.has(key)) referenceMap.set(key, []);
          referenceMap.get(key)!.push(row.id);
        }
      }
    } catch {
      // 略過格式錯誤的 metadata
    }
  }

  // 掃描 gallery 頁面的 metadata.images 陣列，找出圖片/精靈圖引用
  const galleryRows = await db
    .prepare("SELECT id, metadata FROM pages WHERE page_type = 'gallery'")
    .all<{ id: string; metadata: string }>();

  for (const row of galleryRows.results || []) {
    try {
      const meta = JSON.parse(row.metadata || '{}');
      const imgs = Array.isArray(meta.images) ? meta.images : [];
      for (const img of imgs) {
        if (typeof img.file === 'string' && img.file) {
          if (!referenceMap.has(img.file)) referenceMap.set(img.file, []);
          const refs = referenceMap.get(img.file)!;
          if (!refs.includes(row.id)) refs.push(row.id);
        }
      }
    } catch {
      // 略過格式錯誤的 metadata
    }
  }

  // 掃描所有頁面的 content，找出資產引用
  const contentRows = await db
    .prepare('SELECT id, content FROM pages')
    .all<{ id: string; content: string }>();

  const assetUrlRegex = /\/api\/assets\/((?:images|audio|files)\/[^\s"'<>]+)/g;
  // 裸 R2 key 格式（用於 JSON 結構化資料中直接儲存的 key）
  const bareKeyRegex = /^(images|audio|files)\//;

  for (const row of contentRows.results || []) {
    try {
      const blocks = JSON.parse(row.content || '[]');
      for (const block of blocks) {
        if (typeof block.content !== 'string') continue;

        // browser_profile 區塊：掃描 profiles[].avatar 裸 R2 key
        if (block.type === 'browser_profile') {
          try {
            const data = JSON.parse(block.content);
            const profiles = Array.isArray(data.profiles) ? data.profiles : [];
            for (const profile of profiles) {
              if (
                typeof profile.avatar === 'string' &&
                bareKeyRegex.test(profile.avatar)
              ) {
                if (!referenceMap.has(profile.avatar))
                  referenceMap.set(profile.avatar, []);
                const refs = referenceMap.get(profile.avatar)!;
                if (!refs.includes(row.id)) refs.push(row.id);
              }
            }
          } catch {
            // 略過格式錯誤的 browser_profile
          }
        }

        // HTML 內容：掃描 /api/assets/ URL 引用
        assetUrlRegex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = assetUrlRegex.exec(block.content)) !== null) {
          const key = match[1];
          if (!referenceMap.has(key)) referenceMap.set(key, []);
          const refs = referenceMap.get(key)!;
          if (!refs.includes(row.id)) refs.push(row.id);
        }
      }
    } catch {
      // 略過格式錯誤的 content
    }
  }

  // 3. 組合回傳
  const items: AssetItem[] = listed.objects.map((obj) => {
    const refs = referenceMap.get(obj.key) || [];
    return {
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded.toISOString(),
      contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
      originalName: obj.customMetadata?.originalName,
      referenced: refs.length > 0,
      referencedBy: refs,
    };
  });

  const data: ListAssetsResponse = {
    items,
    cursor: listed.truncated ? listed.cursor : undefined,
    hasMore: listed.truncated,
  };

  return jsonResponse({ ok: true, data }, 200, cors);
}

/** DELETE /api/assets/batch — 批次刪除多個 R2 資產 */
async function batchDeleteAssets(
  body: BatchDeleteRequest,
  bucket: R2Bucket,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    return jsonResponse({ ok: false, error: 'No keys provided' }, 400, cors);
  }
  if (body.keys.length > 100) {
    return jsonResponse(
      { ok: false, error: 'Maximum 100 keys per batch' },
      400,
      cors
    );
  }

  const results = await Promise.allSettled(
    body.keys.map((key) => bucket.delete(key))
  );
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? body.keys[i] : null))
    .filter(Boolean) as string[];

  if (failed.length > 0) {
    return jsonResponse(
      { ok: false, error: `刪除失敗：${failed.join(', ')}` },
      500,
      cors
    );
  }

  const stmt = db.prepare(
    "INSERT OR REPLACE INTO deleted_assets (key, deleted_at) VALUES (?, datetime('now'))"
  );
  await db.batch(body.keys.map((key) => stmt.bind(key)));

  return jsonResponse(
    { ok: true, data: { deleted: body.keys.length } },
    200,
    cors
  );
}

/** POST /api/assets/rename — 重新命名 R2 資產並更新 D1 引用 */
async function renameAsset(
  body: { oldKey: string; newKey: string },
  bucket: R2Bucket,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const { oldKey, newKey } = body;
  if (!oldKey || !newKey) {
    return jsonResponse(
      { ok: false, error: 'oldKey and newKey are required' },
      400,
      cors
    );
  }
  if (oldKey === newKey) {
    return jsonResponse({ ok: true, data: { key: newKey } }, 200, cors);
  }

  // 1. 確認原檔案存在
  const obj = await bucket.get(oldKey);
  if (!obj) {
    return jsonResponse({ ok: false, error: '原始檔案不存在' }, 404, cors);
  }

  // 2. 複製到新 key
  await bucket.put(newKey, obj.body, {
    httpMetadata: obj.httpMetadata,
    customMetadata: obj.customMetadata,
  });

  // 3. 刪除舊 key，記錄刪除並清除新 key 的刪除紀錄
  await bucket.delete(oldKey);
  await db.batch([
    db
      .prepare(
        "INSERT OR REPLACE INTO deleted_assets (key, deleted_at) VALUES (?, datetime('now'))"
      )
      .bind(oldKey),
    db.prepare('DELETE FROM deleted_assets WHERE key = ?').bind(newKey),
  ]);

  // 4. 更新 D1 引用 — metadata（audioFile, coverImage）
  const songRows = await db
    .prepare("SELECT id, metadata FROM pages WHERE page_type = 'song'")
    .all<{ id: string; metadata: string }>();

  for (const row of songRows.results || []) {
    try {
      const meta = JSON.parse(row.metadata || '{}');
      let changed = false;
      if (meta.audioFile === oldKey) {
        meta.audioFile = newKey;
        changed = true;
      }
      if (meta.coverImage === oldKey) {
        meta.coverImage = newKey;
        changed = true;
      }
      if (changed) {
        await db
          .prepare(
            "UPDATE pages SET metadata = ?, updated_at = datetime('now') WHERE id = ?"
          )
          .bind(JSON.stringify(meta), row.id)
          .run();
      }
    } catch {
      // 略過格式錯誤的 metadata
    }
  }

  // 5. 更新 D1 引用 — content HTML 中的 /api/assets/ URL
  const contentRows = await db
    .prepare('SELECT id, content FROM pages')
    .all<{ id: string; content: string }>();

  for (const row of contentRows.results || []) {
    try {
      const content = row.content || '[]';
      if (!content.includes(oldKey)) continue;
      const updated = content.split(oldKey).join(newKey);
      await db
        .prepare(
          "UPDATE pages SET content = ?, updated_at = datetime('now') WHERE id = ?"
        )
        .bind(updated, row.id)
        .run();
    } catch {
      // 略過格式錯誤的 content
    }
  }

  return jsonResponse({ ok: true, data: { key: newKey } }, 200, cors);
}

// ===== Worker 入口 =====

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = getCorsHeaders(request, env);

    // OPTIONS 預檢
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const path = url.pathname;

    // ---- 認證路由（在 isAuthorized 檢查之前） ----

    if (path === '/api/auth/login' && request.method === 'POST') {
      if (!env.JWT_SECRET) {
        return jsonResponse(
          { ok: false, error: 'JWT_SECRET not configured' },
          500,
          cors
        );
      }
      const body = (await request.json()) as LoginRequest;
      return handleLogin(body, env.CONTENT_DB, env.JWT_SECRET, cors);
    }

    if (path === '/api/auth/me' && request.method === 'GET') {
      if (!env.JWT_SECRET) {
        return jsonResponse(
          { ok: false, error: 'JWT_SECRET not configured' },
          500,
          cors
        );
      }
      return handleMe(request, env.JWT_SECRET, cors);
    }

    if (path === '/api/auth/bootstrap' && request.method === 'POST') {
      const body = (await request.json()) as BootstrapRequest;
      return handleBootstrap(
        body,
        request,
        env.CONTENT_DB,
        env.BOOTSTRAP_TOKEN,
        cors
      );
    }

    // ---- 媒體庫路由（JWT 保護，在 isWriteMethod guard 之前） ----

    // GET /api/assets — 列出所有資產
    if (path === '/api/assets' && request.method === 'GET') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      return listAssets(url, env.ASSETS_BUCKET, env.CONTENT_DB, cors);
    }

    // DELETE /api/assets/batch — 批次刪除（必須在 assetMatch regex 之前）
    if (path === '/api/assets/batch' && request.method === 'DELETE') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const body = (await request.json()) as BatchDeleteRequest;
      return batchDeleteAssets(body, env.ASSETS_BUCKET, env.CONTENT_DB, cors);
    }

    // GET /api/assets/deleted — 列出已刪除的資產紀錄（同步用）
    if (path === '/api/assets/deleted' && request.method === 'GET') {
      const result = await env.CONTENT_DB.prepare(
        'SELECT key, deleted_at FROM deleted_assets ORDER BY deleted_at DESC'
      ).all<{ key: string; deleted_at: string }>();
      return jsonResponse(
        {
          ok: true,
          data: (result.results || []).map((r) => ({
            key: r.key,
            deletedAt: r.deleted_at,
          })),
        },
        200,
        cors
      );
    }

    // POST /api/assets/deleted/purge — 清除過期的刪除紀錄
    if (path === '/api/assets/deleted/purge' && request.method === 'POST') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const days = parseInt(url.searchParams.get('days') || '30', 10);
      const result = await env.CONTENT_DB.prepare(
        "DELETE FROM deleted_assets WHERE deleted_at < datetime('now', '-' || ? || ' days')"
      )
        .bind(days)
        .run();
      return jsonResponse(
        { ok: true, data: { purged: result.meta.changes || 0 } },
        200,
        cors
      );
    }

    // POST /api/assets/deleted/record — 記錄刪除（同步傳播用，不實際刪除 R2）
    if (path === '/api/assets/deleted/record' && request.method === 'POST') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const body = (await request.json()) as { keys: string[] };
      if (!Array.isArray(body.keys) || body.keys.length === 0) {
        return jsonResponse(
          { ok: false, error: 'No keys provided' },
          400,
          cors
        );
      }
      const stmt = env.CONTENT_DB.prepare(
        "INSERT OR REPLACE INTO deleted_assets (key, deleted_at) VALUES (?, datetime('now'))"
      );
      await env.CONTENT_DB.batch(body.keys.map((key) => stmt.bind(key)));
      return jsonResponse(
        { ok: true, data: { recorded: body.keys.length } },
        200,
        cors
      );
    }

    // POST /api/assets/rename — 重新命名資產
    if (path === '/api/assets/rename' && request.method === 'POST') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const body = (await request.json()) as { oldKey: string; newKey: string };
      return renameAsset(body, env.ASSETS_BUCKET, env.CONTENT_DB, cors);
    }

    // DELETE /api/assets/:key — 單筆刪除（JWT 保護，與批次刪除一致）
    const assetDeleteMatch = path.match(/^\/api\/assets\/(.+)$/);
    if (assetDeleteMatch && request.method === 'DELETE') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const key = decodeURIComponent(assetDeleteMatch[1]);
      await env.ASSETS_BUCKET.delete(key);
      await env.CONTENT_DB.prepare(
        "INSERT OR REPLACE INTO deleted_assets (key, deleted_at) VALUES (?, datetime('now'))"
      )
        .bind(key)
        .run();
      return jsonResponse({ ok: true }, 200, cors);
    }

    // ---- 內容路由授權檢查 ----
    const isWriteMethod = ['POST', 'PUT', 'DELETE'].includes(request.method);

    if (isWriteMethod && !isAuthorized(request, env)) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
    }

    // ---- 同步相關路由 ----

    // POST /api/content/purge — 硬刪除過期的軟刪除記錄
    if (path === '/api/content/purge' && request.method === 'POST') {
      return purgeDeletedPages(url, env.CONTENT_DB, cors);
    }

    if (path === '/api/content/sync/import' && request.method === 'POST') {
      const body = (await request.json()) as {
        pages: ImportPageRequest[];
        sourceCommit?: string;
      };
      return importPages(body, env.CONTENT_DB, cors);
    }

    if (path === '/api/content/sync/status' && request.method === 'GET') {
      return getSyncStatus(env.CONTENT_DB, cors);
    }

    // ---- 最近更新路由（僅葉子頁面）----
    if (path === '/api/content/recent' && request.method === 'GET') {
      const limit = Math.min(
        parseInt(url.searchParams.get('limit') || '5', 10) || 5,
        20
      );
      const leafTypes = ['page', 'song', 'gallery', 'stuff'];
      const placeholders = leafTypes.map(() => '?').join(',');
      const rows =
        (
          await env.CONTENT_DB.prepare(
            `SELECT id, area, title, slug, page_type, metadata, updated_at
           FROM pages
           WHERE page_type IN (${placeholders})
             AND deleted_at IS NULL
             AND status != 'draft'
             AND COALESCE(json_extract(metadata, '$.locked'), 0) != 1
             AND COALESCE(json_extract(metadata, '$.hidden'), 0) != 1
           ORDER BY updated_at DESC
           LIMIT ?`
          )
            .bind(...leafTypes, limit)
            .all<PageRow>()
        ).results || [];
      const items = rows.map((r) => ({
        id: r.id,
        area: r.area,
        title: r.title,
        slug: r.slug,
        pageType: r.page_type,
        metadata: JSON.parse(r.metadata || '{}'),
        updatedAt: r.updated_at,
      }));
      return jsonResponse({ ok: true, data: items }, 200, cors);
    }

    // ---- 樹狀結構路由 ----
    const treeMatch = path.match(/^\/api\/content\/([a-z]+)\/tree$/);
    if (treeMatch && request.method === 'GET') {
      const area = treeMatch[1];
      const treeIncludeDeleted =
        url.searchParams.get('include_deleted') === 'true';
      const treeQuery = treeIncludeDeleted
        ? 'SELECT * FROM pages WHERE area = ? ORDER BY sort_order ASC'
        : 'SELECT * FROM pages WHERE area = ? AND deleted_at IS NULL ORDER BY sort_order ASC';
      const result = await env.CONTENT_DB.prepare(treeQuery)
        .bind(area)
        .all<PageRow>();
      const rows = result.results || [];
      const items = rows.map((r) => ({
        ...rowToListItem(r),
        metadata: JSON.parse(r.metadata || '{}'),
      }));
      const tree = buildTree(items);
      return jsonResponse({ ok: true, data: tree }, 200, cors);
    }

    // ---- 圖片資源路由 (R2) ----
    const assetMatch = path.match(/^\/api\/assets\/(.+)$/);
    if (assetMatch) {
      const key = decodeURIComponent(assetMatch[1]);

      if (request.method === 'GET') {
        // 解析 Range header 以支援音訊 seek（瀏覽器 <audio> 需要 206 Partial Content）
        const rangeHeader = request.headers.get('Range');
        const obj = await env.ASSETS_BUCKET.get(
          key,
          rangeHeader
            ? {
                range: request.headers,
              }
            : undefined
        );
        if (!obj) {
          return jsonResponse({ ok: false, error: 'Not found' }, 404, cors);
        }
        const headers = new Headers(cors);
        headers.set(
          'Content-Type',
          obj.httpMetadata?.contentType || 'application/octet-stream'
        );
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Accept-Ranges', 'bytes');
        // R2 有處理 Range 時會在 obj.range 回傳實際範圍
        if (rangeHeader && obj.range) {
          const r = obj.range;
          const offset = 'offset' in r ? (r.offset ?? 0) : 0;
          const length = 'length' in r ? r.length : undefined;
          const suffix = 'suffix' in r ? r.suffix : undefined;
          let start: number;
          let end: number;
          if (suffix != null) {
            start = obj.size - suffix;
            end = obj.size - 1;
          } else if (length != null) {
            start = offset;
            end = offset + length - 1;
          } else {
            start = offset;
            end = obj.size - 1;
          }
          const contentLength = end - start + 1;
          headers.set('Content-Length', String(contentLength));
          headers.set('Content-Range', `bytes ${start}-${end}/${obj.size}`);
          return new Response(obj.body, { status: 206, headers });
        }
        headers.set('Content-Length', String(obj.size));
        return new Response(obj.body, { headers });
      }

      if (request.method === 'HEAD') {
        const obj = await env.ASSETS_BUCKET.head(key);
        if (!obj) {
          return jsonResponse({ ok: false, error: 'Not found' }, 404, cors);
        }
        const headers = new Headers(cors);
        headers.set(
          'Content-Type',
          obj.httpMetadata?.contentType || 'application/octet-stream'
        );
        headers.set('Content-Length', String(obj.size));
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(null, { headers });
      }

      if (request.method === 'DELETE') {
        await env.ASSETS_BUCKET.delete(key);
        await env.CONTENT_DB.prepare(
          "INSERT OR REPLACE INTO deleted_assets (key, deleted_at) VALUES (?, datetime('now'))"
        )
          .bind(key)
          .run();
        return jsonResponse({ ok: true }, 200, cors);
      }
    }

    if (path === '/api/assets' && request.method === 'POST') {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return jsonResponse(
          { ok: false, error: 'No file provided' },
          400,
          cors
        );
      }

      const contentType = file.type || 'application/octet-stream';
      // 允許透過 formData 指定 key（sync 用途），否則自動產生
      const explicitKey = formData.get('key') as string | null;
      let key: string;
      if (explicitKey) {
        key = explicitKey;
      } else {
        const prefix = contentType.startsWith('audio/')
          ? 'audio'
          : contentType.startsWith('image/')
            ? 'images'
            : 'files';
        // 加上 timestamp + random suffix 避免同名檔案覆蓋 R2 資源
        const ext = file.name.includes('.')
          ? `.${file.name.split('.').pop()}`
          : '';
        const base = file.name.replace(/\.[^.]+$/, '');
        const suffix =
          Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        key = `${prefix}/${base}-${suffix}${ext}`;
      }

      await env.ASSETS_BUCKET.put(key, file.stream(), {
        httpMetadata: { contentType: file.type },
        customMetadata: { originalName: file.name },
      });

      await env.CONTENT_DB.prepare('DELETE FROM deleted_assets WHERE key = ?')
        .bind(key)
        .run();

      const assetUrl = `/api/assets/${key}`;
      return jsonResponse(
        {
          ok: true,
          data: {
            key,
            url: assetUrl,
            name: file.name,
            size: file.size,
            type: file.type,
          },
        },
        201,
        cors
      );
    }

    // ---- 內容 CRUD 路由 ----
    // 匹配 /api/content/:area 或 /api/content/:area/:slug(可含子路徑)
    const contentMatch = path.match(/^\/api\/content\/([a-z]+)(?:\/(.+))?$/);

    if (contentMatch) {
      const [, area, slug] = contentMatch;

      const includeDeleted = url.searchParams.get('include_deleted') === 'true';

      if (!slug) {
        // /api/content/:area
        if (request.method === 'GET')
          return listPages(area, env.CONTENT_DB, cors, includeDeleted);
        return jsonResponse(
          { ok: false, error: 'Method not allowed' },
          405,
          cors
        );
      }

      // /api/content/:area/:slug
      switch (request.method) {
        case 'GET':
          return getPage(area, slug, env.CONTENT_DB, cors, includeDeleted);
        case 'PUT': {
          const body = (await request.json()) as UpsertPageRequest;
          return upsertPage(area, slug, body, env.CONTENT_DB, cors);
        }
        case 'DELETE':
          return deletePage(area, slug, env.CONTENT_DB, cors);
        default:
          return jsonResponse(
            { ok: false, error: 'Method not allowed' },
            405,
            cors
          );
      }
    }

    // ---- 網站首頁內容路由 ----

    if (path === '/api/homepage' && request.method === 'GET') {
      const rows = await env.CONTENT_DB.prepare(
        'SELECT section_id, content, updated_at FROM site_homepage'
      ).all<{ section_id: string; content: string; updated_at: string }>();

      const data: Record<string, { content: unknown; updatedAt: string }> = {};
      for (const row of rows.results || []) {
        try {
          data[row.section_id] = {
            content: JSON.parse(row.content),
            updatedAt: row.updated_at,
          };
        } catch {
          data[row.section_id] = { content: {}, updatedAt: row.updated_at };
        }
      }
      return jsonResponse({ ok: true, data }, 200, cors);
    }

    const homepageMatch = path.match(/^\/api\/homepage\/([a-z][a-z0-9-]*)$/);
    if (homepageMatch && request.method === 'PUT') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const sectionId = homepageMatch[1];
      const body = (await request.json()) as { content: unknown };
      if (!body.content) {
        return jsonResponse(
          { ok: false, error: 'content is required' },
          400,
          cors
        );
      }
      const now = new Date().toISOString();
      await env.CONTENT_DB.prepare(
        `INSERT INTO site_homepage (section_id, content, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(section_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
      )
        .bind(sectionId, JSON.stringify(body.content), now)
        .run();

      return jsonResponse(
        {
          ok: true,
          data: { sectionId, content: body.content, updatedAt: now },
        },
        200,
        cors
      );
    }

    // 健康檢查
    if (path === '/api/health') {
      return jsonResponse(
        { ok: true, data: { service: 'content-api', version: '1.0.0' } },
        200,
        cors
      );
    }

    return jsonResponse({ ok: false, error: 'Not found' }, 404, cors);
  },
};
