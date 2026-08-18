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
import {
  signJwt,
  verifyJwt,
  hashPassword,
  verifyPassword,
  requireJwt,
  requireJwtOrApiToken,
} from './auth';
import { extractAssetKeysFromContentBlock } from './assets';
import { buildConceptsBindingIndex } from './concepts-bindings';
import { buildConceptsEntityIndex } from './concepts-index';
import { buildEchoesEntityIndex } from './echoes-index';
import { buildVisualsEntityIndex } from './visuals-index';
import {
  extractCandidateKeys,
  findDuplicateCandidate,
  findKeyConflict,
  createKeyConflictChecker,
  ensureInterlinkKeys,
  rebuildHistoryInterlinkIndex,
  rebuildHistoryInterlinkIndexBatch,
  backfillHistoryInterlinkIndex,
  backfillInterlinkKeys,
  clearHistoryInterlinkIndex,
  findInterlinkAnchors,
  findInterlinkDefinitions,
  findInterlinkKeyMeta,
  findInterlinkKeyMetas,
  findStorySongsWithoutKey,
  listInterlinkKeys,
  updateInterlinkKeyMeta,
} from './interlink';
import type { FlagInput } from './flags';
import {
  auditFlags,
  createFlag,
  deleteFlag,
  ensureFlagsRegistered,
  findFlag,
  findFlagReferences,
  listFlags,
  updateFlag,
} from './flags';
import {
  applyFlagRename,
  planFlagRename,
  validateRenameTarget,
} from './flags-rename';
import {
  collectFlagsFromBody,
  scanRequiredFlags,
  validateFlagName,
} from './flags-scan';
import { listSettings, updateSettings } from './settings';
import type { KeyCandidate } from './interlink';
import { findEntitySong, findSongById } from './echoes-song';
import {
  findEntityGallery,
  findGalleryById,
  findGalleryByStoryKey,
} from './visuals-gallery';
import { handleRootRoutes } from './root-routes';
import { handleUepRoutes } from './uep-auth';
import { purgeExpiredThrottleBuckets } from './uep-throttle';
import { buildDiscordStats } from './widget-stats';
import {
  buildTestSeedSnapshot,
  isTestSeedSnapshot,
  resetAndSeedTestData,
  type TestSeedSnapshot,
} from './test-seed';

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
  corsHeaders: Record<string, string> = {},
  /** 設為 true 時加入 CDN 短快取，適用於公開 GET 回應 */
  cacheable = false
): Response {
  const headers: Record<string, string> = {
    ...corsHeaders,
    'Content-Type': 'application/json',
  };
  if (cacheable && status >= 200 && status < 300) {
    // CDN 快取 60 秒，用戶端 10 秒，背景重驗證最長 5 分鐘
    headers['Cache-Control'] =
      'public, s-maxage=60, max-age=10, stale-while-revalidate=300';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

/**
 * 反查端點的 `?keyType=` 解析（S10-1）。
 *
 * 未帶參數時回 `'entity'`——`entity-song` / `entity-gallery` 兩個端點在
 * storyKey 出現之前就只服務 entity 命名空間，維持既有呼叫端的語意。
 * 帶了但不合法時回 `null`，呼叫端一律 400：靜默退回預設會讓打錯字的
 * `keyType=stroy` 悄悄查成 entity，正是這個 blocker 要根除的模糊地帶。
 */
function parseLookupKeyType(url: URL): 'entity' | 'story' | null {
  const raw = url.searchParams.get('keyType')?.trim();
  if (!raw) return 'entity';
  return raw === 'entity' || raw === 'story' ? raw : null;
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
        'Content-Type, Authorization, Range, X-Progress-Rev';
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
      'Content-Type, Authorization, Range, X-Progress-Rev';
    return headers;
  }

  const allowedOrigins = env.ALLOWED_ORIGINS.split(',');

  const isAllowed = allowedOrigins.some((allowed) => {
    allowed = allowed.trim();
    if (allowed === origin) return true;
    const wildcard = /^([a-z]+:\/\/)\*\.(.+)$/i.exec(allowed);
    if (wildcard) {
      try {
        const parsedOrigin = new URL(origin);
        const domain = wildcard[2].toLowerCase();
        return (
          `${parsedOrigin.protocol}//` === wildcard[1].toLowerCase() &&
          (parsedOrigin.hostname.toLowerCase() === domain ||
            parsedOrigin.hostname.toLowerCase().endsWith(`.${domain}`))
        );
      } catch {
        return false;
      }
    }
    return false;
  });

  if (isAllowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] =
      'GET, HEAD, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] =
      'Content-Type, Authorization, Range, X-Progress-Rev';
  }

  return headers;
}

// ===== 驗證 =====

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const auth = request.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : auth;
  // CLI / sync 腳本用 API_TOKEN。
  if (env.API_TOKEN && token === env.API_TOKEN) return true;
  // 其餘一律真正驗證 admin JWT（與 assets 端點一致）：
  // 正式與 test worker 都設 JWT_SECRET → requireJwt 走本地 verifyJwt。
  // 本機 dev（無 JWT_SECRET 無 API_TOKEN）時 requireJwt 回 dev user → 放行。
  // ⚠️ 不再有「正式 worker 無 API_TOKEN 即全放行」的裸奔路徑。
  return (await requireJwt(request, env)) !== null;
}

async function clearR2Bucket(bucket: R2Bucket): Promise<number> {
  let cursor: string | undefined;
  let cleared = 0;
  do {
    const listed = await bucket.list({ cursor });
    const keys = listed.objects.map((object) => object.key);
    if (keys.length > 0) {
      await bucket.delete(keys);
      cleared += keys.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return cleared;
}

// ===== 路由處理 =====

/** GET /api/content/:area — 列出區域內所有頁面 */
const LIST_COLS =
  'id, area, title, slug, sort_order, status, source_file, parent_id, depth, page_type, updated_at, deleted_at';

async function listPages(
  area: string,
  db: D1Database,
  cors: Record<string, string>,
  includeDeleted = false
): Promise<Response> {
  const query = includeDeleted
    ? `SELECT ${LIST_COLS} FROM pages WHERE area = ? ORDER BY sort_order ASC`
    : `SELECT ${LIST_COLS} FROM pages WHERE area = ? AND deleted_at IS NULL ORDER BY sort_order ASC`;
  const result = await db.prepare(query).bind(area).all<PageRow>();

  const items: PageListItem[] = (result.results || []).map(rowToListItem);
  return jsonResponse({ ok: true, data: items }, 200, cors, true);
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

  return jsonResponse({ ok: true, data: rowToPage(row) }, 200, cors, true);
}

/**
 * PATCH /api/content/:area/:slug/metadata — 進度頁欄位的部分更新
 *
 * 給 /admin/settings 進度總覽的就地切換用：既有 PUT 是整頁覆寫，就地切一個
 * checkbox 得先抓整頁 content 回來再送回去，編輯器同時開著時還會用舊快照
 * 蓋掉未存檔內容。這裡只讀寫 metadata 的白名單鍵，完全不碰 content——
 * 也因此不觸發 rebuildHistoryInterlinkIndex（索引只認 content 內的錨點）。
 *
 * ⚠️ 白名單只有 progressPage／gateExempt。不可擴成通用 metadata patch：
 * gate、entityKey、storyKey 都有各自的驗證關卡（409 撞名、旗標註冊），
 * 開一條繞過它們的旁路等於把 S10-1 的把關廢掉。
 *
 * 值的形狀與編輯器 Inspector 一致（RichEditor 的 metadata 組裝）：
 * true 才寫入，false 一律刪鍵維持存檔精簡——兩處切同一頁不會產生
 * 不同的 metadata 形狀讓 sync 誤判差異。
 */
const METADATA_PATCH_KEYS = ['progressPage', 'gateExempt'] as const;

async function patchPageMetadata(
  area: string,
  slug: string,
  request: Request,
  db: D1Database,
  cors: Record<string, string>
): Promise<Response> {
  const id = `${area}/${slug}`;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400, cors);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse(
      { ok: false, error: 'Body must be a JSON object' },
      400,
      cors
    );
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return jsonResponse(
      { ok: false, error: 'No metadata keys to update' },
      400,
      cors
    );
  }
  const unknownKeys = keys.filter(
    (k) => !(METADATA_PATCH_KEYS as readonly string[]).includes(k)
  );
  if (unknownKeys.length > 0) {
    return jsonResponse(
      {
        ok: false,
        error: `Only ${METADATA_PATCH_KEYS.join(', ')} can be patched (got: ${unknownKeys.join(', ')})`,
      },
      400,
      cors
    );
  }
  for (const key of METADATA_PATCH_KEYS) {
    if (key in body && typeof body[key] !== 'boolean') {
      return jsonResponse(
        { ok: false, error: `${key} must be a boolean` },
        400,
        cors
      );
    }
  }

  const row = await db
    .prepare('SELECT metadata FROM pages WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<{ metadata: string }>();
  if (!row) {
    return jsonResponse({ ok: false, error: 'Page not found' }, 404, cors);
  }

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(row.metadata || '{}');
  } catch {
    metadata = {};
  }
  for (const key of METADATA_PATCH_KEYS) {
    if (!(key in body)) continue;
    if (body[key] === true) {
      metadata[key] = true;
    } else {
      delete metadata[key];
    }
  }

  // updated_at 一定要跟著動：sync 靠它比對方向，不動的話這筆變更
  // 永遠不會被推到另一端。status 比照既有 metadata-only PUT 慣例不動。
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE pages SET metadata = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(metadata), now, id)
    .run();

  return jsonResponse(
    { ok: true, data: { id, metadata, updatedAt: now } },
    200,
    cors
  );
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

  // ---- key 唯一性把關（S10-1 §3-2）----
  //
  // 這是唯一保證資料一致的關卡：編輯器前端也有即時提示與存檔前警告，
  // 但那兩層的 existingKeys 由呼叫端自行組裝，範圍可能不完整；只有這裡
  // 是對 D1 現況做的即時掃描。撞名一律 409，不靜默覆蓋——entityKey /
  // storyKey 撞名的後果是互聯連到錯的東西，遠比存檔失敗嚴重。
  const keyCandidates = extractCandidateKeys(area, body);

  // 先看這次送來的內容自己有沒有撞——同一頁塞兩個相同的 Concepts 條目
  // key 時，逐筆比對 DB 是看不出來的（excludePageId 排除的正是自己）。
  const duplicate = findDuplicateCandidate(keyCandidates);
  if (duplicate) {
    return jsonResponse(
      {
        ok: false,
        error: `${duplicate.field}「${duplicate.keyValue}」在這次存檔的內容裡出現了兩次`,
        conflict: {
          field: duplicate.field,
          key: duplicate.keyValue,
          conflictingPageId: id,
          conflictingPageTitle: body.title ?? id,
        },
      },
      409,
      cors
    );
  }

  for (const candidate of keyCandidates) {
    const conflict = await findKeyConflict(db, {
      keyType: candidate.keyType,
      keyValue: candidate.keyValue,
      area: area as 'concepts' | 'echoes' | 'visuals',
      scope: candidate.scope,
      excludePageId: id,
    });
    if (conflict) {
      return jsonResponse(
        {
          ok: false,
          error: `${candidate.field}「${candidate.keyValue}」已被「${conflict.pageTitle}」使用`,
          conflict: {
            field: candidate.field,
            key: candidate.keyValue,
            conflictingPageId: conflict.pageId,
            conflictingPageTitle: conflict.pageTitle,
          },
        },
        409,
        cors
      );
    }
  }

  // gate 需求端的旗標名只有在這裡擋得住。授予端的 `data-grants-flags` 是
  // 逗號分隔字串，掃描時已經拆開——`foo,bar` 到 worker 手上就是兩個合法
  // 名字，語意已經漂移完了，那一端只能靠編輯器在輸入時擋。需求端是 JSON
  // 陣列，壞名字原樣送達，放行等於在註冊表裡建一個永遠不會被授予的旗標。
  if (body.metadata !== undefined) {
    for (const flag of scanRequiredFlags(body.metadata)) {
      const invalid = validateFlagName(flag);
      if (invalid) {
        return jsonResponse(
          { ok: false, error: `${invalid}（gate 條件：「${flag}」）` },
          400,
          cors
        );
      }
    }
  }

  // 內容裡的自訂旗標自動補進註冊表（**不**擋存檔）。
  //
  // ⚠️ 這是 D-1「強制註冊」的反轉（艾斯維爾 2026-07-30 定案）。原設計要用
  // 409 換掉「授予端打錯一個字、需求端永遠等不到」的無聲失效，但：
  //
  // 1. **與 key 不一致**。`entityKey`／`storyKey` 走的是自由填 →
  //    `ensureInterlinkKeys` 存檔時建殼列 → 事後補說明。`EntityKeyField`
  //    的檔頭把理由寫死了：「entityKey 是語意資產，由設計者統一命名」。
  //    旗標沒有理由是唯一需要事前登記的識別碼。
  // 2. **typo 已經抓得到**。T-A3 的巡查會讓它留下很好認的指紋：打錯的那個
  //    被標 `no-demand`（有授予沒人要求）、正確的那個被標 `no-grant`（有
  //    要求沒地方授予），一組同時出現幾乎只有 typo 一種成因，`/admin/keys`
  //    直接撈得出來。事前擋的代價是每次都多一道手續。
  // 3. **事前擋會關掉 derived 旗標的需求端**。gate 想要求「聽過某首歌」
  //    （`{storyKey}:song`）時，那個旗標依設計不可註冊，於是永遠填不進去。
  //
  // derived 旗標一律豁免（名稱由程式依 key 推導，不進註冊表）。
  // 回應帶 `autoRegisteredFlags` 供 sync 腳本與 DevTools 追蹤，與批次匯入
  // 路徑同一個欄位名。
  const autoRegisteredFlags = await ensureFlagsRegistered(
    db,
    collectFlagsFromBody(body)
  );

  // 檢查是否已存在（包含已軟刪除的記錄）
  const existing = await db
    .prepare(
      'SELECT id, source_file, status, deleted_at, parent_id FROM pages WHERE id = ?'
    )
    .bind(id)
    .first<
      Pick<
        PageRow,
        'id' | 'source_file' | 'status' | 'deleted_at' | 'parent_id'
      >
    >();

  // 記住舊 parent_id，拖拽換 parent 時需要重排舊 parent 的兄弟
  const oldParentId = existing?.parent_id ?? undefined;

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

  // sort_order 或 parent_id 有變動時，重排同層兄弟的 sort_order（歸一化為 0, 1, 2...）
  if (body.sortOrder !== undefined || body.parentId !== undefined) {
    /** 重排指定 parent 底下所有子節點的 sort_order 為 0, 1, 2... */
    const reindexChildren = async (
      targetArea: string,
      parentId: string | null
    ) => {
      const q = parentId
        ? 'SELECT id FROM pages WHERE area = ? AND parent_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC'
        : 'SELECT id FROM pages WHERE area = ? AND parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC';
      const result = parentId
        ? await db.prepare(q).bind(targetArea, parentId).all<{ id: string }>()
        : await db.prepare(q).bind(targetArea).all<{ id: string }>();
      const rows = result.results || [];
      if (rows.length > 1) {
        const batch = rows.map((row, i) =>
          db
            .prepare('UPDATE pages SET sort_order = ? WHERE id = ?')
            .bind(i, row.id)
        );
        await db.batch(batch);
      }
    };

    const page = await db
      .prepare('SELECT parent_id, area FROM pages WHERE id = ?')
      .bind(id)
      .first<{ parent_id: string | null; area: string }>();
    if (page) {
      // 重排新 parent 的子節點
      await reindexChildren(page.area, page.parent_id);

      // 若 parent 有變（拖拽換層），也重排舊 parent 的子節點
      if (
        existing &&
        body.parentId !== undefined &&
        oldParentId !== undefined &&
        oldParentId !== page.parent_id
      ) {
        await reindexChildren(area, oldParentId);
      }
    }
  }

  // key 首次出現時建立 interlink_keys 殼列（S10-3 §2-2）
  await ensureInterlinkKeys(db, keyCandidates);

  // History 頁的三種互聯標記在內容寫入後重建反向索引。
  // 只在這次請求真的帶了 content 時重建——PUT 支援部分更新，
  // 沒帶 content 就代表內容沒動，重掃只會得到同一份結果。
  if (area === 'history' && body.content !== undefined) {
    await rebuildHistoryInterlinkIndex(db, id, body.content);
  }

  // 回傳更新後的頁面
  const updated = await db
    .prepare('SELECT * FROM pages WHERE id = ?')
    .bind(id)
    .first<PageRow>();
  return jsonResponse(
    {
      ok: true,
      data: updated ? rowToPage(updated) : null,
      // 只在真的有新增時才帶，避免每次存檔都多一個空陣列
      ...(autoRegisteredFlags.length > 0 ? { autoRegisteredFlags } : {}),
    },
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

  // 已刪除文章的錨點不該繼續出現在反查結果裡
  if (area === 'history') {
    await clearHistoryInterlinkIndex(db, id);
  }

  return jsonResponse({ ok: true }, 200, cors);
}

/**
 * 批次匯入時「同批已宣告」的 key 指紋。
 *
 * 帶 area 的理由：Echoes 與 Visuals 的 scope 都是固定的 `'zone'`，
 * 不帶 area 會讓兩個 zone 的同名 key 互相誤擋——而跨 zone 同名正是
 * 互聯的基礎（`xavier-colsono` 目前橫跨四處且全部合法）。
 * 分隔字元同 `findDuplicateCandidate`。
 */
function claimFingerprint(area: string, candidate: KeyCandidate): string {
  return [area, candidate.keyType, candidate.scope, candidate.keyValue].join(
    '|'
  );
}

/**
 * 匯入更新既有頁時的 metadata 合併（來源欄位覆蓋，其餘保留）。
 *
 * 不整份覆蓋的理由：D1 端有一批**只存在於資料庫**的手動欄位（icon、
 * gate、hidden、entityKey 等由編輯器維護者），markdown 來源不帶這些，
 * 整份覆蓋會把它們清光——`migrate-history --clean` 重置 metadata 的
 * 教訓已經寫進 CLAUDE.md。
 *
 * 也不能反過來完全不寫：唯一性檢查與 story point 殼列都是依 incoming
 * 求值的，寫入時卻沿用舊值的話，兩邊看的根本不是同一份資料。
 *
 * 淺層合併即可——metadata 是扁平結構為主，`gate` 這類物件欄位由單一
 * 來源整份維護，深層合併只會製造出兩邊各半的混血條件。
 * 壞 JSON 視為空物件（容錯優先，與各 index 掃描器一致）。
 */
function mergeImportMetadata(
  existingRaw: string | null,
  incoming: Record<string, unknown> | undefined
): Record<string, unknown> {
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(existingRaw || '{}') as unknown;
    if (parsed && typeof parsed === 'object') {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // 壞 JSON：當作沒有既有 metadata
  }
  if (!incoming) return existing;
  return { ...existing, ...incoming };
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

  // 批次查詢所有要匯入的頁面，避免 N+1 問題。
  // 一併取 metadata：更新既有頁時要與來源合併（見下方 mergeMetadata）。
  const existingMap = new Map<
    string,
    Pick<PageRow, 'id' | 'status' | 'base_content_hash' | 'metadata'>
  >();
  if (body.pages.length > 0) {
    // D1 支援最多 100 個 bind parameter，分批查詢
    const CHUNK_SIZE = 80;
    for (let i = 0; i < body.pages.length; i += CHUNK_SIZE) {
      const chunk = body.pages.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const result = await db
        .prepare(
          `SELECT id, status, base_content_hash, metadata FROM pages WHERE id IN (${placeholders})`
        )
        .bind(...chunk.map((p) => p.id))
        .all<
          Pick<PageRow, 'id' | 'status' | 'base_content_hash' | 'metadata'>
        >();
      for (const row of result.results || []) {
        existingMap.set(row.id, row);
      }
    }
  }

  // ---- S10 寫入契約（S10-1 修補）----
  //
  // 這個端點原本直接 INSERT/UPDATE，繞過 upsertPage 的三道關卡：撞名寫得
  // 進來、key 沒有 interlink_keys 殼列、History 反向索引不建也不更新。
  // 而 migrate-history / migrate-echoes / migrate-visuals / migrate-concepts
  // 全部走這裡——等於主要的內容寫入路徑完全沒有把關。
  //
  // 與單頁存檔的差別只有一處：撞名**不整批中止**。批次匯入一次幾百頁，
  // 為了一頁撞名讓其他頁全部退回無助於修資料；改為跳過該頁並列進
  // conflicts，由同步腳本呈現給使用者。
  interface PendingWrite {
    page: ImportPageRequest;
    kind: 'insert' | 'update';
    /** 實際會落地的 metadata（更新既有頁時是合併結果） */
    metadata: Record<string, unknown>;
    candidates: KeyCandidate[];
  }
  const pending: PendingWrite[] = [];
  const conflicts: {
    pageId: string;
    field: string;
    key: string;
    conflictingPageId: string;
  }[] = [];
  /** 本地已修改的頁：只更新來源 hash 供比對，內容不動 */
  const hashOnlyStmts: D1PreparedStatement[] = [];

  for (const page of body.pages) {
    const existing = existingMap.get(page.id);

    if (!existing) {
      // 新頁面：直接匯入
      const metadata = page.metadata || {};
      pending.push({
        page,
        kind: 'insert',
        metadata,
        candidates: extractCandidateKeys(page.area, {
          metadata,
          content: page.content,
        }),
      });
    } else if (existing.status === 'synced') {
      // 同步中的頁面：來源有變更時自動更新
      if (existing.base_content_hash !== page.contentHash) {
        const metadata = mergeImportMetadata(existing.metadata, page.metadata);
        pending.push({
          page,
          kind: 'update',
          metadata,
          // 候選必須從**實際會落地的** metadata 抽：拿 incoming 檢查卻寫入
          // 別的值，等於檢查了一個不存在的狀態——來源改了 key 時會回報
          // updated 但 D1 仍是舊值，並替不存在的 storyKey 建出孤兒殼列
          candidates: extractCandidateKeys(page.area, {
            metadata,
            content: page.content,
          }),
        });
      } else {
        skipped.push(page.id);
      }
    } else {
      // 已修改的頁面：不自動覆蓋，只更新 base hash 供比對。
      // 內容不進 DB，故不必檢查 key、也不重建索引。
      if (existing.base_content_hash !== page.contentHash) {
        // 標記來源有新版本（metadata 裡記錄）
        hashOnlyStmts.push(
          db
            .prepare(
              `UPDATE pages SET metadata = json_set(COALESCE(metadata, '{}'), '$.pendingSourceHash', ?), updated_at = ? WHERE id = ?`
            )
            .bind(page.contentHash, now, page.id)
        );
      }
      skipped.push(page.id);
    }
  }

  // ---- 唯一性把關：DB 現況 + 同一批之內 ----
  //
  // 檢查器預載索引後在記憶體比對——逐頁呼叫 findKeyConflict 會變成
  // O(頁數 × 全表掃描)。批次內部另用 claimed 補足：同批的新頁還不在
  // DB 快照裡，只靠檢查器兩頁互撞會雙雙放行。
  const checkAreas = new Set<'concepts' | 'echoes' | 'visuals'>();
  for (const entry of pending) {
    if (entry.candidates.length === 0) continue;
    checkAreas.add(entry.page.area as 'concepts' | 'echoes' | 'visuals');
  }

  const accepted: PendingWrite[] = [];
  const checker =
    checkAreas.size > 0 ? await createKeyConflictChecker(db, checkAreas) : null;
  /** 指紋 → 這一批中先宣告該 key 的頁 id */
  const claimed = new Map<string, string>();

  for (const entry of pending) {
    if (!checker || entry.candidates.length === 0) {
      accepted.push(entry);
      continue;
    }

    const record = (candidate: KeyCandidate, conflictingPageId: string) =>
      conflicts.push({
        pageId: entry.page.id,
        field: candidate.field,
        key: candidate.keyValue,
        conflictingPageId,
      });

    // 同一頁內部先撞（Concepts 一頁可巢狀出多個條目 key）
    const duplicate = findDuplicateCandidate(entry.candidates);
    if (duplicate) {
      record(duplicate, entry.page.id);
      continue;
    }

    let blocked = false;
    for (const candidate of entry.candidates) {
      // 指紋帶 area：Echoes 與 Visuals 的 scope 都是固定的 'zone'，
      // 不帶 area 會讓兩個 zone 的同名 key 互相誤擋
      const fingerprint = claimFingerprint(entry.page.area, candidate);
      const claimant = claimed.get(fingerprint);
      if (claimant) {
        record(candidate, claimant);
        blocked = true;
        break;
      }
      const conflict = await checker.find({
        keyType: candidate.keyType,
        keyValue: candidate.keyValue,
        area: entry.page.area as 'concepts' | 'echoes' | 'visuals',
        scope: candidate.scope,
        excludePageId: entry.page.id,
      });
      if (conflict) {
        record(candidate, conflict.pageId);
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    for (const candidate of entry.candidates) {
      claimed.set(claimFingerprint(entry.page.area, candidate), entry.page.id);
    }
    accepted.push(entry);
  }

  // ---- 通過把關的才組寫入語句 ----
  const insertStmts: D1PreparedStatement[] = [];
  const updateStmts: D1PreparedStatement[] = [];
  for (const entry of accepted) {
    const page = entry.page;
    if (entry.kind === 'insert') {
      insertStmts.push(
        db
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
            JSON.stringify(entry.metadata),
            page.parentId || null,
            page.depth || 0,
            page.pageType || 'page',
            now,
            now
          )
      );
      imported.push(page.id);
    } else {
      updateStmts.push(
        db
          .prepare(
            `UPDATE pages SET title = ?, content = ?, base_content_hash = ?, source_file = ?, metadata = ?, updated_at = ? WHERE id = ?`
          )
          .bind(
            page.title,
            JSON.stringify(page.content),
            page.contentHash,
            page.sourceFile,
            JSON.stringify(entry.metadata),
            now,
            page.id
          )
      );
      updated.push(page.id);
    }
  }

  // 批次執行所有 INSERT 和 UPDATE
  const allStmts = [...insertStmts, ...updateStmts, ...hashOnlyStmts];
  if (allStmts.length > 0) {
    await db.batch(allStmts);
  }

  // ---- 後置動作：與 upsertPage 同一組（S10-1 §2-4 / §4）----
  // key 殼列先於索引重建，順序與單頁存檔一致
  await ensureInterlinkKeys(
    db,
    accepted.flatMap((entry) => entry.candidates)
  );

  // 旗標在這條路徑是**自動註冊**而非 409 擋下——與單頁存檔刻意不同。
  // 匯入的頁面帶著內容裡的旗標先到，註冊表由 `syncFlags` 另外一輪才搬
  // （順序不保證），一擋就是整個同步流程卡死；而且擋下來也不會讓資料
  // 變乾淨——旗標已經在內容裡了。
  // 代價是打錯字的旗標會靜默進表，所以新增清單一定要回報出去。
  const autoRegisteredFlags = await ensureFlagsRegistered(
    db,
    accepted.flatMap((entry) =>
      collectFlagsFromBody({
        content: entry.page.content,
        metadata: entry.metadata,
      })
    )
  );

  // History 頁的三種互聯標記在內容寫入後重建反向索引。批次版只是把
  // 往返次數收斂，DELETE+INSERT 的語意與冪等性與單頁完全相同。
  const historyWrites = accepted
    .filter((entry) => entry.page.area === 'history')
    .map((entry) => ({ pageId: entry.page.id, content: entry.page.content }));
  if (historyWrites.length > 0) {
    await rebuildHistoryInterlinkIndexBatch(db, historyWrites);
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
        conflicts: conflicts.length,
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
        // 撞名被擋下的頁面必須明確回報——靜默跳過會讓同步腳本顯示
        // 「成功」，而那幾頁其實從來沒有寫進去
        conflicts: conflicts.length,
        details: { imported, updated, skipped, conflicts },
        // 自動註冊的旗標一定要回報：這條路徑不擋未註冊旗標，操作者需要
        // 看得到自己多了哪些不認識的名字（打錯字就是這樣現形的）
        ...(autoRegisteredFlags.length > 0 ? { autoRegisteredFlags } : {}),
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
    // 與使用者不存在的回應時間一致，防止 timing 攻擊
    await new Promise((r) => setTimeout(r, 200));
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

  // 掃描有內容的頁面 content，找出資產引用（排除空陣列以減少掃描量）
  const contentRows = await db
    .prepare(
      "SELECT id, content FROM pages WHERE content IS NOT NULL AND content != '[]'"
    )
    .all<{ id: string; content: string }>();

  for (const row of contentRows.results || []) {
    try {
      const blocks = JSON.parse(row.content || '[]');
      for (const block of blocks) {
        for (const key of extractAssetKeysFromContentBlock(block)) {
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

// ===== 定期維護邏輯 =====

const MAINTENANCE_AREAS = [
  'history',
  'echoes',
  'visuals',
  'concepts',
  'storage',
  'portal',
];

/** 每日定期維護：重排 sort_order + 清理過期軟刪除 */
async function runScheduledMaintenance(env: Env): Promise<void> {
  const db = env.CONTENT_DB;
  const log: string[] = [];

  // ── 1. 全區域 sort_order 歸一化 ──
  for (const area of MAINTENANCE_AREAS) {
    // 取得該區域所有 distinct parent_id
    const parents = await db
      .prepare(
        `SELECT DISTINCT parent_id FROM pages WHERE area = ? AND deleted_at IS NULL`
      )
      .bind(area)
      .all<{ parent_id: string | null }>();

    const parentIds = (parents.results || []).map((r) => r.parent_id);
    // 額外加入 null（根層級）
    const uniqueParents = [...new Set([null, ...parentIds])];

    let reindexed = 0;
    for (const pid of uniqueParents) {
      // 一次查出 id + sort_order，同時用於判斷和重排
      const query = pid
        ? 'SELECT id, sort_order FROM pages WHERE area = ? AND parent_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC'
        : 'SELECT id, sort_order FROM pages WHERE area = ? AND parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC';
      const result = pid
        ? await db
            .prepare(query)
            .bind(area, pid)
            .all<{ id: string; sort_order: number }>()
        : await db
            .prepare(query)
            .bind(area)
            .all<{ id: string; sort_order: number }>();
      const rows = result.results || [];
      if (rows.length <= 1) continue;

      // 檢查是否已經是連續的 0, 1, 2...（避免無意義的寫入）
      const needsReindex = rows.some((r, i) => r.sort_order !== i);
      if (!needsReindex) continue;

      const batch = rows.map((row, i) =>
        db
          .prepare('UPDATE pages SET sort_order = ? WHERE id = ?')
          .bind(i, row.id)
      );
      await db.batch(batch);
      reindexed++;
    }
    if (reindexed > 0) {
      log.push(`[${area}] 重排 ${reindexed} 組 sort_order`);
    }
  }

  // ── 2. 清理超過 30 天的軟刪除記錄 ──
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const purgeResult = await db
    .prepare(
      'DELETE FROM pages WHERE deleted_at IS NOT NULL AND deleted_at < ?'
    )
    .bind(cutoff)
    .run();
  const purged = purgeResult.meta?.changes ?? 0;
  if (purged > 0) {
    log.push(`清理 ${purged} 筆過期軟刪除`);
  }

  // ── 3. 清理過期的 R2 資產刪除紀錄 ──
  try {
    const assetPurge = await db
      .prepare('DELETE FROM deleted_assets WHERE deleted_at < ?')
      .bind(cutoff)
      .run();
    const assetPurged = assetPurge.meta?.changes ?? 0;
    if (assetPurged > 0) {
      log.push(`清理 ${assetPurged} 筆過期 R2 刪除紀錄`);
    }
  } catch {
    // deleted_assets 表不存在則忽略
  }

  // ── 4. 清理過期的認證節流桶 ──
  const throttlePurged = await purgeExpiredThrottleBuckets(env);
  if (throttlePurged > 0) {
    log.push(`清理 ${throttlePurged} 筆過期節流紀錄`);
  }

  if (log.length > 0) {
    console.log(`[cron] 維護完成: ${log.join('; ')}`);
  } else {
    console.log('[cron] 維護完成: 無需變更');
  }
}

// ===== Worker 入口 =====

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx?: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const cors = getCorsHeaders(request, env);

    // OPTIONS 預檢
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const path = url.pathname;

    // ---- UEP 讀者路由（/api/uep/*，含公開的註冊/登入，必須在 API_TOKEN guard 之前） ----
    const uepResponse = await handleUepRoutes(
      path,
      request.method,
      request,
      env,
      cors
    );
    if (uepResponse) return uepResponse;

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
      const jwtUser = await requireJwtOrApiToken(request, env);
      if (!jwtUser) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      return listAssets(url, env.ASSETS_BUCKET, env.CONTENT_DB, cors);
    }

    // DELETE /api/assets/batch — 批次刪除（必須在 assetMatch regex 之前）
    if (path === '/api/assets/batch' && request.method === 'DELETE') {
      const jwtUser = await requireJwtOrApiToken(request, env);
      if (!jwtUser) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const body = (await request.json()) as BatchDeleteRequest;
      return batchDeleteAssets(body, env.ASSETS_BUCKET, env.CONTENT_DB, cors);
    }

    // GET /api/assets/deleted — 列出已刪除的資產紀錄（同步用，需認證）
    if (path === '/api/assets/deleted' && request.method === 'GET') {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
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
      const jwtUser = await requireJwtOrApiToken(request, env);
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
      const jwtUser = await requireJwtOrApiToken(request, env);
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
      const jwtUser = await requireJwtOrApiToken(request, env);
      if (!jwtUser) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const body = (await request.json()) as { oldKey: string; newKey: string };
      return renameAsset(body, env.ASSETS_BUCKET, env.CONTENT_DB, cors);
    }

    // DELETE /api/assets/:key — 單筆刪除（JWT 保護，與批次刪除一致）
    const assetDeleteMatch = path.match(/^\/api\/assets\/(.+)$/);
    if (assetDeleteMatch && request.method === 'DELETE') {
      const jwtUser = await requireJwtOrApiToken(request, env);
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
    const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(
      request.method
    );

    if (isWriteMethod && !(await isAuthorized(request, env))) {
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

    // POST /api/interlink/reindex — 補建衍生表（history_interlink_index
    // 與 interlink_keys）
    //
    // migration 只建了空表，套用後既有文章的錨點一筆都查不到，觸發模型
    // 對所有舊內容靜默失效；既有的 key 也不會有 interlink_keys 殼列
    // （殼列平常只在存檔路徑建立），管理 UI 會無列可更新。
    // 兩者都不能寫進 SQL migration：錨點藏在 content 的 TipTap JSON 裡、
    // key 藏在 metadata JSON 裡，都要逐頁解析。
    // 冪等（整頁 DELETE+INSERT／INSERT OR IGNORE），可重複執行。
    if (path === '/api/interlink/reindex' && request.method === 'POST') {
      const index = await backfillHistoryInterlinkIndex(env.CONTENT_DB);
      const keys = await backfillInterlinkKeys(env.CONTENT_DB);
      return jsonResponse({ ok: true, data: { ...index, ...keys } }, 200, cors);
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
      return jsonResponse({ ok: true, data: items }, 200, cors, true);
    }

    // ---- 樹狀結構路由 ----
    const treeMatch = path.match(/^\/api\/content\/([a-z]+)\/tree$/);
    if (treeMatch && request.method === 'GET') {
      const area = treeMatch[1];
      const treeIncludeDeleted =
        url.searchParams.get('include_deleted') === 'true';
      const treeQuery = treeIncludeDeleted
        ? `SELECT ${LIST_COLS}, metadata FROM pages WHERE area = ? ORDER BY sort_order ASC`
        : `SELECT ${LIST_COLS}, metadata FROM pages WHERE area = ? AND deleted_at IS NULL ORDER BY sort_order ASC`;
      const result = await env.CONTENT_DB.prepare(treeQuery)
        .bind(area)
        .all<PageRow>();
      const rows = result.results || [];
      const items = rows.map((r) => ({
        ...rowToListItem(r),
        metadata: JSON.parse(r.metadata || '{}'),
      }));
      const tree = buildTree(items);
      return jsonResponse({ ok: true, data: tree }, 200, cors, true);
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

      // DELETE 已由上方 assetDeleteMatch（帶 JWT 驗證）處理，這裡不重複
    }

    if (path === '/api/assets' && request.method === 'POST') {
      // JWT 驗證：上傳檔案需要管理員權限
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
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

    // ---- Concepts 條目索引（S7-C Terminal Island 消費）----
    // 獨立前綴 /api/concepts/*，刻意不走 /api/content/（會被下方
    // contentMatch regex 當成 area=concepts, slug=entity-index 吃掉）。
    // 公開 GET（與內容讀取端點同級），CDN 短快取。
    if (path === '/api/concepts/entity-index' && request.method === 'GET') {
      const entries = await buildConceptsEntityIndex(env.CONTENT_DB);
      return jsonResponse(
        { ok: true, data: { entries, generatedAt: new Date().toISOString() } },
        200,
        cors,
        true
      );
    }

    // ---- entity 一對多綁定登記（2026-08-15 定案）----
    // ⚠️ **admin only，且刻意不做 CDN 快取**：回應內容是 revision patch 裡的
    // 綁定指向，也就是尚未解鎖內容的 page id（slug 即歌名／畫廊名）——
    // 公開等同劇透，這與同檔上方 entity-index 的 revisionGates 只帶 id+gate
    // 是同一個理由。編輯器（唯一性放寬、綁定 picker）是唯一消費端。
    if (path === '/api/concepts/bound-keys' && request.method === 'GET') {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const index = await buildConceptsBindingIndex(env.CONTENT_DB);
      // Map 不能直接 JSON 化——轉成純物件（空索引回 {}，不是 404：
      // 「查得到但沒有任何登記」與「端點不存在」是不同的事）
      const bound: Record<
        string,
        { echoesIds: string[]; visualsIds: string[] }
      > = {};
      for (const [key, value] of index) bound[key] = value;
      return jsonResponse({ ok: true, data: { bound } }, 200, cors);
    }

    // ---- 跨區互聯反查（S10-1）----
    // anchors：某個 key 在 History 有哪些錨點（觸發模型消費）
    // usage：定義端 + 錨點端的完整使用狀況（S10-3 反查管理 UI）
    if (
      (path === '/api/interlink/anchors' || path === '/api/interlink/usage') &&
      request.method === 'GET'
    ) {
      const keyType = url.searchParams.get('keyType')?.trim() ?? '';
      const key = url.searchParams.get('key')?.trim() ?? '';
      if (keyType !== 'entity' && keyType !== 'story') {
        return jsonResponse(
          { ok: false, error: 'keyType must be entity or story' },
          400,
          cors
        );
      }
      if (!key) {
        return jsonResponse({ ok: false, error: 'Missing key' }, 400, cors);
      }

      const anchors = await findInterlinkAnchors(env.CONTENT_DB, keyType, key);
      if (path === '/api/interlink/anchors') {
        return jsonResponse({ ok: true, data: { anchors } }, 200, cors, true);
      }

      // usage 是 admin 反查 UI 的資料：`findInterlinkDefinitions`
      // 刻意 includeHidden（管理者要看到全部使用位置），並帶出 key 的
      // 標題／說明。公開等同把未公開內容的頁 id、標題與劇情點名稱
      // 全部送出去，而且 CDN 一快取就攔不回來。
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }

      const definitions = await findInterlinkDefinitions(
        env.CONTENT_DB,
        keyType,
        key
      );
      // 兩種 keyType 都可能有殼列——entity 的 title 恆為 NULL
      // （權威名稱在 Concepts dossier），description 才是它的可編輯欄位
      const keyMeta = await findInterlinkKeyMeta(env.CONTENT_DB, keyType, key);
      return jsonResponse(
        {
          ok: true,
          data: {
            definitions,
            anchors,
            ...(keyMeta ? { keyMeta } : {}),
          },
        },
        200,
        // 授權後的回應絕不進共用快取——同一個 URL 對不同身分的可見範圍
        // 不同，CDN 命中會把管理者的結果原封不動回給下一個訪客
        { ...cors, 'Cache-Control': 'private, no-store' }
      );
    }

    // ---- key 的標題／說明 ----
    //
    // ⚠️ `/keys/public` 必須排在 `/keys/:type/:value` 之前：後者的
    // 正規式會把 `public` 當成 keyType 段吃掉。
    if (path === '/api/interlink/keys/public' && request.method === 'GET') {
      const keyType = url.searchParams.get('keyType')?.trim() ?? '';
      const key = url.searchParams.get('key')?.trim() ?? '';
      if (keyType !== 'entity' && keyType !== 'story') {
        return jsonResponse(
          { ok: false, error: 'keyType must be entity or story' },
          400,
          cors
        );
      }
      // 批次模式：`?keys=a,b,c` 一次取多把。Echoes 收藏池一頁可能有數十首
      // 劇情歌，逐首查會對同一個端點掃射（entity tooltip 就是這樣被拆掉的）。
      // 單把的 `?key=` 維持原樣，兩者不可同時給——回應形狀不同。
      const rawKeys = url.searchParams.get('keys');
      if (rawKeys !== null) {
        if (key) {
          return jsonResponse(
            { ok: false, error: 'key 與 keys 不可同時使用' },
            400,
            cors
          );
        }
        const keys = [
          ...new Set(
            rawKeys
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean)
          ),
        ];
        if (keys.length === 0) {
          return jsonResponse({ ok: false, error: 'Missing key' }, 400, cors);
        }
        // 上限保護：一頁的劇情歌不會有這麼多，超過就是被當成掃描端點在用
        if (keys.length > 100) {
          return jsonResponse(
            { ok: false, error: 'keys 一次最多 100 把' },
            400,
            cors
          );
        }
        const metas = await findInterlinkKeyMetas(
          env.CONTENT_DB,
          keyType,
          keys
        );
        return jsonResponse(
          { ok: true, data: { keyMetas: metas } },
          200,
          cors,
          true
        );
      }

      if (!key) {
        return jsonResponse({ ok: false, error: 'Missing key' }, 400, cors);
      }

      // 公開端點刻意只回標題／說明。definitions 與 anchors 含未公開
      // 內容的頁 id 與標題，那是 usage（admin only）的範圍。
      // 前台觸發一律是匿名 fetch，這裡不可加 isAuthorized。
      const keyMeta = await findInterlinkKeyMeta(env.CONTENT_DB, keyType, key);
      return jsonResponse(
        { ok: true, data: { keyMeta: keyMeta ?? null } },
        200,
        cors,
        true
      );
    }

    // ---- History 錨點的逐頁彙總（/admin/settings 進度總覽的標記欄）----
    //
    // per-key 的 usage 端點回答「這個 key 用在哪」，這裡回答「這一頁
    // 有幾個標記」——同一張表的兩個查詢面。progress marker 不進
    // history_interlink_index（那張表只管互聯三種標記），marker 計數由
    // 前端從 /api/flags/audit 的 grantedBy 聚合。
    if (path === '/api/interlink/anchors-summary' && request.method === 'GET') {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const { results } = await env.CONTENT_DB.prepare(
        `SELECT page_id, anchor_kind, COUNT(*) AS n
         FROM history_interlink_index
         GROUP BY page_id, anchor_kind`
      ).all<{ page_id: string; anchor_kind: string; n: number }>();
      const pages: Record<string, Record<string, number>> = {};
      for (const row of results || []) {
        (pages[row.page_id] ??= {})[row.anchor_kind] = row.n;
      }
      return jsonResponse({ ok: true, data: { pages } }, 200, {
        ...cors,
        'Cache-Control': 'private, no-store',
      });
    }

    if (path === '/api/interlink/keys' && request.method === 'GET') {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      // storySongsWithoutKey 是巡查附帶資料（劇情歌漏綁 storyKey 的頁不會
      // 進 keys 清單——無 key 的頁被 index 建構器跳過，只能在這裡另掃）
      const [keys, storySongsWithoutKey] = await Promise.all([
        listInterlinkKeys(env.CONTENT_DB),
        findStorySongsWithoutKey(env.CONTENT_DB),
      ]);
      return jsonResponse(
        { ok: true, data: { keys, storySongsWithoutKey } },
        200,
        {
          ...cors,
          'Cache-Control': 'private, no-store',
        }
      );
    }

    const keyMetaMatch = path.match(
      /^\/api\/interlink\/keys\/(entity|story)\/(.+)$/
    );
    if (keyMetaMatch && request.method === 'PUT') {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const keyType = keyMetaMatch[1] as 'entity' | 'story';
      const keyValue = decodeURIComponent(keyMetaMatch[2]).trim();
      if (!keyValue) {
        return jsonResponse({ ok: false, error: 'Missing key' }, 400, cors);
      }

      let body: { title?: unknown; description?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400, cors);
      }

      const keyMeta = await updateInterlinkKeyMeta(
        env.CONTENT_DB,
        keyType,
        keyValue,
        body
      );
      return jsonResponse({ ok: true, data: { keyMeta } }, 200, cors);
    }

    // ---- 自訂旗標註冊表 ----
    //
    // ---- 站台行為設定（S10-3b T-B3）----
    //
    // /public 是前台 DesignLayout 掛載時的匿名讀取，不可加 isAuthorized
    // （同 /api/interlink/keys/public 的地雷）。刻意不做 CDN 快取——
    // 調整開關要在下一次頁面載入就生效，前台已有 sessionStorage 一層。
    if (path === '/api/settings/public' && request.method === 'GET') {
      const settings = await listSettings(env.CONTENT_DB);
      return jsonResponse({ ok: true, data: { settings } }, 200, cors);
    }

    if (path === '/api/settings') {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const privateCors = { ...cors, 'Cache-Control': 'private, no-store' };

      if (request.method === 'GET') {
        const settings = await listSettings(env.CONTENT_DB);
        return jsonResponse({ ok: true, data: { settings } }, 200, privateCors);
      }

      if (request.method === 'PUT') {
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400, cors);
        }
        const result = await updateSettings(env.CONTENT_DB, body);
        if (!result.ok) {
          return jsonResponse({ ok: false, error: result.error }, 400, cors);
        }
        return jsonResponse(
          { ok: true, data: { settings: result.settings } },
          200,
          privateCors
        );
      }

      return jsonResponse(
        { ok: false, error: 'Method not allowed' },
        405,
        cors
      );
    }

    // 全段 admin only：旗標名稱本身會洩漏尚未公開的劇情結構
    // （旗標命名慣例就是劇情事件名）。
    //
    // ⚠️ `/flags/audit` 必須排在 `/flags/:name` 之前，否則會被當成
    // 名為 `audit` 的旗標。
    if (path.startsWith('/api/flags')) {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const privateCors = { ...cors, 'Cache-Control': 'private, no-store' };

      if (path === '/api/flags/audit' && request.method === 'GET') {
        const flags = await auditFlags(env.CONTENT_DB);
        return jsonResponse({ ok: true, data: { flags } }, 200, privateCors);
      }

      if (path === '/api/flags' && request.method === 'GET') {
        const category = url.searchParams.get('category')?.trim() || null;
        // 墓碑只給 `pnpm sync` 看——它要靠 deleted_at 才分得出「被刪了」
        // 與「還沒同步過來」。管理 UI 與 picker 一律拿活著的列
        const includeDeleted =
          url.searchParams.get('include_deleted') === 'true';
        const flags = await listFlags(env.CONTENT_DB, category, includeDeleted);
        return jsonResponse({ ok: true, data: { flags } }, 200, privateCors);
      }

      if (path === '/api/flags' && request.method === 'POST') {
        let body: { name?: unknown } & FlagInput;
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400, cors);
        }
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        // 與改名、存檔共用同一份字元規則——這裡放行含逗號的名字，序列化
        // 之後就會裂成兩個旗標，而 UI 上看起來仍是一個
        const invalidName = validateFlagName(name);
        if (invalidName) {
          return jsonResponse({ ok: false, error: invalidName }, 400, cors);
        }

        const created = await createFlag(env.CONTENT_DB, name, body);
        if (created === 'derived') {
          return jsonResponse(
            {
              ok: false,
              error:
                '這是規則生成的旗標形狀，由程式依 key 推導，不需要也不能註冊',
            },
            400,
            cors
          );
        }
        if (created === null) {
          return jsonResponse(
            { ok: false, error: '旗標已存在', data: { name } },
            409,
            cors
          );
        }
        return jsonResponse({ ok: true, data: { flag: created } }, 201, cors);
      }

      // ⚠️ 必須排在 flagMatch 之前：那條正規式的 `(.+)` 會把
      // `xxx/rename` 整段當成旗標名，而它只列 PUT/DELETE，POST 會直接
      // 掉出整個 /api/flags 區塊變成 404（同 /flags/audit 的道理）
      const renameMatch = path.match(/^\/api\/flags\/(.+)\/rename$/);
      if (renameMatch && request.method === 'POST') {
        const from = decodeURIComponent(renameMatch[1]).trim();
        let body: { to?: unknown; dryRun?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400, cors);
        }
        const to = typeof body.to === 'string' ? body.to.trim() : '';

        const invalid = validateRenameTarget(to);
        if (invalid) {
          return jsonResponse({ ok: false, error: invalid }, 400, cors);
        }
        if (from === to) {
          return jsonResponse({ ok: false, error: '新舊名稱相同' }, 400, cors);
        }
        // 改名的對象是註冊列本身；derived 旗標不入表，自然也改不了
        if (!(await findFlag(env.CONTENT_DB, from))) {
          return jsonResponse(
            { ok: false, error: '旗標不存在於註冊表' },
            404,
            cors
          );
        }
        // 合併兩個既有旗標的語意不明（誰的說明留下？），一律拒絕
        if (await findFlag(env.CONTENT_DB, to)) {
          return jsonResponse(
            { ok: false, error: '新名稱已被註冊，請先處理該旗標' },
            409,
            cors
          );
        }

        let plan;
        try {
          plan = await planFlagRename(env.CONTENT_DB, from, to);
        } catch (error) {
          // renameFlagInContent 的結構保險擋下來的情況
          return jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : '改名計畫失敗',
            },
            500,
            cors
          );
        }

        const dryRun = body.dryRun === true;
        const written = dryRun
          ? 0
          : await applyFlagRename(env.CONTENT_DB, plan, from, to);

        return jsonResponse(
          {
            ok: true,
            data: {
              from,
              to,
              dryRun,
              pages: plan.pages,
              totalHits: plan.totalHits,
              written,
            },
          },
          200,
          cors
        );
      }

      const flagMatch = path.match(/^\/api\/flags\/(.+)$/);
      if (flagMatch) {
        const name = decodeURIComponent(flagMatch[1]).trim();

        if (request.method === 'PUT') {
          let body: FlagInput;
          try {
            body = (await request.json()) as FlagInput;
          } catch {
            return jsonResponse(
              { ok: false, error: 'Invalid JSON' },
              400,
              cors
            );
          }
          const updated = await updateFlag(env.CONTENT_DB, name, body);
          if (!updated) {
            return jsonResponse({ ok: false, error: '旗標不存在' }, 404, cors);
          }
          return jsonResponse({ ok: true, data: { flag: updated } }, 200, cors);
        }

        if (request.method === 'DELETE') {
          // 預設擋有引用的旗標：刪掉註冊列不會動內容，內容裡的旗標會
          // 變成「未註冊」而在下次存檔時被 409 擋住——那時候人已經不在
          // 這個頁面上了，錯誤訊息會出現在完全無關的操作裡
          const force = url.searchParams.get('force') === 'true';
          if (!force) {
            const refs = await findFlagReferences(env.CONTENT_DB, name);
            const total = refs.grantedBy.length + refs.requiredBy.length;
            if (total > 0) {
              return jsonResponse(
                {
                  ok: false,
                  error: `旗標仍被 ${total} 處引用，加 ?force=true 可強制刪除註冊`,
                  data: { references: refs },
                },
                409,
                cors
              );
            }
          }
          const deleted = await deleteFlag(env.CONTENT_DB, name);
          if (!deleted) {
            return jsonResponse({ ok: false, error: '旗標不存在' }, 404, cors);
          }
          return jsonResponse({ ok: true, data: { name } }, 200, cors);
        }
      }
    }

    // ---- Echoes 條目索引（S8 驗收 #2：互動嵌入跨島聯集啟用判定）----
    // 同 concepts/entity-index：獨立前綴避開 contentMatch regex，公開 GET + CDN 短快取。
    if (path === '/api/echoes/entity-index' && request.method === 'GET') {
      const entries = await buildEchoesEntityIndex(env.CONTENT_DB);
      return jsonResponse(
        { ok: true, data: { entries, generatedAt: new Date().toISOString() } },
        200,
        cors,
        true
      );
    }

    // ---- Echoes entity↔曲目反查（S8 B-5：互動嵌入的曲目卡消費）----
    // 同 entity-index：獨立前綴避開 contentMatch regex，公開 GET + CDN 短快取。
    if (path === '/api/echoes/entity-song' && request.method === 'GET') {
      const key = url.searchParams.get('key')?.trim() ?? '';
      if (!key) {
        return jsonResponse(
          { ok: false, error: 'Missing key parameter' },
          400,
          cors
        );
      }
      // keyType 決定查哪一套命名空間；未帶時維持端點原本的語意（entity）。
      // 不接受「兩套一起查」——見 findEntitySong 的說明。
      const keyType = parseLookupKeyType(url);
      if (!keyType) {
        return jsonResponse(
          { ok: false, error: 'keyType must be entity or story' },
          400,
          cors
        );
      }
      const song = await findEntitySong(env.CONTENT_DB, key, keyType);
      return jsonResponse(
        { ok: true, data: song ? { found: true, song } : { found: false } },
        200,
        cors,
        true
      );
    }

    // ---- Echoes 曲目 by-id 反查（echo spot 觸發時刷新過期快照）----
    if (path === '/api/echoes/song' && request.method === 'GET') {
      const id = url.searchParams.get('id')?.trim() ?? '';
      if (!id) {
        return jsonResponse(
          { ok: false, error: 'Missing id parameter' },
          400,
          cors
        );
      }
      const song = await findSongById(env.CONTENT_DB, id);
      return jsonResponse(
        { ok: true, data: song ? { found: true, song } : { found: false } },
        200,
        cors,
        true
      );
    }

    // ---- Visuals 條目索引（S8 驗收 #2：互動嵌入跨島聯集啟用判定）----
    // 同 concepts/entity-index：獨立前綴避開 contentMatch regex，公開 GET + CDN 短快取。
    if (path === '/api/visuals/entity-index' && request.method === 'GET') {
      const entries = await buildVisualsEntityIndex(env.CONTENT_DB);
      return jsonResponse(
        { ok: true, data: { entries, generatedAt: new Date().toISOString() } },
        200,
        cors,
        true
      );
    }

    // ---- Visuals entity↔gallery 反查（S8 下半場 V-A.13：浮動幻影提示卡消費）----
    // 同 echoes-song：獨立前綴避開 contentMatch regex，公開 GET + CDN 短快取。
    if (path === '/api/visuals/entity-gallery' && request.method === 'GET') {
      const key = url.searchParams.get('key')?.trim() ?? '';
      if (!key) {
        return jsonResponse(
          { ok: false, error: 'Missing key parameter' },
          400,
          cors
        );
      }
      const keyType = parseLookupKeyType(url);
      if (!keyType) {
        return jsonResponse(
          { ok: false, error: 'keyType must be entity or story' },
          400,
          cors
        );
      }
      const gallery = await findEntityGallery(env.CONTENT_DB, key, keyType);
      return jsonResponse(
        {
          ok: true,
          data: gallery ? { found: true, gallery } : { found: false },
        },
        200,
        cors,
        true
      );
    }

    // ---- Visuals gallery 反查（Visual Clue 觸發時刷新過期快照）----
    // ?id={pageId} 或 ?story={鑲框室插圖的 storyKey}，擇一必填
    if (path === '/api/visuals/gallery' && request.method === 'GET') {
      const id = url.searchParams.get('id')?.trim() ?? '';
      const story = url.searchParams.get('story')?.trim() ?? '';
      if (!id && !story) {
        return jsonResponse(
          { ok: false, error: 'Missing id or story parameter' },
          400,
          cors
        );
      }
      const gallery = id
        ? await findGalleryById(env.CONTENT_DB, id)
        : await findGalleryByStoryKey(env.CONTENT_DB, story);
      return jsonResponse(
        {
          ok: true,
          data: gallery ? { found: true, gallery } : { found: false },
        },
        200,
        cors,
        true
      );
    }

    // ---- 進度頁 metadata 部分更新（S10-3b T-B1）----
    // ⚠️ 必須排在 contentMatch 之前：contentMatch 的 slug 群組貪婪，會把
    // `.../metadata` 尾碼整段吃進 slug，且其 switch 沒有 PATCH（落 405）。
    // 同 concepts/entity-index「獨立匹配避開 contentMatch」的既有做法。
    const metadataPatchMatch = path.match(
      /^\/api\/content\/([a-z]+)\/(.+)\/metadata$/
    );
    if (metadataPatchMatch && request.method === 'PATCH') {
      const [, patchArea, patchSlug] = metadataPatchMatch;
      return patchPageMetadata(
        patchArea,
        patchSlug,
        request,
        env.CONTENT_DB,
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
      return jsonResponse({ ok: true, data }, 200, cors, true);
    }

    const homepageMatch = path.match(/^\/api\/homepage\/([a-z][a-z0-9-]*)$/);
    // 授權由上方 isWriteMethod 的 isAuthorized 統一把關（API_TOKEN 或 admin
    // JWT），與其餘所有寫入端點一致。
    //
    // ⚠️ 這裡曾經額外要求 requireJwt，是全部寫入端點裡唯一這麼做的。那個
    // 不一致沒有設計理由（只是實作先後），代價是 seed 腳本用 API_TOKEN 跑時
    // 其他表全成功、只有 site_homepage 整批 401——test 環境首頁因此空了兩個
    // 多月（2026-08-02 實測發現）。放寬後仍不存在匿名路徑。
    if (homepageMatch && request.method === 'PUT') {
      const sectionId = homepageMatch[1];
      const body = (await request.json()) as {
        content: unknown;
        updatedAt?: string;
      };
      if (!body.content) {
        return jsonResponse(
          { ok: false, error: 'content is required' },
          400,
          cors
        );
      }
      const now = body.updatedAt || new Date().toISOString();
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

    // ---- 主站路由（/api/root/*）----
    if (path.startsWith('/api/root/')) {
      const rootResponse = await handleRootRoutes(
        path,
        request.method,
        request,
        url,
        env,
        cors,
        requireJwtOrApiToken
      );
      if (rootResponse) return rootResponse;
    }

    // ---- Discord widget 統計（公開唯讀，5 分鐘快取）----
    if (path === '/api/widget/discord-stats' && request.method === 'GET') {
      try {
        const stats = await buildDiscordStats(
          env.CONTENT_DB,
          env.VISITOR_API_URL,
          env.VISITOR_COUNTER
        );
        return new Response(
          JSON.stringify({ ok: true, data: stats } satisfies ApiResponse<
            typeof stats
          >),
          {
            status: 200,
            headers: {
              ...cors,
              'Content-Type': 'application/json',
              // Discord widget 不需要即時；5 分鐘 CDN 快取大幅降低 D1 壓力
              'Cache-Control': 'public, max-age=300, s-maxage=300',
            },
          }
        );
      } catch (err) {
        return jsonResponse(
          {
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to build stats',
          },
          500,
          cors
        );
      }
    }

    // 健康檢查
    if (path === '/api/health') {
      return jsonResponse(
        { ok: true, data: { service: 'content-api', version: '1.0.0' } },
        200,
        cors,
        true
      );
    }

    // ═══ Test seed snapshot（正式環境唯讀）═══
    // 資料本來就由公開內容 API 提供；此端點只把 reset 所需骨架一次打包，
    // 避免 Admin reseed 發出上百個 subrequest。test Worker 不提供 snapshot，
    // 防止誤把測試資料當成正式 baseline。
    // 需授權：唯一呼叫端是兩站 reset proxy（SSR 轉送 admin JWT），
    // 用 requireJwt 而非 isAuthorized——正式 worker 的 isAuthorized 只認
    // API_TOKEN、不認 admin JWT，會誤擋 proxy。requireJwt 驗證 admin JWT
    // 並拒絕 reader/匿名，避免任何人一次打包帶走全站骨架、降低批量鏡像成本。
    if (path === '/api/test/seed-snapshot' && request.method === 'GET') {
      if (env.ETERNITY_TEST_ENV === 'true') {
        return jsonResponse({ ok: false, error: 'Not found' }, 404, cors);
      }
      if ((await requireJwt(request, env)) === null) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }
      const snapshot = await buildTestSeedSnapshot(env.CONTENT_DB);
      return jsonResponse({ ok: true, data: snapshot }, 200, cors, false);
    }

    // ═══ Test 環境專屬端點（Issue #41 T-10.5）═══
    // reset 預設必須攜帶正式環境產生的 seed snapshot；clearOnly 僅保留給
    // CLI 的「先清再由本機腳本 seed」流程。兩者都只清業務表，不動帳號類。
    if (path === '/api/test/reset' && request.method === 'POST') {
      if (env.ETERNITY_TEST_ENV !== 'true') {
        return jsonResponse({ ok: false, error: 'Not found' }, 404, cors);
      }
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
      }

      let body: { clearOnly?: boolean; snapshot?: unknown } = {};
      try {
        const text = await request.text();
        if (text) body = JSON.parse(text) as typeof body;
      } catch {
        return jsonResponse(
          { ok: false, error: 'Invalid JSON body' },
          400,
          cors
        );
      }

      let snapshot: TestSeedSnapshot;
      if (body.clearOnly === true) {
        snapshot = {
          version: 1,
          generatedAt: new Date().toISOString(),
          pages: [],
          rootProjects: [],
          rootLinks: [],
          rootUpdates: [],
          rootSingletons: [],
          rootCards: [],
          siteHomepage: [],
        };
      } else if (isTestSeedSnapshot(body.snapshot)) {
        snapshot = body.snapshot;
      } else {
        return jsonResponse(
          { ok: false, error: 'A valid seed snapshot is required' },
          400,
          cors
        );
      }

      const result = await resetAndSeedTestData(env.CONTENT_DB, snapshot);
      const [assets, rootAssets] = await Promise.all([
        clearR2Bucket(env.ASSETS_BUCKET),
        clearR2Bucket(env.ROOT_ASSETS_BUCKET),
      ]);
      return jsonResponse(
        {
          ok: true,
          data: {
            ...result,
            clearedAssets: { uep: assets, root: rootAssets },
          },
        },
        200,
        cors,
        false
      );
    }

    return jsonResponse({ ok: false, error: 'Not found' }, 404, cors);
  },

  // ===== 定期維護排程（Cron Trigger） =====
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(runScheduledMaintenance(env));
  },
};
