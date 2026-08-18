/**
 * echoesEntityIndex — Echoes 曲目 entityKey 解鎖索引（S8 驗收 #2）
 *
 * 互動嵌入超連結的啟用改為「跨 entity 浮島聯集」：同一 entityKey 可能
 * 同時綁 Concepts / Echoes / Visuals，任一相應浮島已解鎖即應可點。
 * Concepts 側靠 terminalCore 的 entity-index 前端判定；Echoes 對位需要
 * 一份輕量索引，才能在 History 頁不逐一打 entity-song 端點就判定某
 * entityKey 是否有已解鎖的歌曲。
 *
 * 端點 `GET /api/echoes/entity-index` 回傳所有帶 entityKey、非 hidden 的
 * 歌曲摘要（id / entityKey / gate / locked）；解鎖判定沿用 Reader 端同一套
 * `isSongUnlockedInZone`（推導旗標 OR gate，static locked 優先）。
 * 無 zone tree——本頁 gate 求值，與 entity-song 消費路徑同一已知限制。
 */

import { isSongUnlockedInZone } from '../../components/echoes/echoesVisibility';
import {
  loadZoneEntityIndex,
  type ZoneEntityIndexEntry,
} from '../../lib/zoneEntityIndex';
import type { ProgressState } from '../../progress/types';

/**
 * 索引條目摘要——型別本體在 `lib/zoneEntityIndex`（Echoes 與 Visuals
 * 的回應形狀相同，且 entity 綁定求值也用同一份）。此處保留舊名。
 */
export type EchoesEntityIndexEntry = ZoneEntityIndexEntry;

/**
 * 載入 echoes entity 索引（模組級快取；失敗時清除快取讓下次重試）。
 *
 * 委派給 `lib/zoneEntityIndex` 的共用載入器——同一個端點原本在這裡、
 * 對位的 Visuals 索引、以及 entity 綁定求值各有一份快取，
 * 三份互相看不見（見該檔檔頭）。
 */
export function loadEchoesEntityIndex(): Promise<ZoneEntityIndexEntry[]> {
  return loadZoneEntityIndex('echoes');
}

/**
 * entityKey 是否有已解鎖的 Echoes 歌曲（union checker 的 Echoes 分支）。
 * 索引未載入（null）或查無此 key → false（安全預設）。
 *
 * 只比對 entityKey——storyKey 是另一個命名空間，不參與 entity 聯集判定。
 */
export function isEchoesEntityUnlocked(
  entries: EchoesEntityIndexEntry[] | null,
  key: string,
  progress: ProgressState
): boolean {
  if (!entries) return false;
  return entries.some(
    (e) =>
      e.entityKey === key &&
      isSongUnlockedInZone(
        {
          id: e.id,
          metadata: { entityKey: e.entityKey, gate: e.gate, locked: e.locked },
        },
        progress
      )
  );
}
