/**
 * Storage 內容可見性
 *
 * 在此之前 Storage 完全沒接進度系統——`isLocked(entry)` 一律不帶 progress，
 * 只判靜態 `metadata.locked`，編輯器的 PROGRESS GATE 面板也整塊關閉
 * （`editorModeRegistry` 的 `gatePanelMode: 'none'`）。結果是全區預設公開，
 * 「某些事件之後才該出現的對話」擋不住。
 *
 * 兩類鎖的呈現刻意不同（艾斯維爾 2026-08-10 定案）：
 *
 * - **gate 未通過**（progression / flag）→ 整張從列表移除，且不計入計數分母。
 *   對話標題本身就會劇透——列一張「？？？」卡片仍然洩漏了「有這麼一段」，
 *   而 Storage 沒有 History 那種「下一篇在前方」的敘事引導需求。
 *   讀者不會知道有東西沒解鎖，解鎖時另由浮島通知補回這個缺口。
 * - **static 鎖**（編輯端手動勾 locked）→ 維持既有的封箱卡片。那是刻意的
 *   「這裡有東西但還沒放上來」表達，與進度無關，不該被一起藏掉。
 *
 * Storage 不走 tree-aware 求值：這一區沒有 progressPage 鏈也沒有容器繼承，
 * 條件一律是頁面自己的 `metadata.gate`（`completed:*` / `uep:*` / pristineOnly）。
 * 因此這裡只傳 progress，不傳 nodeId/tree。
 */

import { getLockKind } from '../zone/contentVisibility';
import type { ProgressState } from '../../progress';

interface HasMetadata {
  metadata?: Record<string, unknown> | null;
}

/**
 * gate 未通過 → 該條目對讀者不存在。
 *
 * static 鎖回 false：它要顯示成封箱卡片，不是藏起來。
 */
export function isGateBlocked(
  node: HasMetadata,
  progress: ProgressState | null | undefined
): boolean {
  const kind = getLockKind(node, progress);
  return kind === 'progression' || kind === 'flag';
}

/**
 * 過濾出讀者看得到的條目。列表與計數分母共用同一份結果——
 * 分開算會讓「5/12」從數字洩漏出被藏起來的條目數量。
 */
export function visibleEntries<T extends HasMetadata>(
  nodes: T[],
  progress: ProgressState | null | undefined
): T[] {
  return nodes.filter((n) => !isGateBlocked(n, progress));
}
