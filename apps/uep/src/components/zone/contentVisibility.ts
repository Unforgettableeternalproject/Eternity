/**
 * 全站內容可見性語意
 *
 * hidden  — 完全不對前台公開（草稿/開發中），所有 Reader 從 tree 排除
 * locked  — 內容存在但尚未解鎖，顯示但不可進入，排除於 prev/next
 * spoiler — 內容可訪問但需劇透警告，解鎖後依等級部分顯示（Echoes/Visuals）
 *
 * Epic 2 起 locked 有三種語意（艾斯維爾 2026-07-03 驗收定案）：
 * 1. static      — 編輯端手動勾選 `metadata.locked === true`，維持原顯示（🔒）
 * 2. progression — 閘門條件全為 completed:* 旗標（進度鎖）。標題輕度模糊、
 *                  不可點擊；且「循序漸進」——依賴頁本身仍鎖定時整個隱藏，
 *                  任何時刻只露出進度鏈上最近的一篇未解鎖文章
 * 3. flag        — 閘門條件含任何自訂旗標或 pristineOnly（旗標鎖）。
 *                  無論何時都顯示，標題完全遮蔽（不透字）；
 *                  進度與旗標混合條件時以旗標鎖為主
 *
 * 呼叫端不傳 progress state 時只判定靜態鎖定（向後相容，
 * Visuals/Echoes 在接上進度系統前維持原行為）。
 */

import {
  evaluateGate,
  parseGateCondition,
  completionFlag,
} from '../../progress';
import type { ProgressState } from '../../progress';

interface HasMetadata {
  metadata?: Record<string, unknown> | null;
}

/** completed:* 旗標前綴（進度鎖判定用） */
const COMPLETION_PREFIX = completionFlag('');

export type LockKind = 'static' | 'progression' | 'flag';

export function isHidden(node: HasMetadata): boolean {
  return node.metadata?.hidden === true;
}

/**
 * 鎖定分類。回傳 null 表示未鎖定。
 * 優先序：static > flag > progression（混合條件以旗標鎖為主）。
 */
export function getLockKind(
  node: HasMetadata,
  progress?: ProgressState | null
): LockKind | null {
  if (node.metadata?.locked === true) return 'static';
  if (!progress) return null;
  const gate = parseGateCondition(node.metadata ?? null);
  if (!gate || evaluateGate(progress, gate)) return null;
  const flags = gate.requiresFlags || [];
  const hasCustomFlag = flags.some((f) => !f.startsWith(COMPLETION_PREFIX));
  if (gate.pristineOnly || hasCustomFlag) return 'flag';
  return 'progression';
}

export function isLocked(
  node: HasMetadata,
  progress?: ProgressState | null
): boolean {
  return getLockKind(node, progress) !== null;
}

/**
 * 進度鏈隱藏判定（循序漸進顯示）。
 *
 * 進度鎖頁面若其 completed:* 依賴的頁面「本身也還鎖定」，則不顯示——
 * 例：1-5 鎖 1-4、1-6 鎖 1-5 時，只有 1-5 以模糊態露出，1-6 隱藏；
 * 讀完 1-4 解鎖 1-5 後，1-6 才以模糊態露出。多條平行進度線各自獨立。
 *
 * 只作用於 progression 鎖：flag 鎖無論何時都顯示，static 維持原樣。
 *
 * @param resolvePage 以 pageId 取得節點（tree 的 id 索引）；找不到視為不隱藏
 */
export function isProgressionChainHidden(
  node: HasMetadata,
  progress: ProgressState | null | undefined,
  resolvePage: (pageId: string) => HasMetadata | undefined
): boolean {
  if (getLockKind(node, progress) !== 'progression') return false;
  const gate = parseGateCondition(node.metadata ?? null);
  const deps = (gate?.requiresFlags || [])
    .filter((f) => f.startsWith(COMPLETION_PREFIX))
    .map((f) => f.slice(COMPLETION_PREFIX.length));
  return deps.some((depId) => {
    const dep = resolvePage(depId);
    return dep ? isLocked(dep, progress) : false;
  });
}

export function getSpoilerLevel(node: HasMetadata): number {
  const level = node.metadata?.spoilerLevel;
  return typeof level === 'number' ? level : 0;
}

export function isAccessible(
  node: HasMetadata,
  progress?: ProgressState | null
): boolean {
  return !isHidden(node) && !isLocked(node, progress);
}
