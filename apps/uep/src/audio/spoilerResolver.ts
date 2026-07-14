/**
 * UEP 全域音訊系統 — Spoiler 降級鏈與收藏池判定（純函式層）
 *
 * 設計依據：docs/agent/S8_ECHOES_DESIGN.md 第三章。
 *
 * 兩條獨立的軸（艾斯維爾 2026-07-11 定案，第二輪修正）：
 * 1. 解鎖（collected）＝歌曲進入收藏池，有資格加入佇列。
 *    **解鎖凌駕於所有 spoiler 之上**：未解鎖的歌在 Echoes 中完全隱藏
 *    （列表、計數、deep link 一律不存在，同 Concepts dossier 語意）。
 *    解鎖 = gate 條件達成（同 Concepts：旗標／完成章節；無 gate = 天生
 *    解鎖）或持有系統推導旗標（echo spot／互動嵌入觸發播放時授予）。
 *    ⚠️ 沒有「讀到詳情頁自動解鎖」這種事——未解鎖根本讀不到。
 * 2. Spoiler 降級鏈＝已解鎖歌曲「呈現多少資訊」。Gate 掛在「離開
 *    當前 Level」上；最高有 Gate 的 Level 是起始級，通過後前往下一個
 *    有設定 Gate 的較低 Level，因此允許 L3 直接跳到 L1。
 *
 * 交會點：已解鎖但 spoiler 仍在 L3 → 不可播放
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
 * 單一降級條件。sourceLevel 表示「離開哪個 Level」；L0 已完全開放，
 * 不存在離開條件。targetLevel 僅供 0.9.13.10 舊資料向後相容。
 */
export interface SongSpoilerRevision {
  /** 條件通過前所在的 spoiler 等級。 */
  sourceLevel?: 1 | 2 | 3;
  /** 舊格式「通過後的等級」，讀取時轉為 targetLevel + 1。 */
  targetLevel?: 0 | 1 | 2;
  /** 降級條件（走既有 evaluateGate：requiresFlags / pristineOnly） */
  gate: GateCondition;
}

/**
 * 計算歌曲的有效 spoiler 等級。
 *
 * 求值規則：最高有 Gate 的 Level 為起始級。當該級 Gate 通過時，前往
 * 下一個有 Gate 的較低級；若沒有更低 Gate，則只降一級並停。任一 Gate
 * 未通過即停。例：只設定 L3/L1 時，路徑是 L3 → L1 → L0。
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

  const bySource = new Map<1 | 2 | 3, SongSpoilerRevision>();
  for (const revision of revisions) {
    const source = revisionSourceLevel(revision);
    if (source && revision.gate && typeof revision.gate === 'object') {
      bySource.set(source, revision);
    }
  }
  const configured = [...bySource.keys()].sort((a, b) => b - a);
  if (configured.length === 0) return 0;

  let current: SpoilerLevel = configured[0];
  while (current > 0) {
    const revision = bySource.get(current as 1 | 2 | 3);
    if (!revision || !evaluateGate(progress, revision.gate)) break;
    const nextConfigured = configured.find((level) => level < current);
    current = nextConfigured ?? ((current - 1) as SpoilerLevel);
  }
  return current;
}

/** 將新 sourceLevel 與舊 targetLevel 統一成「離開哪一級」。 */
export function revisionSourceLevel(
  revision: SongSpoilerRevision | null | undefined
): 1 | 2 | 3 | null {
  if (
    revision?.sourceLevel === 1 ||
    revision?.sourceLevel === 2 ||
    revision?.sourceLevel === 3
  ) {
    return revision.sourceLevel;
  }
  if (
    revision?.targetLevel === 0 ||
    revision?.targetLevel === 1 ||
    revision?.targetLevel === 2
  ) {
    return (revision.targetLevel + 1) as 1 | 2 | 3;
  }
  return null;
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
