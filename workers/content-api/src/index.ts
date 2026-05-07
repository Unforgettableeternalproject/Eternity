import type {
  Env,
  PageRow,
  Page,
  PageListItem,
  PageTreeNode,
  UpsertPageRequest,
  ImportPageRequest,
  ApiResponse,
} from './types';

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
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(',') || [];
  const origin = request.headers.get('Origin') || '';
  const headers: Record<string, string> = {};

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
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
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

// ===== 路由處理 =====

/** GET /api/content/:area — 列出區域內所有頁面 */
async function listPages(
  area: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const result = await db
    .prepare('SELECT * FROM pages WHERE area = ? ORDER BY sort_order ASC')
    .bind(area)
    .all<PageRow>();

  const items: PageListItem[] = (result.results || []).map(rowToListItem);
  return jsonResponse({ ok: true, data: items }, 200, cors);
}

/** GET /api/content/:area/:slug — 取得單一頁面 */
async function getPage(
  area: string,
  slug: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const id = `${area}/${slug}`;
  const row = await db
    .prepare('SELECT * FROM pages WHERE id = ?')
    .bind(id)
    .first<PageRow>();

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
  const now = new Date().toISOString();

  // 檢查是否已存在
  const existing = await db
    .prepare('SELECT id, source_file, status FROM pages WHERE id = ?')
    .bind(id)
    .first<Pick<PageRow, 'id' | 'source_file' | 'status'>>();

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

    // 如果有來源檔案且內容被修改，標記為 modified
    if (body.content !== undefined && existing.source_file) {
      updates.push("status = 'modified'");
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
    await db
      .prepare(
        `INSERT INTO pages (id, area, title, slug, sort_order, content, status, metadata, parent_id, depth, page_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'local_only', ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        area,
        body.title || '',
        slug,
        body.sortOrder || 0,
        JSON.stringify(body.content || []),
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

/** DELETE /api/content/:area/:slug — 刪除頁面 */
async function deletePage(
  area: string,
  slug: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const id = `${area}/${slug}`;
  const result = await db
    .prepare('DELETE FROM pages WHERE id = ?')
    .bind(id)
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
       GROUP BY area, status
       ORDER BY area`
    )
    .all<{ area: string; status: string; count: number }>();

  const pendingUpdates = await db
    .prepare(
      `SELECT id, area, title FROM pages
       WHERE json_extract(metadata, '$.pendingSourceHash') IS NOT NULL`
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

    // 公開路由：讀取（不需要驗證）
    // 寫入路由：需要驗證
    const isWriteMethod = ['POST', 'PUT', 'DELETE'].includes(request.method);

    if (isWriteMethod && !isAuthorized(request, env)) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
    }

    // ---- 同步相關路由 ----
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

    // ---- 樹狀結構路由 ----
    const treeMatch = path.match(/^\/api\/content\/([a-z]+)\/tree$/);
    if (treeMatch && request.method === 'GET') {
      const area = treeMatch[1];
      const result = await env.CONTENT_DB.prepare(
        'SELECT * FROM pages WHERE area = ? ORDER BY sort_order ASC'
      )
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
      const key = assetMatch[1];

      if (request.method === 'GET') {
        const obj = await env.ASSETS_BUCKET.get(key);
        if (!obj) {
          return jsonResponse({ ok: false, error: 'Not found' }, 404, cors);
        }
        const headers = new Headers(cors);
        headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(obj.body, { headers });
      }

      if (request.method === 'DELETE') {
        await env.ASSETS_BUCKET.delete(key);
        return jsonResponse({ ok: true }, 200, cors);
      }
    }

    if (path === '/api/assets' && request.method === 'POST') {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return jsonResponse({ ok: false, error: 'No file provided' }, 400, cors);
      }

      const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
      const timestamp = Date.now();
      const key = `images/${timestamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      await env.ASSETS_BUCKET.put(key, file.stream(), {
        httpMetadata: { contentType: file.type },
        customMetadata: { originalName: file.name },
      });

      const assetUrl = `/api/assets/${key}`;
      return jsonResponse({
        ok: true,
        data: { key, url: assetUrl, name: file.name, size: file.size, type: file.type },
      }, 201, cors);
    }

    // ---- 內容 CRUD 路由 ----
    // 匹配 /api/content/:area 或 /api/content/:area/:slug(可含子路徑)
    const contentMatch = path.match(/^\/api\/content\/([a-z]+)(?:\/(.+))?$/);

    if (contentMatch) {
      const [, area, slug] = contentMatch;

      if (!slug) {
        // /api/content/:area
        if (request.method === 'GET')
          return listPages(area, env.CONTENT_DB, cors);
        return jsonResponse(
          { ok: false, error: 'Method not allowed' },
          405,
          cors
        );
      }

      // /api/content/:area/:slug
      switch (request.method) {
        case 'GET':
          return getPage(area, slug, env.CONTENT_DB, cors);
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
