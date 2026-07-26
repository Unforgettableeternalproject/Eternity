/**
 * echoes-index.ts — Echoes 條目索引（Epic 2 S8 驗收 #2）
 *
 * GET /api/echoes/entity-index
 *
 * 供互動嵌入超連結的「跨 entity 浮島聯集」啟用判定用：前端要知道某個
 * entityKey 在 Echoes 是否有對應條目（song），才能決定聯集浮島是否顯示
 * Echoes 分頁。song 是獨立 pages（非巢狀 JSON），metadata 直接有欄位，
 * 不需像 concepts-index 解析結構化區塊。
 *
 * 對位 concepts-index.ts：獨立前綴避開 contentMatch regex；只收有
 * entityKey 或 storyKey 的條目（跨 zone 聯集判定不需要 name-only 條目）。
 *
 * S10-1 起同時收 storyKey（劇情歌的劇情點身分）——兩種 key 是平行的
 * 命名空間，同一首歌依 songType 只會有其中一種。
 */

/** 索引中的單筆條目摘要 */
export interface EchoesEntityIndexEntry {
  /** Echoes 歌曲頁 id（`echoes/...`） */
  id: string;
  /** 角色歌／區域歌的實體身分；劇情歌沒有，故為選填 */
  entityKey?: string;
  /** 劇情歌的劇情點身分（S10-1 第二套命名空間）；非劇情歌沒有 */
  storyKey?: string;
  /** Echoes zone 收藏池 gate；舊字串 gate 不回傳為條件 */
  gate?: unknown;
  locked: boolean;
}

/** buildEchoesEntityIndex 選項 */
export interface BuildEchoesEntityIndexOptions {
  /**
   * 連 `metadata.hidden` 的頁面一起收進索引。
   *
   * 預設 `false` —— 維持 `/api/echoes/entity-index` 既有行為：該端點服務
   * 的是「跨 entity 浮島聯集」判定，隱藏條目本來就不該讓前台看見。
   *
   * `true` 用於**唯一性把關**（S10-1 `findKeyConflict`）：hidden 只是
   * 不在列表顯示，key 本身仍然是有效的引用目標（echo spot 可以指向
   * hidden 的劇情歌，by-id 反查刻意不排除 hidden 就是這個道理）。
   * 撞名檢查若看不到 hidden 頁，兩首隱藏歌就能共用同一個 key 而無人攔阻。
   */
  includeHidden?: boolean;
}

interface EchoesIndexRow {
  id: string;
  metadata: string;
}

/**
 * 建立 Echoes 條目索引：單次 D1 掃描 echoes/song 全頁，逐頁解析
 * metadata 彙整 entityKey/storyKey/gate/locked 摘要。
 *
 * 兩種 key 一個都沒有的頁不進索引（無身分即無從被反查）；壞 metadata
 * JSON 靜默跳過（索引是輔助功能，容錯優先）。hidden 頁預設排除，
 * 見 `BuildEchoesEntityIndexOptions.includeHidden`。
 *
 * 注意：hidden 過濾刻意不下推到 SQL 的 json_extract——索引要掃全表，
 * 一旦有任何一列 metadata 是壞 JSON，SQLite 的 json_extract 會直接讓
 * 整條查詢報錯（非回傳 NULL），無法逐列容錯。故 SQL 只篩穩定欄位，
 * hidden 判定與壞 JSON 容錯一併放到應用層。
 */
export async function buildEchoesEntityIndex(
  db: D1Database,
  opts: BuildEchoesEntityIndexOptions = {}
): Promise<EchoesEntityIndexEntry[]> {
  const result = await db
    .prepare(
      `SELECT id, metadata FROM pages
       WHERE area = 'echoes' AND page_type = 'song' AND deleted_at IS NULL
       ORDER BY sort_order ASC`
    )
    .all<EchoesIndexRow>();

  const entries: EchoesEntityIndexEntry[] = [];
  for (const row of result.results || []) {
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(row.metadata || '{}') as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!opts.includeHidden && meta.hidden === true) continue;
    const entityKey =
      typeof meta.entityKey === 'string' && meta.entityKey
        ? meta.entityKey
        : undefined;
    const storyKey =
      typeof meta.storyKey === 'string' && meta.storyKey
        ? meta.storyKey
        : undefined;
    if (!entityKey && !storyKey) continue;
    entries.push({
      id: row.id,
      ...(entityKey ? { entityKey } : {}),
      ...(storyKey ? { storyKey } : {}),
      ...(meta.gate != null && typeof meta.gate === 'object'
        ? { gate: meta.gate }
        : {}),
      locked: meta.locked === true,
    });
  }
  return entries;
}
