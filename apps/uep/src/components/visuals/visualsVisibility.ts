/**
 * Visuals gallery 解鎖判定（S8 下半場審查修正 P1-1）
 *
 * 對位 Echoes 的 `isSongUnlockedInZone`：gallery 的解鎖除了 gate 條件
 * 求值之外，還要消費系統自動推導的解鎖旗標（`deriveGalleryUnlockFlag`
 * ——Visual Clue 展示／entity 嵌入授旗路徑授予）。缺了這一層，clue
 * 展示後「封印解開」的通知會是假成功：Reader 端仍只看 gate。
 *
 * 解鎖 = 下列任一成立：
 * 1. gate 條件通過（tree-aware——progressPage 鏈 + 父容器繼承）
 * 2. 持有推導旗標（clue 展示時授予）——凌駕容器 gate
 *
 * 靜態鎖（`metadata.locked === true`，手動封存）凌駕於推導旗標之上，
 * 與 Echoes 同一套語意。
 */

import type { ProgressState, ProgressTreeAdapter } from '../../progress';
import { deriveGalleryUnlockFlag } from '../../visuals';
import { isLocked } from '../zone/contentVisibility';

interface GalleryNodeLike {
  id: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * gallery 是否已解鎖（可在 Visuals zone 中進入／浮動幻影中展示）。
 *
 * @param node     gallery 節點（tree node 或 API payload 組成的替身，
 *                 需有 id 與 metadata.gate/locked/entityKey）
 * @param progress 進度狀態；null 時向後相容只判靜態鎖（SSR / 載入前）
 * @param tree     ProgressTreeAdapter；傳入時 gate 走 tree-aware 求值。
 *                 IslandHost entity 路徑經 fetchZoneProgressTree 取得
 *                 zone tree；clue 反查路徑仍無 tree，維持本頁 gate 求值
 *                 ——容器繼承在該路徑不生效（已知限制）
 */
export function isGalleryUnlockedInZone(
  node: GalleryNodeLike,
  progress: ProgressState | null | undefined,
  tree?: ProgressTreeAdapter
): boolean {
  // 靜態封存凌駕一切（含推導旗標與觀測者）
  if (node.metadata?.locked === true) return false;

  if (!progress) return !isLocked(node);

  // 系統推導旗標（clue 展示時授予）——已被授權看過即解鎖，凌駕容器 gate
  const entityKey =
    typeof node.metadata?.entityKey === 'string' &&
    node.metadata.entityKey.trim()
      ? node.metadata.entityKey
      : null;
  if (progress.flags.includes(deriveGalleryUnlockFlag(node.id, entityKey))) {
    return true;
  }

  // gate 條件求值（無 gate = 天生解鎖；觀測者 bypass requiresFlags）
  return !isLocked(node, progress, tree ? node.id : undefined, tree);
}
