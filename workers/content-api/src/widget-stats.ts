/**
 * Discord widget 統計端點 — 純函式。
 *
 * 為 Discord widget / bot 同步器提供公開唯讀的內容統計。設計原則：
 * 1. 只做「聚合 D1 + 呼叫 visitor-counter」，不 PATCH Discord、不存 Bot token。
 * 2. 全部指標排除 deleted_at、metadata.hidden、metadata.locked。
 * 3. 字數口徑對齊編輯器（ThoughtStream）：去 HTML tag 後 `text.replace(/\s/g,'').length`。
 * 4. visitor-counter fetch 失敗時 stats 仍 200，該欄位回 null。
 *
 * 相關 PM 筆記：[[note:tl15xupf07v1czl34gwe]] 計畫、[[note:3mbyx45mqfczwwakt37i]] 可行度評估。
 */

import type { ContentBlock } from './types';
import { buildConceptsEntityIndex } from './concepts-index';

/** 對外回應型別（Discord widget 消費格式） */
export interface DiscordStatsResponse {
  historyTotalWords: number;
  echoesSongCount: number;
  visualsGalleryCount: number;
  conceptsEntityCount: number;
  storageExtraCount: number;
  /** null 表示 visitor-counter 呼叫失敗；其餘失敗仍以 200 回應 */
  uepVisitorCount: number | null;
  generatedAt: string;
}

/**
 * SQL 片段：排除軟刪除、hidden、locked。
 * 用 json_extract 檢查 metadata；hidden/locked 為 `true` 才排除，undefined/false 都納入。
 */
const VISIBLE_WHERE = `
  deleted_at IS NULL
  AND COALESCE(json_extract(metadata, '$.hidden'), 0) != 1
  AND COALESCE(json_extract(metadata, '$.locked'), 0) != 1
`;

/**
 * 從 ContentBlock 陣列萃取純文字用於字數計算。
 * - rich_text / paragraph / heading / blockquote / list / hint / spoiler：內容常為 HTML，去 tag
 * - 其餘型別（image / audio / code / divider）不計入字數
 *
 * 這條路徑是「無 metadata.wordCount 時的計算基礎」。已存在的 wordCount 由呼叫端優先使用。
 */
export function extractPlainTextFromBlocks(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (!b?.content) continue;
    switch (b.type) {
      case 'rich_text':
      case 'paragraph':
      case 'heading':
      case 'blockquote':
      case 'list':
      case 'hint':
      case 'spoiler':
        // 去 HTML tag → 保留純文字
        parts.push(b.content.replace(/<[^>]+>/g, ' '));
        break;
      default:
        // image/audio/code/divider 等不計字
        break;
    }
  }
  return parts.join(' ');
}

/**
 * 字數口徑（對齊 apps/uep/src/components/editor/ThoughtStream.tsx:212）：
 * 去空白後字元數。純中文與含英文段落都適用同一口徑，Discord widget 顯示的數字
 * 就等於編輯器裡看到的字數。
 */
export function countPlainTextChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

/**
 * 從單頁 metadata 或 content 取字數：
 * 優先讀 metadata.wordCount（fast path，遠端頁面若有預存則省一大筆解析）；
 * 缺失時 fallback 到解析 content。
 */
function pageWordCount(row: {
  metadata: string | null;
  content: string | null;
}): number {
  // 1) fast path：metadata.wordCount 已存在
  if (row.metadata) {
    try {
      const meta = JSON.parse(row.metadata) as { wordCount?: unknown };
      if (typeof meta.wordCount === 'number' && meta.wordCount >= 0) {
        return Math.floor(meta.wordCount);
      }
    } catch {
      // metadata 解析失敗 → 走 fallback
    }
  }
  // 2) fallback：從 content 現算
  if (!row.content) return 0;
  try {
    const blocks = JSON.parse(row.content) as ContentBlock[];
    return countPlainTextChars(extractPlainTextFromBlocks(blocks));
  } catch {
    return 0;
  }
}

/** History 總字數：只納入實際正文層級 arc/section */
export async function computeHistoryTotalWords(
  db: D1Database
): Promise<number> {
  const result = await db
    .prepare(
      `SELECT metadata, content FROM pages
       WHERE area = 'history' AND page_type IN ('arc', 'section') AND ${VISIBLE_WHERE}`
    )
    .all<{ metadata: string | null; content: string | null }>();

  let total = 0;
  for (const row of result.results || []) {
    total += pageWordCount(row);
  }
  return total;
}

/** 通用計數：某 area + page_type，排除 hidden/locked/deleted */
export async function countVisiblePages(
  db: D1Database,
  area: string,
  pageType: string
): Promise<number> {
  const result = await db
    .prepare(
      `SELECT COUNT(*) as n FROM pages
       WHERE area = ? AND page_type = ? AND ${VISIBLE_WHERE}`
    )
    .bind(area, pageType)
    .first<{ n: number }>();
  return result?.n ?? 0;
}

/**
 * 拿文件站訪客數。傳入 visitor-counter Worker 的 base URL；
 * 失敗（未設定 URL / 網路錯誤 / 非 200 / JSON 解析錯）一律回 null，讓整個 stats 端點仍能 200。
 */
export async function fetchUepVisitorCount(
  visitorApiUrl: string | undefined,
  visitorCounter?: Fetcher
): Promise<number | null> {
  try {
    const res = visitorCounter
      ? await visitorCounter.fetch(
          new Request(
            'https://visitor-counter.internal/api/visitor/count?site=uep'
          )
        )
      : visitorApiUrl
        ? await fetch(`${visitorApiUrl}/api/visitor/count?site=uep`, {
            // 讓 CF 對此子請求可以快取（visitor-counter 端目前沒設 Cache-Control，此值僅為容錯）
            cf: { cacheTtl: 60 },
          })
        : null;
    if (!res?.ok) return null;
    const json = (await res.json()) as { totalVisitors?: unknown };
    if (typeof json.totalVisitors !== 'number') return null;
    return Math.max(0, Math.floor(json.totalVisitors));
  } catch {
    return null;
  }
}

/**
 * 一次跑齊所有五個 zone + visitor 統計。順序：先 D1 全部並行，再併發等 visitor。
 */
export async function buildDiscordStats(
  db: D1Database,
  visitorApiUrl: string | undefined,
  visitorCounter?: Fetcher
): Promise<DiscordStatsResponse> {
  const [
    historyTotalWords,
    echoesSongCount,
    visualsGalleryCount,
    conceptsEntries,
    storageExtraCount,
    uepVisitorCount,
  ] = await Promise.all([
    computeHistoryTotalWords(db),
    countVisiblePages(db, 'echoes', 'song'),
    countVisiblePages(db, 'visuals', 'gallery'),
    // Discord 統計口徑：只算公開 concepts 頁的 entity，跟其它 zone 統計一致
    // 排除 hidden/locked（deleted 已由 SQL 內建排除）
    buildConceptsEntityIndex(db, { publicOnly: true }),
    countVisiblePages(db, 'storage', 'stuff'),
    fetchUepVisitorCount(visitorApiUrl, visitorCounter),
  ]);

  return {
    historyTotalWords,
    echoesSongCount,
    visualsGalleryCount,
    conceptsEntityCount: conceptsEntries.length,
    storageExtraCount,
    uepVisitorCount,
    generatedAt: new Date().toISOString(),
  };
}
