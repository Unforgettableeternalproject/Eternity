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
import { getApiBase } from '../../lib/apiBase';
import type { ProgressState } from '../../progress/types';

/** Worker EchoesEntityIndexEntry 的前端鏡像 */
export interface EchoesEntityIndexEntry {
  id: string;
  entityKey: string;
  gate?: unknown;
  locked: boolean;
}

const API_BASE = getApiBase();

let indexCache: Promise<EchoesEntityIndexEntry[]> | null = null;

/** 載入 Echoes entity 索引（模組級快取；失敗時清除快取讓下次重試） */
export function loadEchoesEntityIndex(): Promise<EchoesEntityIndexEntry[]> {
  if (!indexCache) {
    indexCache = (async () => {
      const res = await fetch(`${API_BASE}/api/echoes/entity-index`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: { entries?: EchoesEntityIndexEntry[] };
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
 * entityKey 是否有已解鎖的 Echoes 歌曲（union checker 的 Echoes 分支）。
 * 索引未載入（null）或查無此 key → false（安全預設）。
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
        { id: e.id, metadata: { entityKey: e.entityKey, gate: e.gate, locked: e.locked } },
        progress
      )
  );
}
