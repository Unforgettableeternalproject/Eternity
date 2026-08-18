/**
 * concepts-bindings.ts — Concepts dossier 綁定鏈掃描
 *
 * entity 一對多內容綁定（2026-08-15 定案）：一個 entityKey 在同一個 zone
 * 可以對應多筆內容（例如角色轉正前後各一首主題曲），由 Concepts dossier
 * 條目決定「此刻該給哪一個」——初始指向放在條目層級的 `bindings`，
 * revision 的 patch 不改內容、只改指向：
 *
 *   entry.bindings = { echoes: 'echoes/...' }                            // 初始
 *   { id: 'xxx:turned', gate: {...}, patch: { set: { 'bindings.echoes': 'echoes/...' } } }
 *
 * 兩個地方都要掃：只綁一個內容的實體不會有任何 revision。
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

  return readBindingValue(asDict(set.bindings), zone);
}

/** 從一個 bindings 物件讀出某個 zone 的指向（條目層級與巢狀 patch 共用） */
function readBindingValue(
  bindings: Dict | null,
  zone: 'echoes' | 'visuals'
): string | null {
  const value = bindings?.[zone];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 掃描一頁的條目，把綁定登記併進 `index`。
 *
 * **只收 dossier。** dossier 是實體的唯一權威來源，綁定只能掛在這裡；
 * browser 是角色的詳細內容，與綁定無關。掃描端若把 browser 也收進來，
 * 會出現「求值端只讀 dossier、把關端卻認 browser」的分岔——browser 上
 * 寫一筆綁定就能放行撞名，但那筆綁定 runtime 永遠不會被消費。
 */
function collectPageBindings(
  data: Dict,
  stack: ConceptsStack,
  index: Map<string, ConceptsBindingEntry>
): void {
  if (stack !== 'dossier') return;

  forEachConceptsEntry(data, stack, (visit) => {
    const entityKey = visit.entry.entityKey;
    if (typeof entityKey !== 'string' || !entityKey.trim()) return;
    const key = entityKey.trim();

    const record = (echoesId: string | null, visualsId: string | null) => {
      if (!echoesId && !visualsId) return;
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
    };

    // 條目層級的初始指向先進（宣告順序與求值順序一致）
    const base = asDict(visit.entry.bindings);
    record(readBindingValue(base, 'echoes'), readBindingValue(base, 'visuals'));

    for (const revision of asArray(visit.entry.revisions).map(asDict)) {
      if (!revision) continue;
      record(
        extractBinding(revision.patch, 'echoes'),
        extractBinding(revision.patch, 'visuals')
      );
    }
  });
}

/**
 * 建立全站的 entityKey → 綁定登記索引：單次 D1 掃描 concepts 全區頁面。
 *
 * 無 stack_style 的頁面（homepage / stack 容器）略過；壞 JSON 靜默跳過
 * （沿用其餘索引建構器的容錯風格，一頁壞資料不該打掉整個把關路徑）。
 *
 * 條目層級 `bindings` 與 revision patch 都沒登記綁定的 entityKey
 * **不會出現在回傳的 Map 裡**——「不在 Map 中」即「未登記綁定」，
 * 撞名把關據此維持原有 409。
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
    if (stack !== 'dossier') continue;

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
