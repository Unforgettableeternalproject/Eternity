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
 * 對位 echoes-index.ts：同規則（只收有 entityKey 者、hidden 排除、
 * 壞 JSON 靜默跳過）。
 */

/** 索引中的單筆條目摘要 */
export interface VisualsEntityIndexEntry {
  /** Visuals gallery 頁 id（`visuals/...`） */
  id: string;
  entityKey: string;
  /** gallery 解鎖閘；舊自由文字 gate 不回傳為條件 */
  gate?: unknown;
  locked: boolean;
}

interface VisualsIndexRow {
  id: string;
  metadata: string;
}

/**
 * 建立 Visuals 條目索引：單次 D1 掃描 visuals/gallery 全頁，逐頁解析
 * metadata 彙整 entityKey/gate/locked 摘要。
 *
 * hidden 頁、無 entityKey 頁不進索引；壞 metadata JSON 靜默跳過
 * （索引是輔助功能，容錯優先）。
 *
 * 注意：hidden 過濾刻意不下推到 SQL 的 json_extract（同 echoes-index.ts
 * 理由）——索引要掃全表，一旦有任何一列 metadata 是壞 JSON，SQLite 的
 * json_extract 會直接讓整條查詢報錯（非回傳 NULL），無法逐列容錯。
 * 故 SQL 只篩穩定欄位，hidden 判定與壞 JSON 容錯一併放到應用層。
 */
export async function buildVisualsEntityIndex(
  db: D1Database
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
    if (meta.hidden === true) continue;
    if (typeof meta.entityKey !== 'string' || !meta.entityKey) continue;
    entries.push({
      id: row.id,
      entityKey: meta.entityKey,
      ...(meta.gate != null && typeof meta.gate === 'object'
        ? { gate: meta.gate }
        : {}),
      locked: meta.locked === true,
    });
  }
  return entries;
}
