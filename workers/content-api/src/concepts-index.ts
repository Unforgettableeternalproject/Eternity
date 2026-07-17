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
  /** 匹配別名（S7-D-2：編輯器選填，自動偵測 + terminal query 兩用） */
  aliases?: string[];
  /** base 解鎖條件（S7 驗收 #4：條目可見性的唯一閘門，未設 = 永遠可見） */
  baseGate?: unknown;
  /** 群組解鎖條件（S7 驗收 #3：dossier 群組層，未過整組隱藏） */
  groupGate?: unknown;
  /** revision gate 摘要（條目有 revision 鏈才有；只供更動通知水位，不影響可見性） */
  revisionGates?: RevisionGateSummary[];
  /** 分類標籤（dossier=subcategory label、diff=subcat label）——ls 分組用 */
  category?: string;
  /** 群組標籤（dossier=group label、diff=section label） */
  group?: string;
  /** dossier variant id（era，如 'u'） */
  variantId?: string;
  /** chrono period 的事件總數（ls clock 顯著時代排序用） */
  eventCount?: number;
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

/** 從條目物件抽出 entityKey / aliases / baseGate / revisionGates（共用形狀 WithRevision + S7-D aliases） */
function withRevisionFields(
  entry: Dict
): Pick<
  EntityIndexEntry,
  'entityKey' | 'aliases' | 'baseGate' | 'revisionGates'
> {
  const out: Pick<
    EntityIndexEntry,
    'entityKey' | 'aliases' | 'baseGate' | 'revisionGates'
  > = {};
  if (typeof entry.entityKey === 'string' && entry.entityKey) {
    out.entityKey = entry.entityKey;
  }
  // base 解鎖條件（S7 驗收 #4）——null 視為無條件，不進摘要
  // （舊 baseVisible 欄位已廢除，2026-07-17：無 baseGate 即永遠可見）
  if (entry.gate != null && typeof entry.gate === 'object') {
    out.baseGate = entry.gate;
  }
  const aliases = asArray(entry.aliases).filter(
    (a): a is string => typeof a === 'string' && a.trim().length > 0
  );
  if (aliases.length > 0) out.aliases = aliases;
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

/** 取字串欄位（空字串視為無值） */
function asLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** chrono period 的事件總數（flat items + grouped items 合計） */
function countChronoEvents(period: Dict): number {
  const fields = asDict(period.fields);
  if (!fields) return 0;
  let count = 0;
  for (const field of Object.values(fields).map(asDict)) {
    if (!field) continue;
    count += asArray(field.items).length;
    for (const group of asArray(field.groups).map(asDict)) {
      if (group) count += asArray(group.items).length;
    }
  }
  return count;
}

/** 收集單頁所有條目摘要 */
function collectFromPage(
  data: Dict,
  stack: EntityIndexEntry['stack'],
  pageId: string,
  pageTitle: string
): EntityIndexEntry[] {
  const out: EntityIndexEntry[] = [];
  const push = (
    name: unknown,
    entry: Dict,
    extra?: Partial<EntityIndexEntry>
  ) => {
    if (typeof name !== 'string' || !name.trim()) return;
    out.push({
      name: name.trim(),
      stack,
      pageId,
      pageTitle,
      ...withRevisionFields(entry),
      ...extra,
    });
  };

  if (stack === 'dossier') {
    for (const variant of asArray(data.variants).map(asDict)) {
      if (!variant) continue;
      for (const subcat of asArray(variant.subcategories).map(asDict)) {
        if (!subcat) continue;
        for (const group of asArray(subcat.groups).map(asDict)) {
          if (!group) continue;
          // 群組解鎖條件（S7 驗收 #3）：帶進每筆條目摘要，
          // 前端未解鎖過濾據此整組隱藏（名稱不洩漏）
          const groupGate =
            group.gate != null && typeof group.gate === 'object'
              ? group.gate
              : undefined;
          for (const entry of asArray(group.entries).map(asDict)) {
            if (entry) {
              push(entry.name, entry, {
                category: asLabel(subcat.label),
                group: asLabel(group.label),
                variantId: asLabel(variant.id),
                ...(groupGate !== undefined ? { groupGate } : {}),
              });
            }
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
      if (period) {
        push(period.title || period.year, period, {
          eventCount: countChronoEvents(period),
        });
      }
    }
  } else if (stack === 'diff') {
    for (const subcat of asArray(data.subcategories).map(asDict)) {
      if (!subcat) continue;
      for (const section of asArray(subcat.sections).map(asDict)) {
        if (!section) continue;
        for (const entry of asArray(section.entries).map(asDict)) {
          // hidden = 故事中尚未出現的概念——不進索引（名稱也不洩漏）；
          // locked（已出現未解釋）照常納入，由 Terminal 顯示 restricted
          if (entry && entry.hidden !== true) {
            push(entry.term, entry, {
              category: asLabel(subcat.label),
              group: asLabel(section.label),
            });
          }
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

/** buildConceptsEntityIndex 選項 */
export interface BuildConceptsEntityIndexOptions {
  /**
   * 只納入公開頁面（排除 `metadata.hidden`/`metadata.locked`）。
   *
   * 預設 `false` —— 保持 `/api/concepts/entity-index` 原有行為：Terminal Island
   * 前端依 gate 邏輯自行處理 hide/lock，索引本身是通用來源。
   *
   * `true` 用於 widget/Discord 統計等「僅公開內容」口徑，讓 count 與其它 zone
   * 統計保持一致（hidden/locked 一律不算）。
   */
  publicOnly?: boolean;
}

/**
 * 建立 Concepts 條目索引：單次 D1 掃描 concepts 全區頁面，
 * 逐頁解析 content JSON 並彙整條目摘要。
 *
 * 無 stack_style 的頁面（homepage / stack 容器）直接略過；
 * 解析失敗的頁面靜默跳過（索引是輔助功能，容錯優先）。
 */
export async function buildConceptsEntityIndex(
  db: D1Database,
  opts: BuildConceptsEntityIndexOptions = {}
): Promise<EntityIndexEntry[]> {
  // publicOnly=true 時 SQL 端就排掉 hidden/locked 頁，讓下游 collectFromPage
  // 完全不看到這些頁的 entity（比事後過濾乾淨，也省 parse 成本）
  const visibleClause = opts.publicOnly
    ? `AND COALESCE(json_extract(metadata, '$.hidden'), 0) != 1
       AND COALESCE(json_extract(metadata, '$.locked'), 0) != 1`
    : '';

  const result = await db
    .prepare(
      `SELECT id, title, content, metadata FROM pages
       WHERE area = 'concepts' AND deleted_at IS NULL ${visibleClause}
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
