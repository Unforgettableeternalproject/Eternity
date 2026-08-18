/**
 * entityBinding.ts — entity 一對多內容綁定的求值（2026-08-15 定案）
 *
 * 一個 entityKey 在同一個 zone 可以對應多筆內容（角色轉正前後各一首主題曲），
 * 由 Concepts dossier 條目決定「此刻該給哪一個」——初始指向放在條目層級的
 * `bindings`，revision 的 patch 不改內容、只改指向：
 *
 *   entry.bindings = { echoes: '...' }                                   // 初始
 *   { id: 'xxx:turned', gate: {...}, patch: { set: { 'bindings.echoes': '...' } } }
 *
 * 只綁一個內容的實體填 `bindings` 就結束，不需要任何 revision；同 key 在該
 * zone 只有一筆內容時連 `bindings` 都不必填（唯一候選即確定的對應）。
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
 * ## 同步與非同步兩個入口
 *
 * `resolveEntityBinding` 是 async 版（浮島點擊消費）；`resolveBindingSync`
 * 吃預載好的資料，供**渲染期的嵌入可點判定**用——後者必須與前者結論一致，
 * 否則會出現「看起來可點、按下去沒反應」。兩者共用 `resolveFromData`，
 * 邏輯只有一份。
 *
 * 資料來源集中在 `conceptsSource` 與 `lib/zoneEntityIndex`，與 Terminal 島
 * 共用同一份快取——可點判定要的資料就是 Terminal 本來就要載的那份，
 * 預載因此不產生額外請求（見 conceptsSource 檔頭）。
 */

import {
  invalidateZoneEntityIndex,
  loadZoneEntityIndex,
  soleEntityCandidate,
  type ZoneEntityIndexEntry,
} from '../../lib/zoneEntityIndex';
import type { ProgressState } from '../../progress/types';

import {
  loadConceptsIndex,
  loadConceptsPage,
  invalidateConceptsSource,
  type ConceptsIndexEntry,
} from './conceptsSource';
import { applyRevisions } from './revision';
import type { ConceptsRevision } from './types';

/** 清空求值用到的所有快取（測試與資料端更新後重抓用） */
export function invalidateEntityBindingCache(): void {
  invalidateConceptsSource();
  invalidateZoneEntityIndex();
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
  index: readonly ConceptsIndexEntry[]
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
 * 求值結果。
 *
 * ⚠️ **`error` 必須與 `unbound`／`orphan` 分開**：三者以前都壓成 `null`，
 * 而呼叫端對 `null` 一律退回 by-key 反查——於是 Concepts 索引或頁面抓取
 * 暫時失敗時，dossier 上寫好的明確指向會被繞過，改由 by-key 回傳任意一筆
 * 候選（worker 的 `findEntitySong` 是全表掃描命中第一筆，**無 `ORDER BY`**，
 * D1 未指定順序）。權威資料拿不到時只能 fail closed，不能猜。
 */
export type EntityBindingResult =
  /** dossier 明確指向這一筆，或該 zone 的唯一候選 */
  | { status: 'bound'; id: string }
  /** 有 dossier 條目，但該 zone 沒登記綁定且候選不只一筆 */
  | { status: 'unbound' }
  /** 沒有任何 dossier 條目——依定案這個 key 不是實體 */
  | { status: 'orphan' }
  /** 權威資料拿不到（索引／頁面 fetch 或解析失敗） */
  | { status: 'error' };

/** 求值需要的全部資料（同步與非同步入口共用） */
export interface BindingSource {
  /** Concepts 條目索引 */
  index: readonly ConceptsIndexEntry[];
  /** 已載入的 dossier 頁：pageId → 整頁 JSON（抓失敗的頁不放進來） */
  pages: ReadonlyMap<string, unknown>;
  /** 目標 zone 的 entity 索引（唯一候選判定用） */
  zoneEntries: readonly ZoneEntityIndexEntry[];
  /** 有 dossier 頁抓取失敗——找不到綁定時不能斷言「沒綁」 */
  partial?: boolean;
}

/**
 * 求值核心：三段式——dossier 的明確綁定 → 該 zone 的唯一候選 → 沒有對應。
 *
 * `bound` 以外的狀態呼叫端一律不該再自行反查——**尤其不可退回 by-key
 * 端點**。同 key 多筆時 by-key 會依 D1 未指定順序命中任意一筆，那正是
 * 「多筆候選就必須由 dossier 指明」這條契約要防的事（picker 的
 * 「多筆候選，將無對應」說的就是這個）。唯一候選的情況本函式已經
 * 直接回 `bound`，呼叫端沒有需要自己猜的餘地。
 *
 * 求值後只回**一個** id，未通過 gate 的 revision 指向的內容不會外流——
 * 這是本設計優於「回傳候選陣列讓前端挑」的關鍵。
 *
 * ⚠️ 已知限制（等 E/P 時代內容出現時才會碰到）：同一個 entityKey 可以在
 * 多個 dossier variant 各有條目、各自登記綁定（entityKey 唯一性只在
 * variant 內，見 ConceptsEditorBody 的說明）。此時本函式取**遍歷順序上
 * 第一個有綁定的**，順序由 Concepts 索引決定而非讀者的閱讀脈絡。正式站
 * 目前七頁都只有單一 variant（`u`），碰不到；要正確處理需要把時代脈絡
 * （History 的 zone ↔ dossier 的 variant id）傳進來。
 */
export function resolveFromData(
  source: BindingSource,
  entityKey: string,
  zone: 'echoes' | 'visuals',
  progress: ProgressState
): EntityBindingResult {
  if (!entityKey) return { status: 'orphan' };

  const sole = () => {
    const id = soleEntityCandidate(source.zoneEntries, entityKey);
    return id ? ({ status: 'bound', id } as const) : null;
  };

  // 孤兒判定優先於一切：一筆 dossier 條目都沒有就到此為止，不再看
  // browser、不再看 revisions。但「不是實體」不代表「沒有內容」——正式站
  // 多數 Echoes entity 都是孤兒，它們的歌照樣要能被反查到，走唯一候選
  if (!hasDossierEntry(entityKey, source.index)) {
    return sole() ?? { status: 'orphan' };
  }

  // dossier 優先於 browser（2026-08-15 定案）：browser 只是詳細內容。
  // 正式站的 xavier-colsono 目前就同時掛在兩邊。
  const candidatePages = source.index
    .filter((e) => e.stack === 'dossier' && e.entityKey === entityKey)
    .map((e) => e.pageId);

  for (const pageId of Array.from(new Set(candidatePages))) {
    const data = source.pages.get(pageId);
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
      if (id) return { status: 'bound', id };
    }
  }

  // 任何一頁權威資料抓不到就不能斷言「沒綁」——那一頁上可能正好有綁定。
  // 寧可 fail closed 也不能退回猜測
  if (source.partial) return { status: 'error' };

  return sole() ?? { status: 'unbound' };
}

/** 載入某個 entityKey 求值所需的全部資料（dossier 頁只抓相關的那幾頁） */
async function loadSource(
  entityKey: string,
  zone: 'echoes' | 'visuals'
): Promise<BindingSource> {
  const [index, zoneEntries] = await Promise.all([
    loadConceptsIndex(),
    loadZoneEntityIndex(zone),
  ]);
  const pageIds = Array.from(
    new Set(
      index
        .filter((e) => e.stack === 'dossier' && e.entityKey === entityKey)
        .map((e) => e.pageId)
    )
  );
  const pages = new Map<string, unknown>();
  let partial = false;
  await Promise.all(
    pageIds.map(async (pageId) => {
      const data = await loadConceptsPage(pageId);
      if (data) pages.set(pageId, data);
      else partial = true;
    })
  );
  return { index, pages, zoneEntries, partial };
}

/**
 * 求出這個 entityKey 在指定 zone **此刻**該對應的內容 id（非同步入口）。
 *
 * 索引或 zone 資料拿不到時回 `error`——見 `EntityBindingResult` 的說明。
 */
export async function resolveEntityBinding(
  entityKey: string,
  zone: 'echoes' | 'visuals',
  progress: ProgressState
): Promise<EntityBindingResult> {
  if (!entityKey) return { status: 'orphan' };
  let source: BindingSource;
  try {
    source = await loadSource(entityKey, zone);
  } catch {
    return { status: 'error' };
  }
  return resolveFromData(source, entityKey, zone, progress);
}

/**
 * `hasDossierEntry` 的非同步版本——呼叫端只有 entityKey、手上沒有索引時用
 * （編輯器孤兒警示、admin 巡查）。索引取不到時保守回 `true`，
 * 避免網路失敗被誤報成「這個 key 是孤兒」。
 */
export async function isOrphanEntityKey(entityKey: string): Promise<boolean> {
  if (!entityKey) return false;
  try {
    const index = await loadConceptsIndex();
    return !hasDossierEntry(entityKey, index);
  } catch {
    return false;
  }
}
