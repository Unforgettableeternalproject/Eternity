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
 * ⚠️ **範圍含意**：索引排除 hidden，與 by-key 反查端點
 * （`findEntitySong`／`findEntityGallery`）一致，但與 by-id 反查
 * （`findSongById`／`findGalleryById`，刻意含 hidden）不同。拿它判定
 * 「同 key 有幾筆候選」是對的；拿它驗證某個明確 id 是否存在則會漏掉
 * 隱藏內容。
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
 */
export function soleEntityCandidate(
  entries: readonly ZoneEntityIndexEntry[],
  entityKey: string
): string | null {
  const hits = entries.filter((e) => e.entityKey === entityKey && !e.storyKey);
  return hits.length === 1 ? hits[0].id : null;
}
