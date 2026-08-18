/**
 * Concepts Revision 系統 — Effective View Resolver（Epic 2 S7）
 *
 * 純函式層：把「條目 + revision 鏈 + 進度狀態」解析成讀者當下
 * 應看到的內容（effective view）。不碰 React、不碰 DOM、不快取——
 * 快取見 revisionCache.ts，React 接線見 ConceptsReader。
 *
 * 語意（設計文件 docs/agent/S7_CONCEPTS_DESIGN.md）：
 * - Revision 是 patch 不是 append：set 整段替換欄位、remove 刪除欄位
 * - 按宣告順序套用所有 gate 通過的 revision，結果確定性（亂序防禦：
 *   不排序、不跳過中段，通過就套）
 * - gate 求值走 evaluateGate（觀測者 bypass requiresFlags、
 *   pristineOnly 不 bypass 的既有語意全部繼承）
 * - 未解鎖條目 = 隱藏（Browser placeholder 佔位為刻意例外，
 *   由資料端以 placeholder 欄位表達，不在 resolver 特判）
 */

/* global structuredClone */

import { evaluateGate } from '../../progress/gating';
import type { GateCondition } from '../../progress/gating';
import type { ProgressState } from '../../progress/types';

import type {
  BrowserContent,
  ChronoContent,
  ConceptsData,
  ConceptsRevision,
  DiffContent,
  DossierContent,
  RevisionPatch,
} from './types';

// ── dot-notation path 工具 ─────────────────────────────────────────

/** prototype 污染防禦：這些 key 不允許出現在 patch 路徑中 */
const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** 解析並驗證 dot path；含污染 key 時回傳 null（整段操作跳過） */
function parsePath(path: string): string[] | null {
  if (!path) return null;
  const segments = path.split('.');
  for (const seg of segments) {
    if (!seg || FORBIDDEN_PATH_KEYS.has(seg)) return null;
  }
  return segments;
}

/**
 * 沿 dot path 設值（如 'basic.種族' → obj.basic['種族']）。
 * 中間節點不存在時建立空物件；中間節點不是物件/陣列時放棄（不覆蓋）。
 * 陣列索引以數字字串表達（如 'sections.0.content_html'）。
 */
export function applyDotPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const segments = parsePath(path);
  if (!segments) return;

  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = (cursor as Record<string, unknown>)[seg];
    if (next === null || typeof next !== 'object') {
      if (next === undefined) {
        const created: Record<string, unknown> = {};
        cursor[seg] = created;
        cursor = created;
        continue;
      }
      return; // 中間節點是 primitive，放棄本次操作
    }
    cursor = next as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

/** 沿 dot path 刪除欄位；路徑不存在時安靜跳過 */
export function removeDotPath(
  obj: Record<string, unknown>,
  path: string
): void {
  const segments = parsePath(path);
  if (!segments) return;

  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cursor[segments[i]];
    if (next === null || typeof next !== 'object') return;
    cursor = next as Record<string, unknown>;
  }
  delete cursor[segments[segments.length - 1]];
}

// ── revision 求值核心 ──────────────────────────────────────────────

/**
 * 對單一條目計算 effective view。
 *
 * @param base      條目原始資料（含 entityKey/revisions 欄位也無妨，
 *                  輸出會剝除 revisions 避免下游誤用）
 * @param revisions revision 鏈（宣告順序）
 * @param progress  目前進度狀態
 * @returns         套用所有通過 gate 的 revision patch 後的新物件
 *                  （deep clone，不修改原始資料）
 */
export function applyRevisions<T extends Record<string, unknown>>(
  base: T,
  revisions: ConceptsRevision[] | undefined,
  progress: ProgressState
): T {
  const clone = structuredClone(base);
  if (!revisions || revisions.length === 0) return clone;

  for (const revision of revisions) {
    if (!evaluateGate(progress, revision.gate)) continue;
    applyPatch(clone, revision.patch);
  }
  return clone;
}

/** 把單一 patch 就地套到目標物件上（remove 先於 set，與宣告語意一致） */
function applyPatch(
  target: Record<string, unknown>,
  patch: RevisionPatch | undefined
): void {
  if (!patch) return;
  if (Array.isArray(patch.remove)) {
    for (const path of patch.remove) {
      if (typeof path === 'string') removeDotPath(target, path);
    }
  }
  if (patch.set && typeof patch.set === 'object') {
    for (const [path, value] of Object.entries(patch.set)) {
      // value 也 clone：防止多條目共用 patch 物件時的引用共用
      applyDotPath(target, path, structuredClone(value));
    }
  }
}

/** 結構相等比較（key 順序無關；patch 值只有 JSON 型別） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k]
      )
  );
}

/**
 * 這一條 revision 套下去有沒有真的改到東西（編輯器的空轉警示用）。
 *
 * 判定方式是**比較結果而非比較 patch**：把前面所有 revision 無條件疊完
 * 當作「上一個版本」，再看套上這一條之後有沒有變化。兩種空轉因此用同一
 * 條規則涵蓋——patch 全空，以及 patch 設的值與上一版本相同。
 *
 * ⚠️ 前置 revision 一律無條件套用（不看 gate）：這裡問的是「宣告鏈上相鄰
 * 兩版有沒有差異」，而 gate 是讀者側的時機問題。若改成依某個進度求值，
 * 同一條 revision 會依模擬進度時而警示時而不警示——編輯期的靜態檢查
 * 不該有這種不確定性。
 *
 * 只是提示，不阻擋：空轉 revision 有合法用途（佔位、先建 id 之後再補
 * 內容），擋下來會擋掉正常的編輯流程。
 */
export function isNoOpRevision(
  base: Record<string, unknown>,
  revisions: ConceptsRevision[] | undefined,
  index: number
): boolean {
  if (!revisions || index < 0 || index >= revisions.length) return false;

  const previous = structuredClone(base);
  for (let i = 0; i < index; i++) applyPatch(previous, revisions[i].patch);

  const next = structuredClone(previous);
  applyPatch(next, revisions[index].patch);

  return deepEqual(previous, next);
}

/**
 * 條目是否已解鎖（「未解鎖條目 = 隱藏」的守門判定）。
 *
 * 2026-07-17 語意修正（艾斯維爾定案）：**條目可見性由 baseGate 單獨
 * 決定**——revision gate 只控制 patch 的套用時機，對條目本身的可見性
 * 零影響（不能鎖住條目、也不能反向開鎖）。
 *
 * - 無 baseGate → 永遠可見（revision 只是後續內容演進）
 * - 有 baseGate → 通過即可見、未過即隱藏
 *
 * 取代的舊語意（S7 oversight，已作廢）：「無 baseGate 時首個 revision
 * 的 gate = 初次解鎖點」與「baseGate 未過但 revision 通過的後期揭露」
 * ——兩者都讓 revision 干涉條目可見性，與 baseGate 的設計初衷矛盾；
 * baseVisible 欄位是為該 oversight 打的補丁，隨之廢除。
 *
 * （觀測者 bypass requiresFlags 沿用 evaluateGate 語意；
 * pristineOnly 條目對觀測者/印記者依然隱藏）
 */
export function isEntryUnlocked(
  progress: ProgressState,
  baseGate?: GateCondition | null
): boolean {
  return evaluateGate(progress, baseGate ?? null);
}

// ── 頁面級 effective view ──────────────────────────────────────────

/**
 * ConceptsData union 的 type guard 群。
 *
 * union 無 discriminant 欄位，且 DossierContent 與 DiffContent 的
 * subcategories 同名——以「獨有的頂層/次層欄位」區分：
 * - dossier：variants（normalize 後必有）
 * - browser：profiles
 * - chrono：periods
 * - diff：subcategories 且首個 subcat 有 sections（dossier 的是 groups）
 */
export function isDossierContent(data: ConceptsData): data is DossierContent {
  return Array.isArray((data as DossierContent).variants);
}

export function isBrowserContent(data: ConceptsData): data is BrowserContent {
  return Array.isArray((data as BrowserContent).profiles);
}

export function isChronoContent(data: ConceptsData): data is ChronoContent {
  return Array.isArray((data as ChronoContent).periods);
}

export function isDiffContent(data: ConceptsData): data is DiffContent {
  const subcats = (data as DiffContent).subcategories;
  if (!Array.isArray(subcats)) return false;
  if (isDossierContent(data) || isBrowserContent(data) || isChronoContent(data))
    return false;
  // 空 subcategories 視為 diff（dossier 走 variants 分支不會到這）
  return subcats.every((s) => s && typeof s === 'object' && !('groups' in s));
}

/** 條目層通用處理：過濾未解鎖 + 套 patch + 剝除 revisions/gate（前台不需要） */
function resolveEntries<T extends Record<string, unknown>>(
  entries: T[],
  progress: ProgressState
): T[] {
  const out: T[] = [];
  for (const entry of entries) {
    const revisions = entry.revisions as ConceptsRevision[] | undefined;
    const baseGate = entry.gate as GateCondition | null | undefined;
    if (!isEntryUnlocked(progress, baseGate)) continue;
    const resolved = applyRevisions(entry, revisions, progress);
    delete (resolved as Record<string, unknown>).revisions;
    delete (resolved as Record<string, unknown>).gate;
    // baseVisible 為已廢除欄位（2026-07-17）——舊資料殘留照樣剝除
    delete (resolved as Record<string, unknown>).baseVisible;
    out.push(resolved);
  }
  return out;
}

/**
 * 對整頁 Concepts 資料計算 effective view：
 * 遍歷四種 stack 的條目路徑，過濾未解鎖條目並套用 patch。
 *
 * - dossier：variants[*].subcategories[*].groups[*].entries
 * - browser：profiles
 * - chrono：periods
 * - diff：subcategories[*].sections[*].entries
 *
 * 舊格式資料（條目無 revisions）原樣通過（僅 deep clone 開銷）。
 * 無法辨識的資料形狀原樣回傳（防禦：不讓壞資料炸掉 Reader）。
 */
export function resolveEffectiveViewForPage<D extends ConceptsData>(
  data: D,
  progress: ProgressState
): D {
  if (isDossierContent(data)) {
    const resolved: DossierContent = {
      ...data,
      variants: data.variants.map((variant) => ({
        ...variant,
        subcategories: variant.subcategories.map((subcat) => ({
          ...subcat,
          // 群組 gate（S7 驗收 #3）：未通過整組隱藏，條目層不再求值
          groups: subcat.groups
            .filter((group) => evaluateGate(progress, group.gate ?? null))
            .map((group) => ({
              ...group,
              entries: resolveEntries(
                group.entries as unknown as Record<string, unknown>[],
                progress
              ) as unknown as typeof group.entries,
            })),
        })),
      })),
    };
    return resolved as D;
  }

  if (isBrowserContent(data)) {
    const resolved: BrowserContent = {
      ...data,
      profiles: resolveEntries(
        data.profiles as unknown as Record<string, unknown>[],
        progress
      ) as unknown as typeof data.profiles,
    };
    return resolved as D;
  }

  if (isChronoContent(data)) {
    const resolved: ChronoContent = {
      ...data,
      periods: resolveEntries(
        data.periods as unknown as Record<string, unknown>[],
        progress
      ) as unknown as typeof data.periods,
    };
    return resolved as D;
  }

  if (isDiffContent(data)) {
    const resolved: DiffContent = {
      ...data,
      subcategories: data.subcategories.map((subcat) => ({
        ...subcat,
        sections: subcat.sections.map((section) => ({
          ...section,
          entries: resolveEntries(
            section.entries as unknown as Record<string, unknown>[],
            progress
          ) as unknown as typeof section.entries,
        })),
      })),
    };
    return resolved as D;
  }

  return data;
}
