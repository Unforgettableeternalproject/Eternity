/**
 * echoes-song.ts — Echoes 曲目反查（Epic 2 S8 B-5）
 *
 * GET /api/echoes/entity-song?key={entityKey|storyKey}
 * GET /api/echoes/song?id={songId}
 *
 * entity-song：互動嵌入的消費端（`uep:entity-activate` → 曲目卡展示，
 * D 段接線）：以 S7 統一實體身分（entityKey）或 S10-1 劇情點身分
 * （storyKey）反查掛同 key 的 Echoes 歌曲。
 *
 * song（by-id）：echo spot 觸發時的快照刷新——文章 node 保存的
 * songUrlKey/title/spoilerRevisions 是插入當下的快照，換音檔或改
 * spoiler 後會過期；前台觸發時以 songId 反查現行資料，快照僅作
 * 離線 fallback。
 *
 * 設計約束（docs/agent/S8_ECHOES_DESIGN.md §8-1）：
 * - `audioFile` 回傳裸 R2 key，不組完整 URL——API base 隨環境變動，
 *   前端以 `buildAudioUrl` 組合
 * - `spoilerRevisions` 只回摘要，gate 求值在前端 resolver
 *   （resolveSpoilerLevel）；解鎖判定也在前端（isSongCollected）
 * - `clusterId` 由頁面 id 路徑推導（`echoes/{cluster}/...`）；
 *   分類「色」是前端 CLUSTERS 常數，後端不重複一份事實
 *   （與設計文件 §8-1 的 clusterColor 欄位刻意偏離，理由如上）
 * - `songType` 對映既有 metadata.category（area/character/story/special），
 *   不另開欄位
 */

export interface EntitySongPayload {
  /** Echoes 歌曲頁 id（`echoes/...`） */
  id: string;
  title: string;
  /** 音檔裸 R2 key；無音檔 = null */
  audioFile: string | null;
  /** by-id 反查時歌曲可能未掛 entityKey */
  entityKey: string | null;
  /** 劇情歌的劇情點識別碼（選填，未設定 = null） */
  storyKey: string | null;
  /** metadata.category 原值（area/character/story/special） */
  songType: string | null;
  subtitle: string | null;
  duration: number | null;
  spoilerLevel: number;
  /** Echoes zone 收藏池 gate；舊字串 gate 不回傳為條件。 */
  gate?: unknown;
  locked: boolean;
  /** spoiler 降級鏈摘要（有設定才出現） */
  spoilerRevisions?: unknown[];
  /** 頁面 id 第二段（`echoes/{cluster}/...`）；推導不出時 null */
  clusterId: string | null;
}

interface SongRow {
  id: string;
  title: string;
  metadata: string;
}

/** SongRow → payload（entity-song 與 by-id 反查共用同一份摘要邏輯） */
function buildSongPayload(row: SongRow): EntitySongPayload {
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
    audioFile: typeof meta.audioFile === 'string' ? meta.audioFile : null,
    entityKey: typeof meta.entityKey === 'string' ? meta.entityKey : null,
    storyKey: typeof meta.storyKey === 'string' ? meta.storyKey : null,
    songType: typeof meta.category === 'string' ? meta.category : null,
    subtitle: typeof meta.subtitle === 'string' ? meta.subtitle : null,
    duration:
      typeof (meta.audioMeta as Record<string, unknown> | undefined)
        ?.duration === 'number'
        ? ((meta.audioMeta as Record<string, number>).duration ?? null)
        : null,
    spoilerLevel:
      typeof meta.spoilerLevel === 'number' &&
      meta.spoilerLevel >= 0 &&
      meta.spoilerLevel <= 3
        ? meta.spoilerLevel
        : 0,
    ...(meta.gate != null && typeof meta.gate === 'object'
      ? { gate: meta.gate }
      : {}),
    locked: meta.locked === true,
    ...(Array.isArray(meta.spoilerRevisions) && meta.spoilerRevisions.length > 0
      ? { spoilerRevisions: meta.spoilerRevisions }
      : {}),
    clusterId: segments.length >= 2 ? segments[1] : null,
  };
}

/**
 * 以 entityKey 或 storyKey 反查 Echoes 歌曲；找不到回傳 null。
 *
 * SQL 只篩結構性欄位，key 與 hidden 判定放應用層——metadata 是自由
 * JSON 欄位，SQLite 的 json_extract 遇到非法 JSON 會讓整條 SELECT 報錯
 * 而非回傳 NULL，一列壞資料就會打掉整個端點。其餘 index 建構器
 * （echoes-index / visuals-index / concepts-index）早已採此模式。
 *
 * 兩種 key 都比對：角色歌／區域歌掛 entityKey，劇情歌掛 storyKey，
 * 呼叫端不必先知道是哪一種。
 */
export async function findEntitySong(
  db: D1Database,
  key: string
): Promise<EntitySongPayload | null> {
  const result = await db
    .prepare(
      `SELECT id, title, metadata FROM pages
       WHERE area = 'echoes' AND page_type = 'song' AND deleted_at IS NULL`
    )
    .all<SongRow>();

  for (const row of result.results || []) {
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(row.metadata || '{}') as Record<string, unknown>;
    } catch {
      continue; // 壞 JSON 跳過該列，不影響其餘
    }
    // 原 SQL 的 COALESCE(...,0)=0 語意：未設定或 false 才算公開
    if (meta.hidden === true || meta.hidden === 1) continue;
    if (meta.entityKey !== key && meta.storyKey !== key) continue;
    return buildSongPayload(row);
  }
  return null;
}

/**
 * 以歌曲頁 id 反查現行資料；找不到（含軟刪除）回傳 null。
 *
 * 與 entity-song 不同，**刻意不排除 hidden**——echo spot 是對歌曲的
 * 明確引用，而劇情歌以 hidden 從 Echoes 列表隱藏是常態設計，
 * 排除會讓劇情 spot 永遠退回過期快照。
 */
export async function findSongById(
  db: D1Database,
  id: string
): Promise<EntitySongPayload | null> {
  const row = await db
    .prepare(
      `SELECT id, title, metadata FROM pages
       WHERE id = ? AND area = 'echoes' AND page_type = 'song'
         AND deleted_at IS NULL
       LIMIT 1`
    )
    .bind(id)
    .first<SongRow>();
  if (!row) return null;
  return buildSongPayload(row);
}
