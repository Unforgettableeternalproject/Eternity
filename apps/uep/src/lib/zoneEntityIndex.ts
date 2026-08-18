/**
 * zoneEntityIndex — Echoes／Visuals 的 entity 索引（單一載入來源）
 *
 * `GET /api/{zone}/entity-index` 回傳該 zone 所有帶 entityKey 或 storyKey、
 * **非 hidden** 的內容摘要。兩個 zone 的回應形狀完全相同，故共用一份實作。
 *
 * ## 為什麼要集中
 *
 * 這份索引原本在三個地方各有一份實作與快取：`islands/echoes/
 * echoesEntityIndex`、`islands/visuals/visualsEntityIndex`、以及
 * `components/concepts/entityBinding`。同一個端點被打三次、快取彼此看不見
 * ——嵌入可點判定要與綁定求值對齊時，那個重複會直接變成請求翻倍。
 *
 * 放在 `lib/` 而非任一 zone 目錄：islands 與 components 都要用，
 * 而 components 不該反向 import islands。
 *
 * ⚠️ **索引含 hidden，每筆帶 `hidden` 旗標**——兩種用途對它的處置相反：
 *
 * - **數同 key 有幾筆候選**：要排除 hidden（隱藏內容不在列表出現，
 *   不該影響「唯一候選」的判定）。用 `soleEntityCandidate`。
 * - **驗證 dossier 指向的那一筆**：**不可**排除 hidden。明確綁定一首
 *   隱藏的前期曲是合法用法，by-id 消費路徑（`findSongById`／
 *   `findGalleryById`）也刻意不排除它——這裡排除就會變成「消費端顯示得
 *   出來、嵌入卻永遠不可點」。用 `findEntryById`。
 */

import { getApiBase } from './apiBase';

const API_BASE = getApiBase();

export type EntityIndexZone = 'echoes' | 'visuals';

/** Worker 的 Echoes/VisualsEntityIndexEntry 前端鏡像（兩者形狀相同） */
export interface ZoneEntityIndexEntry {
  id: string;
  /** 角色歌／陳列走廊才有；劇情歌與鑲框室插圖改掛 storyKey，故為選填 */
  entityKey?: string;
  /** 劇情點身分（entity 聯集判定不使用，僅為型別誠實） */
  storyKey?: string;
  /** 內容自己的解鎖閘（索引只回物件型 gate，舊字串 gate 不回傳） */
  gate?: unknown;
  /** 靜態封存，凌駕 gate */
  locked: boolean;
  /** 從列表隱藏——仍是合法的引用目標（見檔頭的兩種用途） */
  hidden?: boolean;
  /** 標題（綁定 picker 的選單需要可讀名稱，裸 id 認不出是哪一筆） */
  title?: string;
}

const cache: Partial<Record<EntityIndexZone, Promise<ZoneEntityIndexEntry[]>>> =
  {};

/** 載入某個 zone 的 entity 索引（模組級快取；失敗時清快取讓下次重試） */
export function loadZoneEntityIndex(
  zone: EntityIndexZone
): Promise<ZoneEntityIndexEntry[]> {
  let cached = cache[zone];
  if (!cached) {
    cached = (async () => {
      const res = await fetch(`${API_BASE}/api/${zone}/entity-index`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: { entries?: ZoneEntityIndexEntry[] };
        error?: string;
      };
      if (!json.ok) throw new Error(json.error || 'API returned ok=false');
      return json.data?.entries || [];
    })().catch((err) => {
      delete cache[zone];
      throw err;
    });
    cache[zone] = cached;
  }
  return cached;
}

/** 清空索引快取（測試與資料端更新後重抓用） */
export function invalidateZoneEntityIndex(): void {
  delete cache.echoes;
  delete cache.visuals;
}

/**
 * 同一個 entityKey 在該 zone 的**唯一**候選——恰好一筆時對應關係已經
 * 唯一確定，不需要任何綁定登記（這正是「entity 不一定要有 binding」的
 * 實務意義）。
 *
 * 多於一筆回 `null`：由誰指向必須明確，系統不挑。零筆同理。
 *
 * ⚠️ **這不是推論**：只數數量，完全不看 gate/locked，也不看排序。曾經
 * 有一版拿「gate 通過的最後一筆」當預設指向，那會讓「綁著但還沒解鎖」
 * 無法表達——指向與可見性是正交的兩個軸。
 *
 * 劇情內容（有 storyKey）不列入候選：那是另一套命名空間。
 * **hidden 也不列入**：隱藏內容不在列表出現，不該影響唯一性——要指向它
 * 就得由 dossier 明講。
 */
export function soleEntityCandidate(
  entries: readonly ZoneEntityIndexEntry[],
  entityKey: string
): string | null {
  const hits = entries.filter(
    (e) => e.entityKey === entityKey && !e.storyKey && !e.hidden
  );
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * 依 id 取索引條目——**刻意不管 hidden**。
 *
 * 用於驗證 dossier 明確指向的那一筆：明確綁定隱藏內容是合法的，
 * 這裡若沿用排除 hidden 的清單就會讓那些綁定永遠判成不可點。
 */
export function findEntryById(
  entries: readonly ZoneEntityIndexEntry[],
  id: string
): ZoneEntityIndexEntry | null {
  return entries.find((e) => e.id === id) ?? null;
}
