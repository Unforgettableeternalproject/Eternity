/**
 * concepts-bindings.ts — Concepts dossier 綁定鏈掃描
 *
 * entity 一對多內容綁定（2026-08-15 定案）：一個 entityKey 在同一個 zone
 * 可以對應多筆內容（例如角色轉正前後各一首主題曲），由 Concepts dossier
 * 條目的 revision 鏈決定「此刻該給哪一個」——revision 的 patch 不改內容，
 * 只改指向：
 *
 *   { id: 'base',       gate: null,  patch: { set: { 'bindings.echoes': 'echoes/...' } } }
 *   { id: 'xxx:turned', gate: {...}, patch: { set: { 'bindings.echoes': 'echoes/...' } } }
 *
 * base（尚未通過任何 gate 時的預設）就是鏈上 `gate: null` 的那一條——
 * `ConceptsRevision.gate` 本來就允許 null 表示無條件（見 concepts/types.ts
 * 的欄位說明，id 慣例 'base'），因此**不需要在條目層另開 bindings 欄位**，
 * 掃描端只看 revisions 一個地方。
 *
 * 本模組只回答「哪些 entityKey 登記過綁定、指向哪些 id」，**不做求值**
 * ——求值需要讀者進度，那是前端的事（apps/uep 的 entityBinding.ts）。
 * 這裡的用途是伺服器端的撞名把關例外（interlink.ts 的 findKeyConflict）
 * 與 admin 面板。
 *
 * ⚠️ **回傳值含 revision patch 的內容，不可直接對外公開。** patch 裡的
 * 綁定值是尚未解鎖內容的 page id（slug 即歌名／畫廊名），對外洩漏等同
 * 劇透——這與 concepts-index 的 `revisionGates` 刻意只帶 id+gate 是同一個
 * 理由。要暴露給 admin 需經授權端點（/api/concepts/bound-keys）。
 */

import {
  forEachConceptsEntry,
  parseStructuredBlock,
  type ConceptsStack,
} from './concepts-index';

/** 單一 entityKey 的綁定登記結果 */
export interface ConceptsBindingEntry {
  /** 該 entityKey 在 Echoes 被登記指向的所有頁面 id（宣告順序，可能重複值已去重） */
  echoesIds: string[];
  /** 該 entityKey 在 Visuals 被登記指向的所有頁面 id */
  visualsIds: string[];
}

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 從單一 revision 的 patch 抽出某個 zone 的綁定值。
 *
 * **兩種寫法都要認**：
 * - dot-path key：`set: { 'bindings.echoes': 'echoes/...' }`（picker 產出的形式）
 * - 巢狀物件：`set: { bindings: { echoes: 'echoes/...' } }`（整段替換 bindings）
 *
 * 前端的 `applyRevisions` 對兩種都會生效（`applyDotPath` 處理 dot-notation、
 * 巢狀物件是一般的整段 set），掃描端只認一種就會與求值端漂移——
 * 症狀是「編輯器存得下去、409 卻照擋」或反之。
 */
function extractBinding(
  patch: unknown,
  zone: 'echoes' | 'visuals'
): string | null {
  const set = asDict(asDict(patch)?.set);
  if (!set) return null;

  const dotted = set[`bindings.${zone}`];
  if (typeof dotted === 'string' && dotted.trim()) return dotted.trim();

  const nested = asDict(set.bindings);
  const value = nested?.[zone];
  if (typeof value === 'string' && value.trim()) return value.trim();

  return null;
}

/**
 * 掃描一頁的條目，把綁定登記併進 `index`。
 *
 * 只收 dossier 與 browser——與 entityKey 身分體系的範圍一致
 * （concepts-index 的 `includeIdentity` 白名單同一條規則）。
 * 注意 browser 條目的綁定**也會被收進來**：本函式回答的是「這個 entityKey
 * 登記過綁定嗎」，用於撞名放行；前端求值時才依「dossier 優先於 browser」
 * 挑出權威的那一條。兩者用途不同，不可混淆。
 */
function collectPageBindings(
  data: Dict,
  stack: ConceptsStack,
  index: Map<string, ConceptsBindingEntry>
): void {
  if (stack !== 'dossier' && stack !== 'browser') return;

  forEachConceptsEntry(data, stack, (visit) => {
    const entityKey = visit.entry.entityKey;
    if (typeof entityKey !== 'string' || !entityKey.trim()) return;
    const key = entityKey.trim();

    for (const revision of asArray(visit.entry.revisions).map(asDict)) {
      if (!revision) continue;
      const echoesId = extractBinding(revision.patch, 'echoes');
      const visualsId = extractBinding(revision.patch, 'visuals');
      if (!echoesId && !visualsId) continue;

      let bucket = index.get(key);
      if (!bucket) {
        bucket = { echoesIds: [], visualsIds: [] };
        index.set(key, bucket);
      }
      if (echoesId && !bucket.echoesIds.includes(echoesId)) {
        bucket.echoesIds.push(echoesId);
      }
      if (visualsId && !bucket.visualsIds.includes(visualsId)) {
        bucket.visualsIds.push(visualsId);
      }
    }
  });
}

/**
 * 建立全站的 entityKey → 綁定登記索引：單次 D1 掃描 concepts 全區頁面。
 *
 * 無 stack_style 的頁面（homepage / stack 容器）略過；壞 JSON 靜默跳過
 * （沿用其餘索引建構器的容錯風格，一頁壞資料不該打掉整個把關路徑）。
 *
 * 沒有任何 revision 登記綁定的 entityKey **不會出現在回傳的 Map 裡**
 * ——「不在 Map 中」即「未登記多重綁定」，撞名把關據此維持原有 409。
 */
export async function buildConceptsBindingIndex(
  db: D1Database
): Promise<Map<string, ConceptsBindingEntry>> {
  // SQL 只篩結構性欄位，metadata 判定放應用層——SQLite 的 json_extract
  // 遇到非法 JSON 會讓整條 SELECT 報錯而非回傳 NULL（S8 驗收 #2 教訓）。
  const result = await db
    .prepare(
      `SELECT id, content, metadata FROM pages
       WHERE area = 'concepts' AND deleted_at IS NULL
       ORDER BY sort_order ASC`
    )
    .all<{ id: string; content: string; metadata: string }>();

  const index = new Map<string, ConceptsBindingEntry>();
  for (const row of result.results || []) {
    let metadata: Dict | null = null;
    try {
      metadata = asDict(JSON.parse(row.metadata));
    } catch {
      continue;
    }
    const stack = metadata?.stack_style;
    if (stack !== 'dossier' && stack !== 'browser') continue;

    const data = parseStructuredBlock(row.content);
    if (!data) continue;
    collectPageBindings(data, stack, index);
  }
  return index;
}

/**
 * 這個 entityKey 是否登記過**任何**綁定（不論指向哪一個 id）。
 *
 * 撞名把關的例外判定用的就是這一條，刻意**不逐 id 比對**：新頁尚未存檔時
 * 當然不可能已經被 Concepts revision 引用（雞生蛋），要求它出現在綁定清單
 * 裡會讓第二首歌永遠存不進去。語意是「這個 entityKey 是刻意多綁定的」，
 * 而不是「這一頁已經被登記」。
 */
export function hasRegisteredBinding(
  index: Map<string, ConceptsBindingEntry>,
  entityKey: string,
  area: 'echoes' | 'visuals'
): boolean {
  const bucket = index.get(entityKey);
  if (!bucket) return false;
  return area === 'echoes'
    ? bucket.echoesIds.length > 0
    : bucket.visualsIds.length > 0;
}
