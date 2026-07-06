/**
 * concepts-index.ts — Concepts 條目索引（Epic 2 S7-C）
 *
 * 供 Terminal Island 建立輕量檢索索引的摘要端點：
 * GET /api/concepts/entity-index
 *
 * 設計定案（docs/agent/S7_CONCEPTS_DESIGN.md「Sub-session C 開工前定案」）：
 * - 納入「無 entityKey 的條目」（name-only）——translation 定案不掛 key，
 *   靠 name 檢索；有 entityKey 的條目才具備深連與更動通知能力
 * - 摘要含各條目的 revision gate（id + gate，不含 patch 內容）——
 *   前端的 ls 解鎖計數、query 隱藏過濾、更動通知水位三張嘴共用
 * - 不含條目完整內容（< 20kb 目標）——內容由前端按需抓頁面 JSON
 *   再以 revision resolver 抽 effective view
 *
 * 遍歷路徑與 scripts/generate-entity-keys.mjs 一致：
 * - dossier: variants[*].subcategories[*].groups[*].entries
 * - browser: profiles
 * - chrono:  periods（entityKey 選用；ls clock 是否顯示由前端決定）
 * - diff:    subcategories[*].sections[*].entries
 */

// ===== 回應形狀 =====

/** 單一 revision 的 gate 摘要（不含 patch） */
export interface RevisionGateSummary {
  id: string;
  gate: unknown;
}

/** 索引中的單筆條目摘要 */
export interface EntityIndexEntry {
  /** 顯示名稱（dossier/browser 為 name、diff 為 term、chrono 為 title/year） */
  name: string;
  /** 來源 stack（metadata.stack_style 原值） */
  stack: 'dossier' | 'browser' | 'chrono' | 'diff';
  /** 來源頁面 id（`concepts/...`，前端以此抓完整頁 JSON） */
  pageId: string;
  /** 來源頁面標題（Terminal 顯示落點用） */
  pageTitle: string;
  /** 跨 stack 穩定識別碼（有 = 可深連 + 更動通知） */
  entityKey?: string;
  /** revision gate 摘要（條目有 revision 鏈才有） */
  revisionGates?: RevisionGateSummary[];
}

// ===== 內部工具 =====

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 從條目物件抽出 entityKey / revisionGates（共用形狀 WithRevision） */
function withRevisionFields(
  entry: Dict
): Pick<EntityIndexEntry, 'entityKey' | 'revisionGates'> {
  const out: Pick<EntityIndexEntry, 'entityKey' | 'revisionGates'> = {};
  if (typeof entry.entityKey === 'string' && entry.entityKey) {
    out.entityKey = entry.entityKey;
  }
  const revisions = asArray(entry.revisions)
    .map(asDict)
    .filter((r): r is Dict => r !== null);
  if (revisions.length > 0) {
    out.revisionGates = revisions.map((r) => ({
      id: typeof r.id === 'string' ? r.id : '',
      gate: r.gate ?? null,
    }));
  }
  return out;
}

/** 解析頁面 content（ContentBlock[]）中的結構化 JSON 區塊 */
function parseStructuredBlock(contentJson: string): Dict | null {
  let blocks: unknown;
  try {
    blocks = JSON.parse(contentJson);
  } catch {
    return null;
  }
  const block = asArray(blocks)
    .map(asDict)
    .find((b) => b !== null && b.type !== 'rich_text');
  if (!block || typeof block.content !== 'string') return null;
  try {
    return asDict(JSON.parse(block.content));
  } catch {
    return null;
  }
}

/** 收集單頁所有條目摘要 */
function collectFromPage(
  data: Dict,
  stack: EntityIndexEntry['stack'],
  pageId: string,
  pageTitle: string
): EntityIndexEntry[] {
  const out: EntityIndexEntry[] = [];
  const push = (name: unknown, entry: Dict) => {
    if (typeof name !== 'string' || !name.trim()) return;
    out.push({
      name: name.trim(),
      stack,
      pageId,
      pageTitle,
      ...withRevisionFields(entry),
    });
  };

  if (stack === 'dossier') {
    for (const variant of asArray(data.variants).map(asDict)) {
      if (!variant) continue;
      for (const subcat of asArray(variant.subcategories).map(asDict)) {
        if (!subcat) continue;
        for (const group of asArray(subcat.groups).map(asDict)) {
          if (!group) continue;
          for (const entry of asArray(group.entries).map(asDict)) {
            if (entry) push(entry.name, entry);
          }
        }
      }
    }
  } else if (stack === 'browser') {
    for (const profile of asArray(data.profiles).map(asDict)) {
      if (profile) push(profile.name, profile);
    }
  } else if (stack === 'chrono') {
    for (const period of asArray(data.periods).map(asDict)) {
      if (period) push(period.title || period.year, period);
    }
  } else if (stack === 'diff') {
    for (const subcat of asArray(data.subcategories).map(asDict)) {
      if (!subcat) continue;
      for (const section of asArray(subcat.sections).map(asDict)) {
        if (!section) continue;
        for (const entry of asArray(section.entries).map(asDict)) {
          if (entry) push(entry.term, entry);
        }
      }
    }
  }

  return out;
}

const STACK_STYLES: EntityIndexEntry['stack'][] = [
  'dossier',
  'browser',
  'chrono',
  'diff',
];

// ===== 主函式 =====

/**
 * 建立 Concepts 條目索引：單次 D1 掃描 concepts 全區頁面，
 * 逐頁解析 content JSON 並彙整條目摘要。
 *
 * 無 stack_style 的頁面（homepage / stack 容器）直接略過；
 * 解析失敗的頁面靜默跳過（索引是輔助功能，容錯優先）。
 */
export async function buildConceptsEntityIndex(
  db: D1Database
): Promise<EntityIndexEntry[]> {
  const result = await db
    .prepare(
      `SELECT id, title, content, metadata FROM pages
       WHERE area = 'concepts' AND deleted_at IS NULL
       ORDER BY sort_order ASC`
    )
    .all<{ id: string; title: string; content: string; metadata: string }>();

  const entries: EntityIndexEntry[] = [];
  for (const row of result.results || []) {
    let metadata: Dict | null = null;
    try {
      metadata = asDict(JSON.parse(row.metadata));
    } catch {
      continue;
    }
    const stack = metadata?.stack_style;
    if (
      typeof stack !== 'string' ||
      !STACK_STYLES.includes(stack as EntityIndexEntry['stack'])
    ) {
      continue;
    }
    const data = parseStructuredBlock(row.content);
    if (!data) continue;
    entries.push(
      ...collectFromPage(
        data,
        stack as EntityIndexEntry['stack'],
        row.id,
        row.title
      )
    );
  }
  return entries;
}
