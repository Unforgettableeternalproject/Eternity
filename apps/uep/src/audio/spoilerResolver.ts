/**
 * UEP 全域音訊系統 — Spoiler 降級鏈與收藏池判定（純函式層）
 *
 * 設計依據：docs/agent/S8_ECHOES_DESIGN.md 第三章。
 *
 * 兩條獨立的軸（艾斯維爾 2026-07-11 定案）：
 * 1. 收藏（collected）＝歌曲進入收藏池，有資格加入佇列。
 *    來源：echo spot 觸發自動解鎖、Echoes zone 內直接讀到。
 *    未收藏的歌在 Echoes 列表中完全隱藏（同 Concepts dossier 語意）。
 * 2. Spoiler 降級鏈＝已收藏歌曲「呈現多少資訊」。維持既有 L0-L3
 *    遮蔽機制（SpoilerTitle），等級隨進度鎖漸進降級——單調 AND 鏈，
 *    每降一級須同時符合所有上級的降級條件。
 *
 * 交會點：已收藏但 spoiler 仍在 L3 → 不可播放
 * （S8 唯一的既有行為變更：L3 從 30 秒 preview 改為完全不可播放）。
 *
 * ⚠️ 命名注意：EchoesReader 內另有 `isSongUnlocked`（語意＝使用者已
 * 確認 spoiler 警告），與這裡的 `isSongCollected` 完全不同，勿混用。
 */

import { evaluateGate } from '../progress';
import type { GateCondition, ProgressState } from '../progress';

/** Spoiler 有效等級（3 = 最嚴格、不可播放；0 = 完全解鎖） */
export type SpoilerLevel = 0 | 1 | 2 | 3;

/**
 * 單一降級條件。宣告順序須由嚴格到寬鬆（targetLevel 遞減），
 * resolver 帶亂序防禦但不自動排序——編輯器負責維持宣告順序。
 */
export interface SongSpoilerRevision {
  /** 降級後達到的 spoiler 等級（0 = 完全解鎖） */
  targetLevel: 0 | 1 | 2;
  /** 降級條件（走既有 evaluateGate：requiresFlags / pristineOnly） */
  gate: GateCondition;
}

/**
 * 計算歌曲的有效 spoiler 等級。
 *
 * 求值規則（單調 AND 鏈）：初始 L3，按宣告順序逐條判斷，gate 通過
 * 才降到對應等級並繼續；一關不過即停（`break`）——後面的條件即使
 * 成立也不生效。這與 Concepts applyRevisions 的「逐條通過逐條套用」
 * 不同：Concepts 是獨立 patch，Spoiler 是嚴格遞進。
 *
 * @param revisions 降級鏈（無或空 = 完全開放 L0）
 * @param progress  目前進度狀態
 */
export function resolveSpoilerLevel(
  revisions: SongSpoilerRevision[] | null | undefined,
  progress: ProgressState
): SpoilerLevel {
  if (!revisions || revisions.length === 0) return 0; // 無降級鏈 = 完全開放
  if (progress.view === 'observer') return 0; // 觀測者 bypass 全部 spoiler
  let current: SpoilerLevel = 3;
  for (const rev of revisions) {
    if (typeof rev?.targetLevel !== 'number') continue; // 資料防禦
    if (rev.targetLevel >= current) continue; // 亂序防禦：不可回升
    if (!evaluateGate(progress, rev.gate)) break; // AND 鏈：一關不過就停
    current = rev.targetLevel;
  }
  return current;
}

/**
 * 是否可播放：L0-L2 可播放，L3 不可播放。
 * （艾斯維爾定案：維持既有 spoiler 做法，唯 L3 從 30 秒 preview
 * 改為完全不可播放。）
 */
export function isSpoilerPlayable(level: SpoilerLevel): boolean {
  return level < 3;
}

/**
 * 歌曲是否已進收藏池（可加入佇列的資格）。
 * 觀測者一律視為已收藏（全知語意，與 gate bypass 一致）。
 */
export function isSongCollected(
  unlockFlag: string,
  progress: ProgressState
): boolean {
  if (progress.view === 'observer') return true;
  return progress.flags.includes(unlockFlag);
}

/**
 * 自動推導歌曲的收藏旗標（2026-07-11 二輪定案，雙命名空間）：
 * - 有 entityKey 的歌曲 → `{entityKey}:song`（Terminal 的
 *   `{entityKey}:*` 掃描可命中；`song` 固定詞不與 Concepts 的
 *   `:NN` 序號衝突）
 * - 無 entityKey 的純劇情歌 → `song:{songId}`
 *
 * 編輯器不手填旗標字串，echo spot 觸發授旗與收藏判定都走這裡。
 */
export function deriveSongUnlockFlag(
  songId: string,
  entityKey?: string | null
): string {
  const key = entityKey?.trim();
  if (key) return `${key}:song`;
  return `song:${songId}`;
}
