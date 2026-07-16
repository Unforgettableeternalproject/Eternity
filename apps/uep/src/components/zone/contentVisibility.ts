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
  effectiveGate,
  evaluateEffectiveGate,
} from '../../progress';
import type { ProgressState, ProgressTreeAdapter } from '../../progress';

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
 *
 * 優先序（2026-07-03 修正）：進度鎖 > flag > static
 * ——當頁面同時有靜態鎖與進度鏈條件時，先讓進度鏈把它藏起或以模糊態露出，
 * 只有等鏈條件通過（前置全部 completed）後才顯示 static 🔒 表示
 * 「進度到了，但這一節被手動封存」。混合旗標與進度時以旗標鎖為主。
 *
 * 向後相容：無 progress 時只判靜態鎖（Visuals/Echoes 尚未接進度系統）。
 *
 * @param nodeId 傳入時啟用 tree-aware 求值（含 progressPage 鏈 + 容器繼承 + 遞迴 completed）
 * @param tree tree 適配器，與 nodeId 一同傳入才生效
 */
export function getLockKind(
  node: HasMetadata,
  progress?: ProgressState | null,
  nodeId?: string,
  tree?: ProgressTreeAdapter
): LockKind | null {
  const staticLocked = node.metadata?.locked === true;

  // 無 progress → 只判靜態（向後相容）
  if (!progress) return staticLocked ? 'static' : null;

  const useTree = nodeId !== undefined && tree !== undefined;
  const gate = useTree
    ? effectiveGate(nodeId, tree)
    : parseGateCondition(node.metadata ?? null);

  if (gate) {
    const passes = useTree
      ? evaluateEffectiveGate(nodeId, progress, tree, gate)
      : evaluateGate(progress, gate);
    if (!passes) {
      // 進度鎖優先：gate 尚未通過時，先呈現 flag / progression，不看 static
      const flags = gate.requiresFlags || [];
      const hasCustomFlag = flags.some((f) => !f.startsWith(COMPLETION_PREFIX));
      if (gate.pristineOnly || hasCustomFlag) return 'flag';
      return 'progression';
    }
  }

  // gate 通過（或無 gate）→ static 才生效
  return staticLocked ? 'static' : null;
}

export function isLocked(
  node: HasMetadata,
  progress?: ProgressState | null,
  nodeId?: string,
  tree?: ProgressTreeAdapter
): boolean {
  return getLockKind(node, progress, nodeId, tree) !== null;
}

/**
 * 進度鏈隱藏判定（循序漸進顯示）。
 *
 * 進度鎖頁面若其 completed:* 依賴的頁面「本身也還鎖定」，則不顯示——
 * 例：讀完 arc.00 前，arc.01 隱藏；讀完 arc.00 後 arc.01 露出模糊，
 * 但 arc.02 仍隱藏，讀完 arc.01 才露出。多條平行進度線各自獨立。
 *
 * 只作用於 progression 鎖：flag 鎖無論何時都顯示，static 維持原樣。
 *
 * 註：2026-07-03 一度改為「倒數第二 leaf 露出、最後 leaf 解鎖」規則
 * （#9），實測後回退——理由：arc.landing 讀完應直接推進，倒數第二
 * 規則對「無 sections 的 arc」不適用，且 UX 上「讀完自己 → 下一個
 * 露出」的線性感更符合使用者心智。
 *
 * @param resolvePage 以 pageId 取得節點；找不到視為不隱藏
 * @param nodeId 傳入時啟用 tree-aware 求值（含 progressPage 鏈 + 容器繼承）
 * @param tree tree 適配器，與 nodeId 一同傳入才生效
 */
export function isProgressionChainHidden(
  node: HasMetadata,
  progress: ProgressState | null | undefined,
  resolvePage: (pageId: string) => HasMetadata | undefined,
  nodeId?: string,
  tree?: ProgressTreeAdapter
): boolean {
  if (getLockKind(node, progress, nodeId, tree) !== 'progression') return false;

  const useTree =
    nodeId !== undefined && tree !== undefined && progress != null;
  const gate = useTree
    ? effectiveGate(nodeId, tree)
    : parseGateCondition(node.metadata ?? null);

  const deps = (gate?.requiresFlags || [])
    .filter((f) => f.startsWith(COMPLETION_PREFIX))
    .map((f) => f.slice(COMPLETION_PREFIX.length));

  return deps.some((depId) => {
    const dep = resolvePage(depId);
    if (!dep) return false;
    // 循序漸進定義：依賴頁本身仍鎖定 → 隱藏；依賴頁可讀但未完成 → 露出 progression。
    // 孤兒偵測靠 isEffectivelyCompleted 在 gate 求值層處理，不干涉這裡的隱藏判定。
    return isLocked(dep, progress, useTree ? depId : undefined, tree);
  });
}

export function getSpoilerLevel(node: HasMetadata): number {
  const level = node.metadata?.spoilerLevel;
  return typeof level === 'number' ? level : 0;
}

export function isAccessible(
  node: HasMetadata,
  progress?: ProgressState | null,
  nodeId?: string,
  tree?: ProgressTreeAdapter
): boolean {
  return !isHidden(node) && !isLocked(node, progress, nodeId, tree);
}
