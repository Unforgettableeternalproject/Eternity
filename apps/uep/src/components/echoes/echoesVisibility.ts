/**
 * Echoes 歌曲解鎖判定（S8 B-1）
 *
 * 核心語意（艾斯維爾 2026-07-11 定案）：
 * **解鎖凌駕於所有 spoiler 之上**——未解鎖的歌曲在 Echoes 中完全不存在
 * （列表、計數、prev/next、deep link 一律隱藏，同 Concepts dossier 語意，
 * 不是遮蔽佔位）。解鎖之後才輪到 spoiler 降級鏈決定資訊量。
 *
 * 解鎖 = 下列任一成立：
 * 1. 頁面 gate 條件通過（`requiresFlags` / `pristineOnly`，同 Concepts 做法
 *    ——可能是某個旗標、完成某個章節等；**無 gate 且無靜態鎖 = 天生解鎖**）
 * 2. 持有系統自動推導的解鎖旗標（`deriveSongUnlockFlag`）——由 echo spot
 *    或互動嵌入觸發播放時授予（C/D 段接線）
 *
 * 靜態鎖（`metadata.locked === true`，手動封存）凌駕於推導旗標之上：
 * 封存中的歌即使被授旗也不出現。
 *
 * 觀測者沿既有 evaluateGate 語意 bypass requiresFlags
 * （pristineOnly 與靜態鎖不 bypass）。
 */

import { deriveSongUnlockFlag } from '../../audio';
import type { ProgressState, ProgressTreeAdapter } from '../../progress';
import { isLocked } from '../zone/contentVisibility';

interface SongNodeLike {
  id: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * 歌曲是否已解鎖（可在 Echoes zone 中出現）。
 *
 * @param node     歌曲節點（tree node 或 page，需有 id 與 metadata）
 * @param progress 進度狀態；null 時向後相容只判靜態鎖（SSR / 載入前）
 * @param tree     ProgressTreeAdapter；傳入時 gate 走 tree-aware 求值
 *                 （progressPage 鏈 + 父容器繼承）。IslandHost 的
 *                 entity-song 路徑經 fetchZoneProgressTree 取得 zone
 *                 tree；tree 取不到時由 Host fail-closed
 */
export function isSongUnlockedInZone(
  node: SongNodeLike,
  progress: ProgressState | null | undefined,
  tree?: ProgressTreeAdapter
): boolean {
  // 靜態封存凌駕一切（含推導旗標與觀測者）
  if (node.metadata?.locked === true) return false;

  if (!progress) return !isLocked(node);

  // 系統推導旗標（echo spot / 嵌入觸發播放時授予）——
  // 已被授權聽過即解鎖，凌駕容器 gate。
  //
  // 沒有對應 key 的歌曲推導不出旗標（回傳 null），整段跳過改由 gate
  // 決定可見性——這種歌不會出現在收藏池，只能靠 spot 現場插播。
  const asString = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value : null;
  const unlockFlag = deriveSongUnlockFlag(
    asString(node.metadata?.category),
    asString(node.metadata?.entityKey),
    asString(node.metadata?.storyKey)
  );
  if (unlockFlag && progress.flags.includes(unlockFlag)) {
    return true;
  }

  // gate 條件求值（無 gate = 天生解鎖；觀測者 bypass requiresFlags）
  return !isLocked(node, progress, tree ? node.id : undefined, tree);
}

/**
 * 曲目是否可加入流浪回聲佇列。
 *
 * spoiler 警告的臨時解鎖只授予當次聆聽權，不代表可持久加入佇列；
 * 因此只有完全無 spoiler 的 L0 曲目合格。
 */
export function isSongQueueEligible(
  spoilerLevel: number,
  unlocked: boolean
): boolean {
  return unlocked && spoilerLevel === 0;
}
