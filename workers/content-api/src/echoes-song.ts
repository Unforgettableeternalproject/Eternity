/**
 * echoes-song.ts — Echoes entity↔曲目反查（Epic 2 S8 B-5）
 *
 * GET /api/echoes/entity-song?key={entityKey}
 *
 * 互動嵌入的消費端（`uep:entity-activate` → 曲目卡展示，D 段接線）：
 * 以 S7 統一實體身分（entityKey）反查掛同 key 的 Echoes 歌曲。
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
  entityKey: string;
  /** metadata.category 原值（area/character/story/special） */
  songType: string | null;
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

/** 以 entityKey 反查 Echoes 歌曲；找不到回傳 null */
export async function findEntitySong(
  db: D1Database,
  key: string
): Promise<EntitySongPayload | null> {
  const row = await db
    .prepare(
      `SELECT id, title, metadata FROM pages
       WHERE area = 'echoes' AND page_type = 'song' AND deleted_at IS NULL
         AND json_extract(metadata, '$.entityKey') = ?
       LIMIT 1`
    )
    .bind(key)
    .first<SongRow>();
  if (!row) return null;

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
    entityKey: key,
    songType: typeof meta.category === 'string' ? meta.category : null,
    ...(Array.isArray(meta.spoilerRevisions) && meta.spoilerRevisions.length > 0
      ? { spoilerRevisions: meta.spoilerRevisions }
      : {}),
    clusterId: segments.length >= 2 ? segments[1] : null,
  };
}
