/**
 * visuals-gallery.ts — Visuals gallery 反查（Epic 2 S8 下半場 V-A.13）
 *
 * GET /api/visuals/entity-gallery?key={entityKey}
 * GET /api/visuals/gallery?id={pageId} 或 ?illustration={插圖 ID}
 *
 * entity-gallery：互動嵌入的消費端（`uep:entity-activate` → 浮動幻影
 * 提示卡，V-C 接線）：以統一實體身分（entityKey）反查掛同 key 的
 * gallery——依編輯規則僅陳列走廊（profiles）可綁 entityKey。
 *
 * gallery（by-id / by-illustration）：Visual Clue 觸發時的快照刷新
 * （V-D 接線，一次做齊不重蹈 echo spot 先漏後補的路）——clue node
 * 保存的目標是插入當下的快照，改圖或改條件後會過期；前台觸發時
 * 以引用反查現行資料。插圖 ID 是鑲框室（illustrations）gallery 的
 * 獨特識別。
 *
 * 設計約束（比照 echoes-song.ts）：
 * - `images[].file` 回傳裸 R2 key，不組完整 URL——前端以 assetUrl 組合
 * - 三態欄位（initialState/lockGate/partialGate）只回摘要，
 *   求值在前端 resolver（resolveImageState）；gallery 閘同理
 * - `divisionId` 由頁面 id 路徑推導（`visuals/{division}/...`）；
 *   浮島只收 profiles/illustrations 的過濾在前端（後端不重複規則）
 * - images 依 sortOrder 升冪回傳——「第一張圖恆等式」依賴此順序，
 *   在後端排定減少前端出錯面
 */

/** gallery 內單張圖片的摘要（三態求值在前端） */
export interface GalleryImagePayload {
  id: string;
  /** 裸 R2 key */
  file: string;
  caption: string;
  sortOrder: number;
  isSpriteSheet?: boolean;
  initialState?: string;
  lockGate?: unknown;
  partialGate?: unknown;
}

export interface EntityGalleryPayload {
  /** Visuals gallery 頁 id（`visuals/...`） */
  id: string;
  title: string;
  /** by-id 反查時 gallery 可能未掛 entityKey */
  entityKey: string | null;
  /** 鑲框室獨特 ID；未設定 = null */
  illustrationId: string | null;
  /** 頁面 id 第二段（`visuals/{division}/...`）；推導不出時 null */
  divisionId: string | null;
  /** gallery 解鎖閘；舊自由文字 gate 不回傳為條件（靜默失效定案） */
  gate?: unknown;
  locked: boolean;
  /** 依 sortOrder 升冪 */
  images: GalleryImagePayload[];
}

interface GalleryRow {
  id: string;
  title: string;
  metadata: string;
}

/** metadata.images → 摘要陣列（壞資料逐項防禦，依 sortOrder 升冪） */
function buildImages(meta: Record<string, unknown>): GalleryImagePayload[] {
  if (!Array.isArray(meta.images)) return [];
  const images: GalleryImagePayload[] = [];
  for (const raw of meta.images) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.file !== 'string' || !item.file) continue;
    images.push({
      id: typeof item.id === 'string' ? item.id : '',
      file: item.file,
      caption: typeof item.caption === 'string' ? item.caption : '',
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 0,
      ...(item.isSpriteSheet === true ? { isSpriteSheet: true } : {}),
      ...(typeof item.initialState === 'string'
        ? { initialState: item.initialState }
        : {}),
      ...(item.lockGate != null && typeof item.lockGate === 'object'
        ? { lockGate: item.lockGate }
        : {}),
      ...(item.partialGate != null && typeof item.partialGate === 'object'
        ? { partialGate: item.partialGate }
        : {}),
    });
  }
  return images.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** GalleryRow → payload（entity 與 by-id/by-illustration 反查共用） */
function buildGalleryPayload(row: GalleryRow): EntityGalleryPayload {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(row.metadata || '{}') as Record<string, unknown>;
  } catch {
    // 壞 JSON 視為空 metadata（不讓單頁資料毀掉端點）
  }

  const segments = row.id.split('/');
  return {
    id: row.id,
    title: row.title,
    entityKey: typeof meta.entityKey === 'string' ? meta.entityKey : null,
    illustrationId:
      typeof meta.illustrationId === 'string' ? meta.illustrationId : null,
    divisionId: segments.length >= 2 ? segments[1] : null,
    ...(meta.gate != null && typeof meta.gate === 'object'
      ? { gate: meta.gate }
      : {}),
    locked: meta.locked === true,
    // spoilerLevel 不回傳——Visuals 已排除 spoiler 降級鏈（07/20 驗收定案）
    images: buildImages(meta),
  };
}

/** 以 entityKey 反查 Visuals gallery；找不到回傳 null */
export async function findEntityGallery(
  db: D1Database,
  key: string
): Promise<EntityGalleryPayload | null> {
  const row = await db
    .prepare(
      `SELECT id, title, metadata FROM pages
       WHERE area = 'visuals' AND page_type = 'gallery' AND deleted_at IS NULL
         AND json_extract(metadata, '$.entityKey') = ?
         AND COALESCE(json_extract(metadata, '$.hidden'), 0) = 0
       LIMIT 1`
    )
    .bind(key)
    .first<GalleryRow>();
  if (!row) return null;
  return buildGalleryPayload(row);
}

/**
 * 以 gallery 頁 id 反查現行資料；找不到（含軟刪除）回傳 null。
 *
 * 比照 echoes by-id：**刻意不排除 hidden**——Visual Clue 是對插圖的
 * 明確引用，劇情插圖以 hidden 從 Visuals 列表隱藏是可預期的設計。
 */
export async function findGalleryById(
  db: D1Database,
  id: string
): Promise<EntityGalleryPayload | null> {
  const row = await db
    .prepare(
      `SELECT id, title, metadata FROM pages
       WHERE id = ? AND area = 'visuals' AND page_type = 'gallery'
         AND deleted_at IS NULL
       LIMIT 1`
    )
    .bind(id)
    .first<GalleryRow>();
  if (!row) return null;
  return buildGalleryPayload(row);
}

/**
 * 以插圖 ID（鑲框室獨特 ID）反查；找不到回傳 null。
 * 同 by-id：不排除 hidden。
 */
export async function findGalleryByIllustrationId(
  db: D1Database,
  illustrationId: string
): Promise<EntityGalleryPayload | null> {
  const row = await db
    .prepare(
      `SELECT id, title, metadata FROM pages
       WHERE area = 'visuals' AND page_type = 'gallery' AND deleted_at IS NULL
         AND json_extract(metadata, '$.illustrationId') = ?
       LIMIT 1`
    )
    .bind(illustrationId)
    .first<GalleryRow>();
  if (!row) return null;
  return buildGalleryPayload(row);
}
