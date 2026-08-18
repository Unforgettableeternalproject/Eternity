/**
 * entityBinding.ts — entity 一對多內容綁定的求值（2026-08-15 定案）
 *
 * 一個 entityKey 在同一個 zone 可以對應多筆內容（角色轉正前後各一首主題曲），
 * 由 Concepts dossier 條目的 revision 鏈決定「此刻該給哪一個」——revision 的
 * patch 不改內容、只改指向。初始指向放在條目層級的 `bindings`，
 * revision 之後才依進度覆蓋：
 *
 *   entry.bindings = { echoes: '...' }                                   // 初始
 *   { id: 'xxx:turned', gate: {...}, patch: { set: { 'bindings.echoes': '...' } } }
 *
 * 只綁一個內容的實體填 `bindings` 就結束，不需要任何 revision。
 *
 * 求值走既有的 `applyRevisions`（累加式，後者覆蓋前者），所以「直到下一個
 * revision 通過為止」是鏈的順序天然表達的，不需要 until 條件。
 *
 * 求值在前端而不在 worker：需要讀者進度，而 worker 是無狀態的。
 *
 * ## 指向與可見性正交
 *
 * 本模組只回答「此刻該指向哪一個」，不回答「讀者看不看得到」。求出的內容
 * 仍由它自己的 gate/locked 與 spoiler 降級鏈決定顯示與否——revision 已經
 * 指到某首歌、但那首歌尚未解鎖，是合法且預期會發生的狀態，下游照擋，
 * 不會因為被指向就協同解鎖。
 *
 * 反過來也一樣：**不可以拿內容自身的 gate 來挑指向**。那會讓「綁著但還沒
 * 解鎖」無法表達，等於把兩個正交的軸焊死。
 *
 * ## 為什麼不共用 terminalCore 的快取
 *
 * `islands/concepts/terminalCore.ts` 已有等價的索引／頁面快取，但那是
 * **islands 層**——本模組在 components 層，且消費端同時有 islands（IslandHost）
 * 與編輯器（components/editor）。讓 components 反向 import islands 會讓依賴
 * 方向不清楚，故各自持有一份輕量快取。索引 < 20kb 且兩邊都是模組級快取，
 * 重複一次 fetch 的代價遠低於依賴倒置。
 */

import { getApiBase } from '../../lib/apiBase';
import type { ProgressState } from '../../progress/types';

import { applyRevisions } from './revision';
import type { ConceptsRevision } from './types';

const API_BASE = getApiBase();

/** 索引端點的單筆條目摘要（只取本模組需要的欄位） */
interface BindingIndexEntry {
  stack: 'dossier' | 'browser' | 'chrono' | 'diff';
  pageId: string;
  entityKey?: string;
}

let indexCache: Promise<BindingIndexEntry[]> | null = null;
const pageCache = new Map<string, Promise<unknown>>();

/** 清空快取（測試與資料端更新後重抓用） */
export function invalidateEntityBindingCache(): void {
  indexCache = null;
  pageCache.clear();
}

/** 載入 Concepts 條目索引（模組級快取；失敗時清快取讓下次重試） */
function loadIndex(): Promise<BindingIndexEntry[]> {
  if (!indexCache) {
    indexCache = (async () => {
      const res = await fetch(`${API_BASE}/api/concepts/entity-index`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: { entries?: BindingIndexEntry[] };
      };
      if (!json.ok) throw new Error('API returned ok=false');
      return json.data?.entries || [];
    })().catch((err) => {
      indexCache = null;
      throw err;
    });
  }
  return indexCache;
}

/** 抓取單頁 Concepts 結構化資料（模組級快取） */
function loadPageData(pageId: string): Promise<unknown> {
  let cached = pageCache.get(pageId);
  if (!cached) {
    cached = (async () => {
      const res = await fetch(`${API_BASE}/api/content/${pageId}`);
      if (!res.ok) return null;
      const json = (await res.json()) as {
        ok: boolean;
        data?: { content?: { type: string; content: string }[] };
      };
      if (!json.ok) return null;
      const block = (json.data?.content || []).find(
        (b) => b && b.type !== 'rich_text'
      );
      if (!block || typeof block.content !== 'string') return null;
      try {
        return JSON.parse(block.content);
      } catch {
        return null;
      }
    })().catch(() => {
      pageCache.delete(pageId);
      return null;
    });
    pageCache.set(pageId, cached);
  }
  return cached;
}

/**
 * 這個 entityKey 有沒有對應的 **dossier** 條目。
 *
 * 孤兒判定（2026-08-15 定案）：dossier 是實體的唯一權威來源，沒有條目就
 * 沒有實體。**browser 條目不算數**——browser 只是詳細內容，不能替代
 * dossier 的「存在」。
 *
 * ⚠️ 判的是**存在性不是可見性**：dossier 條目可以有 baseGate，若這裡改成
 * 「查得到可見條目」，讀者沒解鎖角色檔案時該角色的歌／畫廊會一起查不到，
 * entity 反查就變成 Concepts 解鎖進度的附庸——與 2026-07-17 定案的
 * 「revision 只控制內容演進、不控制可見性」直接牴觸。
 *
 * ⚠️ 孤兒**只是無法對應**，不是不能顯示：歌曲／畫廊本身的可見性與解鎖
 * 完全照舊，由它自己的 gate/locked 決定，在自己 zone 的列表照常出現。
 */
export function hasDossierEntry(
  entityKey: string,
  index: readonly BindingIndexEntry[]
): boolean {
  return index.some((e) => e.stack === 'dossier' && e.entityKey === entityKey);
}

/** 從求值後的條目讀出某個 zone 的綁定指向 */
function readBinding(
  resolved: Record<string, unknown>,
  zone: 'echoes' | 'visuals'
): string | null {
  const bindings = resolved.bindings;
  if (!bindings || typeof bindings !== 'object') return null;
  const value = (bindings as Record<string, unknown>)[zone];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** 在一頁 Concepts 資料裡找出指定 entityKey 的 dossier 條目（可能多個 variant） */
function findDossierEntries(
  data: unknown,
  entityKey: string
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const variants = (data as { variants?: unknown })?.variants;
  if (!Array.isArray(variants)) return out;
  for (const variant of variants) {
    const subcats = (variant as { subcategories?: unknown })?.subcategories;
    if (!Array.isArray(subcats)) continue;
    for (const subcat of subcats) {
      const groups = (subcat as { groups?: unknown })?.groups;
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const entries = (group as { entries?: unknown })?.entries;
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (
            entry &&
            typeof entry === 'object' &&
            (entry as { entityKey?: unknown }).entityKey === entityKey
          ) {
            out.push(entry as Record<string, unknown>);
          }
        }
      }
    }
  }
  return out;
}

/**
 * 求出這個 entityKey 在指定 zone **此刻**該對應的內容 id。
 *
 * 回傳 `null` 有兩種成因，用途相同但語意不同：
 * 1. **孤兒**——沒有任何 dossier 條目（`hasDossierEntry` 為偽）
 * 2. 有 dossier 條目，但該 zone 沒有登記綁定（條目層與 revision 皆無）
 *
 * 兩者都不會去猜：沒綁就是沒綁，呼叫端自行退回 by-key 反查或不顯示。
 *
 * 呼叫端要區分時得自己再問一次 `hasDossierEntry`；本函式不區分回傳型別，
 * 因為兩種情況的處置一致（退回既有的 by-key 反查或不顯示）。
 *
 * 求值後只回**一個** id，未通過 gate 的 revision 指向的內容不會外流——
 * 這是本設計優於「回傳候選陣列讓前端挑」的關鍵。
 */
export async function resolveEntityBinding(
  entityKey: string,
  zone: 'echoes' | 'visuals',
  progress: ProgressState
): Promise<{ id: string } | null> {
  if (!entityKey) return null;

  let index: BindingIndexEntry[];
  try {
    index = await loadIndex();
  } catch {
    // 索引拿不到時退回既有路徑（呼叫端的 by-key fallback），不是失敗
    return null;
  }

  // 孤兒判定優先於一切：一筆 dossier 條目都沒有就到此為止，
  // 不再看 browser、不再看 revisions
  if (!hasDossierEntry(entityKey, index)) return null;

  // dossier 優先於 browser（2026-08-15 定案）：browser 只是詳細內容。
  // 正式站的 xavier-colsono 目前就同時掛在兩邊。
  const candidatePages = index
    .filter((e) => e.stack === 'dossier' && e.entityKey === entityKey)
    .map((e) => e.pageId);

  for (const pageId of Array.from(new Set(candidatePages))) {
    const data = await loadPageData(pageId);
    if (!data) continue;

    for (const entry of findDossierEntries(data, entityKey)) {
      const revisions = entry.revisions as ConceptsRevision[] | undefined;

      // 沒有 revision 鏈也要求值：條目層級的 `bindings` 是初始指向，
      // 只綁一首歌的實體不該被迫開一條 gate: null 的 revision 來表達。
      // applyRevisions 由 base 的 structuredClone 起手，空鏈時就是原樣回傳。

      // ⚠️ 這裡**刻意不檢查 isEntryUnlocked**（2026-08-15 定案規則二）。
      // 條目本身是否被讀者解鎖與「這個綁定要不要生效」無關；下游反查回
      // 的歌曲／畫廊仍依它自己的 gate/locked 決定顯示與否——鎖定內容不
      // 外洩的把關在下游，不在這裡重複做。
      const resolved = applyRevisions(entry, revisions, progress);
      const id = readBinding(resolved, zone);
      if (id) return { id };
    }
  }

  return null;
}

/**
 * `hasDossierEntry` 的非同步版本——呼叫端只有 entityKey、手上沒有索引時用
 * （編輯器孤兒警示、admin 巡查）。索引取不到時保守回 `true`，
 * 避免網路失敗被誤報成「這個 key 是孤兒」。
 */
export async function isOrphanEntityKey(entityKey: string): Promise<boolean> {
  if (!entityKey) return false;
  try {
    const index = await loadIndex();
    return !hasDossierEntry(entityKey, index);
  } catch {
    return false;
  }
}
