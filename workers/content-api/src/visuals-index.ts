/**
 * visuals-index.ts — Visuals 條目索引（Epic 2 S8 驗收 #2）
 *
 * GET /api/visuals/entity-index
 *
 * 供互動嵌入超連結的「跨 entity 浮島聯集」啟用判定用：前端要知道某個
 * entityKey 在 Visuals 是否有對應條目（gallery），才能決定聯集浮島是否
 * 顯示 Visuals 分頁。gallery 是獨立 pages（非巢狀 JSON），metadata 直接
 * 有欄位，不需像 concepts-index 解析結構化區塊。
 *
 * 對位 echoes-index.ts：同規則（只收有 entityKey 或 storyKey 者、
 * hidden 預設排除、壞 JSON 靜默跳過）。
 *
 * S10-1 起同時收 storyKey（鑲框室插圖的劇情點身分）——兩種 key 依分館
 * 互斥：陳列走廊綁 entityKey、鑲框室綁 storyKey。
 */

/** 索引中的單筆條目摘要 */
export interface VisualsEntityIndexEntry {
  /** Visuals gallery 頁 id（`visuals/...`） */
  id: string;
  /** 陳列走廊（profiles）的實體身分；鑲框室插圖沒有，故為選填 */
  entityKey?: string;
  /** 鑲框室（illustrations）插圖的劇情點身分（S10-1 第二套命名空間） */
  storyKey?: string;
  /** gallery 解鎖閘；舊自由文字 gate 不回傳為條件 */
  gate?: unknown;
  locked: boolean;
}

/** buildVisualsEntityIndex 選項 */
export interface BuildVisualsEntityIndexOptions {
  /**
   * 連 `metadata.hidden` 的頁面一起收進索引。
   *
   * 預設 `false` —— 維持 `/api/visuals/entity-index` 既有行為。
   * `true` 用於唯一性把關（S10-1 `findKeyConflict`），理由與
   * `echoes-index.ts` 的同名選項相同：hidden 只是不在列表顯示，
   * key 仍然是有效的引用目標，撞名檢查必須看得到。
   */
  includeHidden?: boolean;
}

interface VisualsIndexRow {
  id: string;
  metadata: string;
}

/**
 * 建立 Visuals 條目索引：單次 D1 掃描 visuals/gallery 全頁，逐頁解析
 * metadata 彙整 entityKey/storyKey/gate/locked 摘要。
 *
 * 兩種 key 一個都沒有的頁不進索引；壞 metadata JSON 靜默跳過
 * （索引是輔助功能，容錯優先）。hidden 頁預設排除，見
 * `BuildVisualsEntityIndexOptions.includeHidden`。
 *
 * 注意：hidden 過濾刻意不下推到 SQL 的 json_extract（同 echoes-index.ts
 * 理由）——索引要掃全表，一旦有任何一列 metadata 是壞 JSON，SQLite 的
 * json_extract 會直接讓整條查詢報錯（非回傳 NULL），無法逐列容錯。
 * 故 SQL 只篩穩定欄位，hidden 判定與壞 JSON 容錯一併放到應用層。
 */
export async function buildVisualsEntityIndex(
  db: D1Database,
  opts: BuildVisualsEntityIndexOptions = {}
): Promise<VisualsEntityIndexEntry[]> {
  const result = await db
    .prepare(
      `SELECT id, metadata FROM pages
       WHERE area = 'visuals' AND page_type = 'gallery' AND deleted_at IS NULL
       ORDER BY sort_order ASC`
    )
    .all<VisualsIndexRow>();

  const entries: VisualsEntityIndexEntry[] = [];
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
