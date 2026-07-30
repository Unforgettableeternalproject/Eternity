/**
 * flags-rename.ts — 自訂旗標改名的三段式流程（scan → dryRun → batch）
 *
 * 旗標名散在兩種載體裡，改名必須兩邊同時改：
 * - 授予端：`pages.content` 的 `data-grants-flags` HTML 屬性
 * - 需求端：`pages.metadata` 的 `gate.requiresFlags` JSON 陣列
 *
 * 為什麼不做即時連動（ADR-C）：漏改任何一處的症狀是**靜默永久鎖死**——
 * 需求端等一個再也不會被授予的旗標，沒有錯誤訊息，只是那一頁永遠打不開。
 * 所以流程是先算出完整計畫、給人看過、再一次性寫入。
 *
 * ⚠️ 這裡改的是 HTML 字串。**絕不對旗標名做全文字串替換**——正文裡提到同名
 * 字串的地方會一起被改掉。做法是逐個 marker 解析 `data-grants-flags` 的逗號
 * 清單、比對完整項目、重新序列化該屬性，其餘 HTML 一個字元都不動。
 */

import { decodeEntities, readAttr } from './content-scan';
import {
  classifyFlag,
  parseFlagsAttr,
  PROGRESS_MARKER_DIV_REGEX,
} from './flags-scan';

/** 受改名影響的一頁 */
export interface FlagRenameHit {
  pageId: string;
  area: string;
  title: string;
  /** 授予端命中的 marker 數 */
  contentHits: number;
  /** 需求端命中的 gate 條件數 */
  metadataHits: number;
}

/** 一頁的改寫結果（dryRun 與實際寫入共用同一份計算） */
interface PlannedUpdate {
  pageId: string;
  content: string | null;
  metadata: string | null;
  /** 有 source_file 的頁面改內容要標 modified，與 upsertPage 的慣例一致 */
  markModified: boolean;
}

export interface FlagRenamePlan {
  pages: FlagRenameHit[];
  updates: PlannedUpdate[];
  totalHits: number;
}

/** 寫回屬性值時重新轉義（`readAttr` 讀出來的是已解碼的值） */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 屬性出現次數——改寫前後必須一致，否則就是把 HTML 改壞了 */
function countFlagAttrs(html: string): number {
  return (html.match(/data-grants-flags="/g) || []).length;
}

/**
 * 改寫單段 HTML 裡的 `data-grants-flags`。
 *
 * 只動命中的那個屬性值，且用「解析清單 → 換掉完整項目 → 重新序列化」而非
 * 字串替換。若 `to` 已存在於同一個 marker 的清單裡，改名後會去重（同時授予
 * 舊名與新名是合法狀態，改完就該合併成一個）。
 */
export function renameFlagInHtml(
  html: string,
  from: string,
  to: string
): { html: string; hits: number } {
  let hits = 0;
  const next = html.replace(
    PROGRESS_MARKER_DIV_REGEX,
    (full: string, attrs: string) => {
      const raw = readAttr(attrs, 'data-grants-flags');
      if (!raw) return full;
      const flags = parseFlagsAttr(raw);
      if (!flags.includes(from)) return full;
      hits += 1;
      // parseFlagsAttr 本身會去重，所以直接改完再過一次即可
      const renamed = parseFlagsAttr(
        flags.map((flag) => (flag === from ? to : flag)).join(',')
      );
      return full.replace(
        /data-grants-flags="[^"]*"/,
        `data-grants-flags="${escapeAttr(renamed.join(','))}"`
      );
    }
  );
  return { html: next, hits };
}

/**
 * 改寫 `pages.content`（存的是 `ContentBlock[]` 的 JSON 字串）。
 *
 * 解析路徑刻意與 `collectContentStrings` 一致：非陣列的 content 掃描器也掃
 * 不到，所以那種頁面本來就不會出現在受影響清單裡，改寫直接回 0 筆。
 *
 * 回 `null` 代表這一頁不用動。
 */
export function renameFlagInContent(
  raw: string | null,
  from: string,
  to: string
): { content: string | null; hits: number } {
  if (!raw) return { content: null, hits: 0 };
  let blocks: unknown;
  try {
    blocks = JSON.parse(raw);
  } catch {
    return { content: null, hits: 0 };
  }
  if (!Array.isArray(blocks)) return { content: null, hits: 0 };

  let hits = 0;
  const next = blocks.map((block) => {
    if (!block || typeof block !== 'object') return block;
    const value = (block as { content?: unknown }).content;
    if (typeof value !== 'string') return block;
    const result = renameFlagInHtml(value, from, to);
    if (result.hits === 0) return block;
    // 保險：改寫不該讓屬性數量變動。真的變了就是 regex 咬錯，
    // 這一頁整份放棄比寫進半壞的 HTML 好
    if (countFlagAttrs(result.html) !== countFlagAttrs(value)) {
      throw new Error(
        `旗標改名會破壞 HTML 結構（data-grants-flags 數量不一致），已中止`
      );
    }
    hits += result.hits;
    return { ...(block as object), content: result.html };
  });

  if (hits === 0) return { content: null, hits: 0 };
  return { content: JSON.stringify(next), hits };
}

/**
 * 改寫 `pages.metadata` 的 gate 旗標需求。
 *
 * 兩種存放形狀都要吃（平鋪與巢狀 `gate`），與 `scanRequiredFlags` 一致——
 * 漏掉任一種就會改完內容卻留著需求端的舊名。
 */
export function renameFlagInMetadata(
  raw: string | null,
  from: string,
  to: string
): { metadata: string | null; hits: number } {
  if (!raw) return { metadata: null, hits: 0 };
  let meta: unknown;
  try {
    meta = JSON.parse(raw);
  } catch {
    return { metadata: null, hits: 0 };
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { metadata: null, hits: 0 };
  }

  const root = meta as Record<string, unknown>;
  const nested =
    typeof root.gate === 'object' && root.gate !== null
      ? (root.gate as Record<string, unknown>)
      : null;
  const holder = nested ?? root;
  if (!Array.isArray(holder.requiresFlags)) return { metadata: null, hits: 0 };

  const flags = holder.requiresFlags.filter(
    (flag): flag is string => typeof flag === 'string'
  );
  if (!flags.includes(from)) return { metadata: null, hits: 0 };

  const renamed = [
    ...new Set(flags.map((flag) => (flag === from ? to : flag))),
  ];
  const nextHolder = { ...holder, requiresFlags: renamed };
  const next = nested ? { ...root, gate: nextHolder } : nextHolder;
  return { metadata: JSON.stringify(next), hits: 1 };
}

/**
 * 算出改名計畫：掃全站、產生每一頁的改寫結果。
 *
 * dryRun 與實際寫入共用這一份——預覽的筆數若是另外算的，看到的數字就不保證
 * 是真的會寫進去的東西。
 */
export async function planFlagRename(
  db: D1Database,
  from: string,
  to: string
): Promise<FlagRenamePlan> {
  const rows = await db
    .prepare(
      `SELECT id, area, title, content, metadata, source_file FROM pages
       WHERE deleted_at IS NULL`
    )
    .all<{
      id: string;
      area: string;
      title: string;
      content: string | null;
      metadata: string | null;
      source_file: string | null;
    }>();

  const pages: FlagRenameHit[] = [];
  const updates: PlannedUpdate[] = [];
  let totalHits = 0;

  for (const row of rows.results || []) {
    const contentResult = renameFlagInContent(row.content, from, to);
    const metaResult = renameFlagInMetadata(row.metadata, from, to);
    const hits = contentResult.hits + metaResult.hits;
    if (hits === 0) continue;

    pages.push({
      pageId: row.id,
      area: row.area,
      title: row.title,
      contentHits: contentResult.hits,
      metadataHits: metaResult.hits,
    });
    updates.push({
      pageId: row.id,
      content: contentResult.content,
      metadata: metaResult.metadata,
      // 只有內容真的變了才需要標 modified；改 metadata 不影響來源檔比對
      markModified: contentResult.hits > 0 && !!row.source_file,
    });
    totalHits += hits;
  }

  return { pages, updates, totalHits };
}

/**
 * 一次性寫入改名計畫。
 *
 * `db.batch()` 走單一交易：任一句失敗就整批不生效，不會留下「內容改了但註冊表
 * 沒改」這種註冊表與內容不一致的中間狀態。
 *
 * ⚠️ 刻意直接 UPDATE 而不走 `upsertPage`。逐一檢查過那條路的三個配套對改名
 * 都不適用或不需要：key 唯一性（沒動 key）、旗標註冊強制（新名已在註冊表、
 * 舊名同批移除，一致）、`history_interlink_index` 重建（`data-grants-flags`
 * 不進那張表，見設計文件 §3-3）。
 */
export async function applyFlagRename(
  db: D1Database,
  plan: FlagRenamePlan,
  from: string,
  to: string
): Promise<number> {
  const now = new Date().toISOString();
  const statements = plan.updates.map((update) => {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (update.content !== null) {
      sets.push('content = ?');
      values.push(update.content);
    }
    if (update.metadata !== null) {
      sets.push('metadata = ?');
      values.push(update.metadata);
    }
    if (update.markModified) sets.push("status = 'modified'");
    sets.push('updated_at = ?');
    values.push(now, update.pageId);
    return db
      .prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values);
  });

  statements.push(
    db
      .prepare(`UPDATE uep_flags SET name = ?, updated_at = ? WHERE name = ?`)
      .bind(to, now, from)
  );

  await db.batch(statements);
  return plan.updates.length;
}

/** 改名目標的合法性；回 null 代表通過 */
export function validateRenameTarget(to: string): string | null {
  const trimmed = to.trim();
  if (!trimmed) return '缺少新旗標名稱';
  if (classifyFlag(trimmed) === 'derived') {
    return '新名稱符合規則生成的旗標形狀，那類旗標由程式依 key 推導，不能當自訂旗標名';
  }
  // 逗號是 data-grants-flags 的分隔符，名稱裡有它會在序列化後裂成兩個旗標
  if (trimmed.includes(',')) return '旗標名稱不可含逗號';
  // 屬性值裡的引號會提前結束屬性，把後面的 HTML 全部推成新屬性
  if (trimmed.includes('"')) return '旗標名稱不可含雙引號';
  if (decodeEntities(trimmed) !== trimmed) {
    return '旗標名稱不可含 HTML 實體字元';
  }
  return null;
}
