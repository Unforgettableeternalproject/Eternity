/**
 * 主站（apps/root）API 路由
 * 掛載在 /api/root/* 下
 */
import type { Env, ApiResponse, JwtPayload } from './types';
import type {
  RootProjectRow,
  RootProject,
  UpsertRootProjectRequest,
  RootLinkRow,
  RootLink,
  UpsertRootLinkRequest,
  RootUpdateRow,
  RootUpdate,
  UpsertRootUpdateRequest,
  RootSingletonRow,
  RootSingleton,
  RootCardRow,
  RootCard,
} from './root-types';

// ===== Row → API 轉換 =====

function projectRowToApi(row: RootProjectRow): RootProject {
  return {
    id: row.id,
    titleZh: row.title_zh,
    titleEn: row.title_en,
    descZh: row.desc_zh,
    descEn: row.desc_en,
    contentZh: row.content_zh,
    contentEn: row.content_en,
    tags: JSON.parse(row.tags),
    featured: row.featured === 1,
    sortOrder: row.sort_order,
    status: row.status,
    image: row.image,
    links: {
      demo: row.link_demo,
      github: row.link_github,
      website: row.link_website,
    },
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function linkRowToApi(row: RootLinkRow): RootLink {
  return {
    id: row.id,
    titleZh: row.title_zh,
    titleEn: row.title_en,
    descZh: row.desc_zh,
    descEn: row.desc_en,
    url: row.url,
    category: row.category,
    status: row.status,
    icon: row.icon,
    featured: row.featured === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function updateRowToApi(row: RootUpdateRow): RootUpdate {
  return {
    id: row.id,
    titleZh: row.title_zh,
    titleEn: row.title_en,
    descZh: row.desc_zh,
    descEn: row.desc_en,
    contentZh: row.content_zh,
    contentEn: row.content_en,
    date: row.date,
    category: row.category,
    featured: row.featured === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function singletonRowToApi(row: RootSingletonRow): RootSingleton {
  return {
    sectionId: row.section_id,
    content: JSON.parse(row.content),
    updatedAt: row.updated_at,
  };
}

function cardRowToApi(row: RootCardRow): RootCard {
  return {
    sectionId: row.section_id,
    content: JSON.parse(row.content),
    updatedAt: row.updated_at,
  };
}

// ===== 工具函式 =====

function json<T>(
  data: ApiResponse<T>,
  status = 200,
  cors: Record<string, string> = {},
  /** 設為 true 時加入 CDN 短快取，適用於所有公開 GET 回應 */
  cacheable = false
): Response {
  const headers: Record<string, string> = {
    ...cors,
    'Content-Type': 'application/json',
  };
  if (cacheable && status >= 200 && status < 300) {
    // CDN 快取 60 秒，用戶端 10 秒，背景重驗證最長 5 分鐘
    headers['Cache-Control'] =
      'public, s-maxage=60, max-age=10, stale-while-revalidate=300';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

// ===== 主路由處理器 =====

export async function handleRootRoutes(
  path: string,
  method: string,
  request: Request,
  url: URL,
  env: Env,
  cors: Record<string, string>,
  requireJwt: (req: Request, env: Env) => Promise<JwtPayload | null>
): Promise<Response | null> {
  // /api/root/projects
  const projectsListMatch = path === '/api/root/projects';
  if (projectsListMatch && method === 'GET') {
    // include_deleted 需要認證
    if (url.searchParams.get('include_deleted') === 'true') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser)
        return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    }
    return listProjects(url, env.CONTENT_DB, cors);
  }

  // /api/root/projects/:id
  const projectMatch = path.match(
    /^\/api\/root\/projects\/([a-z0-9][a-z0-9_-]*)$/
  );
  if (projectMatch) {
    const id = projectMatch[1];
    if (method === 'GET') return getProject(id, env.CONTENT_DB, cors);
    if (method === 'PUT') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser)
        return json({ ok: false, error: 'Unauthorized' }, 401, cors);
      const body = (await request.json()) as UpsertRootProjectRequest;
      return upsertProject(id, body, env.CONTENT_DB, cors);
    }
    if (method === 'DELETE') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser)
        return json({ ok: false, error: 'Unauthorized' }, 401, cors);
      return softDeleteProject(id, env.CONTENT_DB, cors);
    }
  }

  // /api/root/links
  const linksListMatch = path === '/api/root/links';
  if (linksListMatch && method === 'GET') {
    if (url.searchParams.get('include_deleted') === 'true') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser)
        return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    }
    return listLinks(url, env.CONTENT_DB, cors);
  }

  // /api/root/links/:id
  const linkMatch = path.match(/^\/api\/root\/links\/([a-z0-9][a-z0-9_-]*)$/);
  if (linkMatch) {
    const id = linkMatch[1];
    if (method === 'GET') return getLink(id, env.CONTENT_DB, cors);
    if (method === 'PUT') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser)
        return json({ ok: false, error: 'Unauthorized' }, 401, cors);
      const body = (await request.json()) as UpsertRootLinkRequest;
      return upsertLink(id, body, env.CONTENT_DB, cors);
    }
    if (method === 'DELETE') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser)
        return json({ ok: false, error: 'Unauthorized' }, 401, cors);
      return softDeleteLink(id, env.CONTENT_DB, cors);
    }
  }

  // /api/root/updates
  const updatesListMatch = path === '/api/root/updates';
  if (updatesListMatch && method === 'GET') {
    if (url.searchParams.get('include_deleted') === 'true') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser)
        return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    }
    return listUpdates(url, env.CONTENT_DB, cors);
  }

  // /api/root/updates/:id
  const updateMatch = path.match(
    /^\/api\/root\/updates\/([a-z0-9][a-z0-9_-]*)$/
  );
  if (updateMatch) {
    const id = updateMatch[1];
    if (method === 'GET') return getUpdate(id, env.CONTENT_DB, cors);
    if (method === 'PUT') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser)
        return json({ ok: false, error: 'Unauthorized' }, 401, cors);
      const body = (await request.json()) as UpsertRootUpdateRequest;
      return upsertUpdate(id, body, env.CONTENT_DB, cors);
    }
    if (method === 'DELETE') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser)
        return json({ ok: false, error: 'Unauthorized' }, 401, cors);
      return softDeleteUpdate(id, env.CONTENT_DB, cors);
    }
  }

  // /api/root/singletons/:key
  const singletonMatch = path.match(
    /^\/api\/root\/singletons\/([a-z][a-z0-9-]*)$/
  );
  if (singletonMatch) {
    const key = singletonMatch[1];
    if (method === 'GET') return getSingleton(key, env.CONTENT_DB, cors);
    if (method === 'PUT') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser)
        return json({ ok: false, error: 'Unauthorized' }, 401, cors);
      const body = (await request.json()) as {
        content: unknown;
        updatedAt?: string;
      };
      return upsertSingleton(key, body, env.CONTENT_DB, cors);
    }
  }

  // /api/root/cards (list all)
  if (path === '/api/root/cards' && method === 'GET') {
    return listCards(env.CONTENT_DB, cors);
  }

  // /api/root/cards/:key
  const cardMatch = path.match(/^\/api\/root\/cards\/([a-z][a-z0-9-]*)$/);
  if (cardMatch) {
    const key = cardMatch[1];
    if (method === 'GET') return getCard(key, env.CONTENT_DB, cors);
    if (method === 'PUT') {
      const jwtUser = await requireJwt(request, env);
      if (!jwtUser)
        return json({ ok: false, error: 'Unauthorized' }, 401, cors);
      const body = (await request.json()) as {
        content: unknown;
        updatedAt?: string;
      };
      return upsertCard(key, body, env.CONTENT_DB, cors);
    }
  }

  // ── /api/root/assets (獨立 R2 bucket) ──

  // GET /api/root/assets — 列出資產（需認證，與文件站對齊）
  if (path === '/api/root/assets' && method === 'GET') {
    const jwtUser = await requireJwt(request, env);
    if (!jwtUser) return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    return listRootAssets(url, env.ROOT_ASSETS_BUCKET, cors);
  }

  // POST /api/root/assets — 上傳檔案
  if (path === '/api/root/assets' && method === 'POST') {
    const jwtUser = await requireJwt(request, env);
    if (!jwtUser) return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    return uploadRootAsset(request, env.ROOT_ASSETS_BUCKET, cors);
  }

  // DELETE /api/root/assets/batch — 批次刪除
  if (path === '/api/root/assets/batch' && method === 'DELETE') {
    const jwtUser = await requireJwt(request, env);
    if (!jwtUser) return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    const body = (await request.json()) as { keys: string[] };
    if (!Array.isArray(body.keys))
      return json({ ok: false, error: 'keys required' }, 400, cors);
    await Promise.all(body.keys.map((k) => env.ROOT_ASSETS_BUCKET.delete(k)));
    // 記錄刪除到 root_deleted_assets（同步用）
    if (body.keys.length > 0) {
      const stmts = body.keys.map((k) =>
        env.CONTENT_DB.prepare(
          "INSERT OR REPLACE INTO root_deleted_assets (key, deleted_at) VALUES (?, datetime('now'))"
        ).bind(k)
      );
      await env.CONTENT_DB.batch(stmts);
    }
    return json({ ok: true, data: { deleted: body.keys.length } }, 200, cors);
  }

  // GET /api/root/assets/deleted — 列出已刪除的資產紀錄（同步用，需認證）
  if (path === '/api/root/assets/deleted' && method === 'GET') {
    const jwtUser = await requireJwt(request, env);
    if (!jwtUser) return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    const since = url.searchParams.get('since');
    let rows;
    if (since) {
      rows = await env.CONTENT_DB.prepare(
        'SELECT key, deleted_at FROM root_deleted_assets WHERE deleted_at > ? ORDER BY deleted_at DESC'
      )
        .bind(since)
        .all();
    } else {
      rows = await env.CONTENT_DB.prepare(
        'SELECT key, deleted_at FROM root_deleted_assets ORDER BY deleted_at DESC'
      ).all();
    }
    const data = (rows.results || []).map((r: Record<string, unknown>) => ({
      key: r.key,
      deletedAt: r.deleted_at,
    }));
    return json({ ok: true, data }, 200, cors);
  }

  // POST /api/root/assets/deleted/purge — 清除過期的刪除紀錄
  if (path === '/api/root/assets/deleted/purge' && method === 'POST') {
    const jwtUser = await requireJwt(request, env);
    if (!jwtUser) return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    const body = (await request.json().catch(() => ({}))) as {
      olderThan?: string;
    };
    const cutoff =
      body.olderThan || new Date(Date.now() - 30 * 86400000).toISOString();
    const result = await env.CONTENT_DB.prepare(
      'DELETE FROM root_deleted_assets WHERE deleted_at < ?'
    )
      .bind(cutoff)
      .run();
    return json(
      { ok: true, data: { purged: result.meta?.changes || 0 } },
      200,
      cors
    );
  }

  // POST /api/root/assets/deleted/record — 記錄刪除（同步傳播用，不實際刪除 R2）
  if (path === '/api/root/assets/deleted/record' && method === 'POST') {
    const jwtUser = await requireJwt(request, env);
    if (!jwtUser) return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    const body = (await request.json()) as { keys: string[] };
    if (!Array.isArray(body.keys))
      return json({ ok: false, error: 'keys required' }, 400, cors);
    if (body.keys.length > 0) {
      const stmts = body.keys.map((k) =>
        env.CONTENT_DB.prepare(
          "INSERT OR REPLACE INTO root_deleted_assets (key, deleted_at) VALUES (?, datetime('now'))"
        ).bind(k)
      );
      await env.CONTENT_DB.batch(stmts);
    }
    return json({ ok: true, data: { recorded: body.keys.length } }, 200, cors);
  }

  // DELETE / GET / HEAD /api/root/assets/:key — 資產操作
  const rootAssetKeyMatch = path.match(/^\/api\/root\/assets\/(.+)$/);
  if (rootAssetKeyMatch && method === 'DELETE') {
    const jwtUser = await requireJwt(request, env);
    if (!jwtUser) return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    const key = decodeURIComponent(rootAssetKeyMatch[1]);
    await env.ROOT_ASSETS_BUCKET.delete(key);
    // 記錄刪除到 root_deleted_assets（同步用）
    await env.CONTENT_DB.prepare(
      "INSERT OR REPLACE INTO root_deleted_assets (key, deleted_at) VALUES (?, datetime('now'))"
    )
      .bind(key)
      .run();
    return json({ ok: true }, 200, cors);
  }

  // GET /api/root/assets/:key — 讀取檔案（公開，供前端 <img> 使用）
  if (rootAssetKeyMatch && method === 'GET') {
    const key = decodeURIComponent(rootAssetKeyMatch[1]);
    const obj = await env.ROOT_ASSETS_BUCKET.get(key);
    if (!obj) return json({ ok: false, error: 'Not found' }, 404, cors);
    const headers = new Headers(cors);
    headers.set(
      'Content-Type',
      obj.httpMetadata?.contentType || 'application/octet-stream'
    );
    headers.set('Content-Length', String(obj.size));
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(obj.body, { headers });
  }
  if (rootAssetKeyMatch && method === 'HEAD') {
    const key = decodeURIComponent(rootAssetKeyMatch[1]);
    const obj = await env.ROOT_ASSETS_BUCKET.head(key);
    if (!obj) return json({ ok: false, error: 'Not found' }, 404, cors);
    const headers = new Headers(cors);
    headers.set(
      'Content-Type',
      obj.httpMetadata?.contentType || 'application/octet-stream'
    );
    headers.set('Content-Length', String(obj.size));
    return new Response(null, { headers });
  }

  // 不匹配任何主站路由
  return null;
}

// ===== Projects 處理器 =====

async function listProjects(
  url: URL,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const conditions = ['deleted_at IS NULL'];
  const binds: (string | number)[] = [];

  const featured = url.searchParams.get('featured');
  if (featured === 'true') {
    conditions.push('featured = 1');
  }

  const status = url.searchParams.get('status');
  if (status) {
    conditions.push('status = ?');
    binds.push(status);
  }

  const includeDeleted = url.searchParams.get('include_deleted') === 'true';
  if (includeDeleted) {
    conditions.shift(); // 移除 deleted_at IS NULL
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT * FROM root_projects ${where} ORDER BY sort_order ASC, created_at DESC`;
  const stmt = db.prepare(query);
  const result =
    binds.length > 0
      ? await stmt.bind(...binds).all<RootProjectRow>()
      : await stmt.all<RootProjectRow>();

  return json(
    { ok: true, data: (result.results || []).map(projectRowToApi) },
    200,
    cors,
    true
  );
}

async function getProject(
  id: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const row = await db
    .prepare('SELECT * FROM root_projects WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<RootProjectRow>();

  if (!row) {
    return json({ ok: false, error: 'Project not found' }, 404, cors);
  }
  return json({ ok: true, data: projectRowToApi(row) }, 200, cors, true);
}

async function upsertProject(
  id: string,
  body: UpsertRootProjectRequest,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const now = body.updatedAt || new Date().toISOString();
  const existing = await db
    .prepare('SELECT id FROM root_projects WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();

  if (existing) {
    // UPDATE
    const sets: string[] = ['updated_at = ?'];
    const binds: (string | number | null)[] = [now];

    if (body.titleZh !== undefined) {
      sets.push('title_zh = ?');
      binds.push(body.titleZh);
    }
    if (body.titleEn !== undefined) {
      sets.push('title_en = ?');
      binds.push(body.titleEn);
    }
    if (body.descZh !== undefined) {
      sets.push('desc_zh = ?');
      binds.push(body.descZh);
    }
    if (body.descEn !== undefined) {
      sets.push('desc_en = ?');
      binds.push(body.descEn);
    }
    if (body.contentZh !== undefined) {
      sets.push('content_zh = ?');
      binds.push(body.contentZh);
    }
    if (body.contentEn !== undefined) {
      sets.push('content_en = ?');
      binds.push(body.contentEn);
    }
    if (body.tags !== undefined) {
      sets.push('tags = ?');
      binds.push(JSON.stringify(body.tags));
    }
    if (body.featured !== undefined) {
      sets.push('featured = ?');
      binds.push(body.featured ? 1 : 0);
    }
    if (body.sortOrder !== undefined) {
      sets.push('sort_order = ?');
      binds.push(body.sortOrder);
    }
    if (body.status !== undefined) {
      sets.push('status = ?');
      binds.push(body.status);
    }
    if (body.image !== undefined) {
      sets.push('image = ?');
      binds.push(body.image);
    }
    if (body.links?.demo !== undefined) {
      sets.push('link_demo = ?');
      binds.push(body.links.demo);
    }
    if (body.links?.github !== undefined) {
      sets.push('link_github = ?');
      binds.push(body.links.github);
    }
    if (body.links?.website !== undefined) {
      sets.push('link_website = ?');
      binds.push(body.links.website);
    }
    if (body.startDate !== undefined) {
      sets.push('start_date = ?');
      binds.push(body.startDate);
    }
    if (body.endDate !== undefined) {
      sets.push('end_date = ?');
      binds.push(body.endDate);
    }

    // 恢復軟刪除
    sets.push('deleted_at = NULL');

    binds.push(id);
    await db
      .prepare(`UPDATE root_projects SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
  } else {
    // INSERT
    await db
      .prepare(
        `INSERT INTO root_projects
         (id, title_zh, title_en, desc_zh, desc_en, content_zh, content_en,
          tags, featured, sort_order, status, image,
          link_demo, link_github, link_website, start_date, end_date,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        body.titleZh ?? '',
        body.titleEn ?? '',
        body.descZh ?? '',
        body.descEn ?? '',
        body.contentZh ?? '',
        body.contentEn ?? '',
        JSON.stringify(body.tags ?? []),
        body.featured ? 1 : 0,
        body.sortOrder ?? 0,
        body.status ?? 'active',
        body.image ?? null,
        body.links?.demo ?? null,
        body.links?.github ?? null,
        body.links?.website ?? null,
        body.startDate ?? null,
        body.endDate ?? null,
        now,
        now
      )
      .run();
  }

  // 回傳最新資料
  const row = await db
    .prepare('SELECT * FROM root_projects WHERE id = ?')
    .bind(id)
    .first<RootProjectRow>();

  return json(
    { ok: true, data: row ? projectRowToApi(row) : null },
    existing ? 200 : 201,
    cors
  );
}

async function softDeleteProject(
  id: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      'UPDATE root_projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    )
    .bind(now, now, id)
    .run();

  if (!result.meta.changes || result.meta.changes === 0) {
    return json({ ok: false, error: 'Project not found' }, 404, cors);
  }
  return json({ ok: true, data: { id, deletedAt: now } }, 200, cors);
}

// ===== Links 處理器 =====

async function listLinks(
  url: URL,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const conditions = ['deleted_at IS NULL'];
  const binds: string[] = [];

  const featured = url.searchParams.get('featured');
  if (featured === 'true') conditions.push('featured = 1');

  const category = url.searchParams.get('category');
  if (category) {
    conditions.push('category = ?');
    binds.push(category);
  }

  const includeDeleted = url.searchParams.get('include_deleted') === 'true';
  if (includeDeleted) conditions.shift();

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT * FROM root_links ${where} ORDER BY sort_order ASC, created_at DESC`;
  const stmt = db.prepare(query);
  const result =
    binds.length > 0
      ? await stmt.bind(...binds).all<RootLinkRow>()
      : await stmt.all<RootLinkRow>();

  return json(
    { ok: true, data: (result.results || []).map(linkRowToApi) },
    200,
    cors,
    true
  );
}

async function getLink(
  id: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const row = await db
    .prepare('SELECT * FROM root_links WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<RootLinkRow>();

  if (!row) return json({ ok: false, error: 'Link not found' }, 404, cors);
  return json({ ok: true, data: linkRowToApi(row) }, 200, cors, true);
}

async function upsertLink(
  id: string,
  body: UpsertRootLinkRequest,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const now = body.updatedAt || new Date().toISOString();
  const existing = await db
    .prepare('SELECT id FROM root_links WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();

  if (existing) {
    const sets: string[] = ['updated_at = ?'];
    const binds: (string | number | null)[] = [now];

    if (body.titleZh !== undefined) {
      sets.push('title_zh = ?');
      binds.push(body.titleZh);
    }
    if (body.titleEn !== undefined) {
      sets.push('title_en = ?');
      binds.push(body.titleEn);
    }
    if (body.descZh !== undefined) {
      sets.push('desc_zh = ?');
      binds.push(body.descZh);
    }
    if (body.descEn !== undefined) {
      sets.push('desc_en = ?');
      binds.push(body.descEn);
    }
    if (body.url !== undefined) {
      sets.push('url = ?');
      binds.push(body.url);
    }
    if (body.category !== undefined) {
      sets.push('category = ?');
      binds.push(body.category);
    }
    if (body.status !== undefined) {
      sets.push('status = ?');
      binds.push(body.status);
    }
    if (body.icon !== undefined) {
      sets.push('icon = ?');
      binds.push(body.icon);
    }
    if (body.featured !== undefined) {
      sets.push('featured = ?');
      binds.push(body.featured ? 1 : 0);
    }
    if (body.sortOrder !== undefined) {
      sets.push('sort_order = ?');
      binds.push(body.sortOrder);
    }

    sets.push('deleted_at = NULL');
    binds.push(id);
    await db
      .prepare(`UPDATE root_links SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO root_links
         (id, title_zh, title_en, desc_zh, desc_en, url, category, status,
          icon, featured, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        body.titleZh ?? '',
        body.titleEn ?? '',
        body.descZh ?? '',
        body.descEn ?? '',
        body.url ?? '',
        body.category ?? 'other',
        body.status ?? 'normal',
        body.icon ?? null,
        body.featured ? 1 : 0,
        body.sortOrder ?? 0,
        now,
        now
      )
      .run();
  }

  const row = await db
    .prepare('SELECT * FROM root_links WHERE id = ?')
    .bind(id)
    .first<RootLinkRow>();

  return json(
    { ok: true, data: row ? linkRowToApi(row) : null },
    existing ? 200 : 201,
    cors
  );
}

async function softDeleteLink(
  id: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      'UPDATE root_links SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    )
    .bind(now, now, id)
    .run();

  if (!result.meta.changes || result.meta.changes === 0) {
    return json({ ok: false, error: 'Link not found' }, 404, cors);
  }
  return json({ ok: true, data: { id, deletedAt: now } }, 200, cors);
}

// ===== Updates 處理器 =====

async function listUpdates(
  url: URL,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const conditions = ['deleted_at IS NULL'];
  const binds: (string | number)[] = [];

  const featured = url.searchParams.get('featured');
  if (featured === 'true') conditions.push('featured = 1');

  const category = url.searchParams.get('category');
  if (category) {
    conditions.push('category = ?');
    binds.push(category);
  }

  const includeDeleted = url.searchParams.get('include_deleted') === 'true';
  if (includeDeleted) conditions.shift();

  const limit = url.searchParams.get('limit');
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  let query = `SELECT * FROM root_updates ${where} ORDER BY date DESC, created_at DESC`;
  if (limit) {
    query += ` LIMIT ?`;
    binds.push(parseInt(limit, 10));
  }

  const stmt = db.prepare(query);
  const result =
    binds.length > 0
      ? await stmt.bind(...binds).all<RootUpdateRow>()
      : await stmt.all<RootUpdateRow>();

  return json(
    { ok: true, data: (result.results || []).map(updateRowToApi) },
    200,
    cors,
    true
  );
}

async function getUpdate(
  id: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const row = await db
    .prepare('SELECT * FROM root_updates WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<RootUpdateRow>();

  if (!row) return json({ ok: false, error: 'Update not found' }, 404, cors);
  return json({ ok: true, data: updateRowToApi(row) }, 200, cors, true);
}

async function upsertUpdate(
  id: string,
  body: UpsertRootUpdateRequest,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const now = body.updatedAt || new Date().toISOString();
  const existing = await db
    .prepare('SELECT id FROM root_updates WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();

  if (existing) {
    const sets: string[] = ['updated_at = ?'];
    const binds: (string | number | null)[] = [now];

    if (body.titleZh !== undefined) {
      sets.push('title_zh = ?');
      binds.push(body.titleZh);
    }
    if (body.titleEn !== undefined) {
      sets.push('title_en = ?');
      binds.push(body.titleEn);
    }
    if (body.descZh !== undefined) {
      sets.push('desc_zh = ?');
      binds.push(body.descZh);
    }
    if (body.descEn !== undefined) {
      sets.push('desc_en = ?');
      binds.push(body.descEn);
    }
    if (body.contentZh !== undefined) {
      sets.push('content_zh = ?');
      binds.push(body.contentZh);
    }
    if (body.contentEn !== undefined) {
      sets.push('content_en = ?');
      binds.push(body.contentEn);
    }
    if (body.date !== undefined) {
      sets.push('date = ?');
      binds.push(body.date);
    }
    if (body.category !== undefined) {
      sets.push('category = ?');
      binds.push(body.category);
    }
    if (body.featured !== undefined) {
      sets.push('featured = ?');
      binds.push(body.featured ? 1 : 0);
    }

    sets.push('deleted_at = NULL');
    binds.push(id);
    await db
      .prepare(`UPDATE root_updates SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
  } else {
    if (!body.date) {
      return json(
        { ok: false, error: 'date is required for new updates' },
        400,
        cors
      );
    }
    await db
      .prepare(
        `INSERT INTO root_updates
         (id, title_zh, title_en, desc_zh, desc_en, content_zh, content_en,
          date, category, featured, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        body.titleZh ?? '',
        body.titleEn ?? '',
        body.descZh ?? '',
        body.descEn ?? '',
        body.contentZh ?? '',
        body.contentEn ?? '',
        body.date,
        body.category ?? 'other',
        body.featured ? 1 : 0,
        now,
        now
      )
      .run();
  }

  const row = await db
    .prepare('SELECT * FROM root_updates WHERE id = ?')
    .bind(id)
    .first<RootUpdateRow>();

  return json(
    { ok: true, data: row ? updateRowToApi(row) : null },
    existing ? 200 : 201,
    cors
  );
}

async function softDeleteUpdate(
  id: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      'UPDATE root_updates SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    )
    .bind(now, now, id)
    .run();

  if (!result.meta.changes || result.meta.changes === 0) {
    return json({ ok: false, error: 'Update not found' }, 404, cors);
  }
  return json({ ok: true, data: { id, deletedAt: now } }, 200, cors);
}

// ===== Singletons 處理器 =====

async function getSingleton(
  key: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const row = await db
    .prepare('SELECT * FROM root_singletons WHERE section_id = ?')
    .bind(key)
    .first<RootSingletonRow>();

  if (!row) return json({ ok: false, error: 'Singleton not found' }, 404, cors);
  return json({ ok: true, data: singletonRowToApi(row) }, 200, cors, true);
}

async function upsertSingleton(
  key: string,
  body: { content: unknown; updatedAt?: string },
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  if (!body.content) {
    return json({ ok: false, error: 'content is required' }, 400, cors);
  }
  const now = body.updatedAt || new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO root_singletons (section_id, content, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(section_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
    )
    .bind(key, JSON.stringify(body.content), now)
    .run();

  return json(
    {
      ok: true,
      data: { sectionId: key, content: body.content, updatedAt: now },
    },
    200,
    cors
  );
}

// ===== Cards 處理器 =====

async function listCards(
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const result = await db
    .prepare('SELECT * FROM root_cards ORDER BY section_id ASC')
    .all<RootCardRow>();

  return json(
    { ok: true, data: (result.results || []).map(cardRowToApi) },
    200,
    cors,
    true
  );
}

async function getCard(
  key: string,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const row = await db
    .prepare('SELECT * FROM root_cards WHERE section_id = ?')
    .bind(key)
    .first<RootCardRow>();

  if (!row) return json({ ok: false, error: 'Card not found' }, 404, cors);
  return json({ ok: true, data: cardRowToApi(row) }, 200, cors, true);
}

async function upsertCard(
  key: string,
  body: { content: unknown; updatedAt?: string },
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  if (!body.content) {
    return json({ ok: false, error: 'content is required' }, 400, cors);
  }
  const now = body.updatedAt || new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO root_cards (section_id, content, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(section_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
    )
    .bind(key, JSON.stringify(body.content), now)
    .run();

  return json(
    {
      ok: true,
      data: { sectionId: key, content: body.content, updatedAt: now },
    },
    200,
    cors
  );
}

// ===== Root Assets 處理器（獨立 R2 bucket） =====

interface RootAssetItem {
  key: string;
  size: number;
  uploaded: string;
  contentType: string;
  originalName?: string;
}

async function listRootAssets(
  url: URL,
  bucket: R2Bucket,
  cors: Record<string, string>
): Promise<Response> {
  const prefix = url.searchParams.get('prefix') || undefined;
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || '200', 10) || 200,
    500
  );
  const cursor = url.searchParams.get('cursor') || undefined;

  const listed = await bucket.list({ prefix, limit, cursor });

  const items: RootAssetItem[] = listed.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
    contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
    originalName: obj.customMetadata?.originalName,
  }));

  return json(
    {
      ok: true,
      data: {
        items,
        cursor: listed.truncated ? listed.cursor : undefined,
        hasMore: listed.truncated,
      },
    },
    200,
    cors
  );
}

async function uploadRootAsset(
  request: Request,
  bucket: R2Bucket,
  cors: Record<string, string>
): Promise<Response> {
  const ALLOWED_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/avif',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'video/mp4',
    'video/webm',
    'application/pdf',
  ]);

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return json({ ok: false, error: 'No file provided' }, 400, cors);

  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_TYPES.has(contentType)) {
    return json(
      { ok: false, error: `不允許的檔案類型: ${contentType}` },
      400,
      cors
    );
  }
  const explicitKey = formData.get('key') as string | null;
  let key: string;
  if (explicitKey) {
    key = explicitKey;
  } else {
    const prefix = contentType.startsWith('image/') ? 'images' : 'files';
    const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
    const base = file.name.replace(/\.[^.]+$/, '');
    const suffix =
      Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    key = `${prefix}/${base}-${suffix}${ext}`;
  }

  await bucket.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  });

  return json(
    {
      ok: true,
      data: {
        key,
        url: `/api/root/assets/${key}`,
        name: file.name,
        size: file.size,
        type: file.type,
      },
    },
    201,
    cors
  );
}
