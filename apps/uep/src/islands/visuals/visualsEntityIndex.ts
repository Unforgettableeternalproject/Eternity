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
import {
  loadZoneEntityIndex,
  type ZoneEntityIndexEntry,
} from '../../lib/zoneEntityIndex';
import type { ProgressState } from '../../progress/types';

/**
 * 索引條目摘要——型別本體在 `lib/zoneEntityIndex`（Echoes 與 Visuals
 * 的回應形狀相同，且 entity 綁定求值也用同一份）。此處保留舊名。
 */
export type VisualsEntityIndexEntry = ZoneEntityIndexEntry;

/**
 * 載入 visuals entity 索引（模組級快取；失敗時清除快取讓下次重試）。
 *
 * 委派給 `lib/zoneEntityIndex` 的共用載入器——同一個端點原本在這裡、
 * 對位的 Echoes 索引、以及 entity 綁定求值各有一份快取，
 * 三份互相看不見（見該檔檔頭）。
 */
export function loadVisualsEntityIndex(): Promise<ZoneEntityIndexEntry[]> {
  return loadZoneEntityIndex('visuals');
}

/**
 * entityKey 是否有已解鎖的 Visuals gallery（union checker 的 Visuals 分支）。
 * 索引未載入（null）或查無此 key → false（安全預設）。
 *
 * 只比對 entityKey——storyKey 是另一個命名空間，不參與 entity 聯集判定。
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
