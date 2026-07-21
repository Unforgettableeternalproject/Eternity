/**
 * visualsEntityIndex — Visuals gallery entityKey 解鎖索引（S8 驗收 #2）
 *
 * 對位 echoesEntityIndex：互動嵌入超連結的啟用改為跨島聯集，Visuals 側
 * 需要一份輕量索引，才能在 History 頁不逐一打 entity-gallery 端點就判定
 * 某 entityKey 是否有已解鎖的 gallery。
 *
 * 端點 `GET /api/visuals/entity-index` 回傳所有帶 entityKey、非 hidden 的
 * gallery 摘要（id / entityKey / gate / locked）；解鎖判定沿用 Reader 端
 * `isGalleryUnlockedInZone`（推導旗標 OR gate，static locked 優先）。
 * 無 zone tree——本頁 gate 求值，與 entity-gallery 消費路徑同一已知限制。
 */

import { isGalleryUnlockedInZone } from '../../components/visuals/visualsVisibility';
import { getApiBase } from '../../lib/apiBase';
import type { ProgressState } from '../../progress/types';

/** Worker VisualsEntityIndexEntry 的前端鏡像 */
export interface VisualsEntityIndexEntry {
  id: string;
  entityKey: string;
  gate?: unknown;
  locked: boolean;
}

const API_BASE = getApiBase();

let indexCache: Promise<VisualsEntityIndexEntry[]> | null = null;

/** 載入 Visuals entity 索引（模組級快取；失敗時清除快取讓下次重試） */
export function loadVisualsEntityIndex(): Promise<VisualsEntityIndexEntry[]> {
  if (!indexCache) {
    indexCache = (async () => {
      const res = await fetch(`${API_BASE}/api/visuals/entity-index`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: { entries?: VisualsEntityIndexEntry[] };
        error?: string;
      };
      if (!json.ok) throw new Error(json.error || 'API returned ok=false');
      return json.data?.entries || [];
    })().catch((err) => {
      indexCache = null;
      throw err;
    });
  }
  return indexCache;
}

/**
 * entityKey 是否有已解鎖的 Visuals gallery（union checker 的 Visuals 分支）。
 * 索引未載入（null）或查無此 key → false（安全預設）。
 */
export function isVisualsEntityUnlocked(
  entries: VisualsEntityIndexEntry[] | null,
  key: string,
  progress: ProgressState
): boolean {
  if (!entries) return false;
  return entries.some(
    (e) =>
      e.entityKey === key &&
      isGalleryUnlockedInZone(
        {
          id: e.id,
          metadata: { entityKey: e.entityKey, gate: e.gate, locked: e.locked },
        },
        progress
      )
  );
}
