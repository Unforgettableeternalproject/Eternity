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
 * entityKey 的條目（跨 zone 聯集判定不需要 name-only 條目）。
 */

/** 索引中的單筆條目摘要 */
export interface EchoesEntityIndexEntry {
  /** Echoes 歌曲頁 id（`echoes/...`） */
  id: string;
  entityKey: string;
  /** Echoes zone 收藏池 gate；舊字串 gate 不回傳為條件 */
  gate?: unknown;
  locked: boolean;
}

interface EchoesIndexRow {
  id: string;
  metadata: string;
}

/**
 * 建立 Echoes 條目索引：單次 D1 掃描 echoes/song 全頁，逐頁解析
 * metadata 彙整 entityKey/gate/locked 摘要。
 *
 * hidden 頁、無 entityKey 頁不進索引；壞 metadata JSON 靜默跳過
 * （索引是輔助功能，容錯優先）。
 *
 * 注意：hidden 過濾刻意不下推到 SQL 的 json_extract（不同於
 * echoes-song.ts 單筆反查）——單筆反查場景一定命中合法 metadata，
 * 但索引要掃全表，一旦有任何一列 metadata 是壞 JSON，SQLite 的
 * json_extract 會直接讓整條查詢報錯（非回傳 NULL），無法逐列容錯。
 * 故 SQL 只篩穩定欄位，hidden 判定與壞 JSON 容錯一併放到應用層。
 */
export async function buildEchoesEntityIndex(
  db: D1Database
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
