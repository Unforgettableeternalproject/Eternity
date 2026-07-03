/**
 * UEP 進度系統 — Gating 條件求值器
 *
 * 內容可見性的三維條件模型：
 *
 * 1. requiresFlags — 正向條件：需持有全部旗標（AND）。
 *    觀測者視角 bypass 此條件（全知）。
 * 2. pristineOnly — 純潔者限定：從未見證過一切的人才可見。
 *    觀測者「不」bypass 此條件——這是觀測者印記的代價。
 * 3. 兩者可組合，例如：番外需要讀完某章（旗標）且無印記。
 *
 * 與既有 contentVisibility（hidden/locked/spoiler）的關係：
 * 那是編輯端手動控制的靜態語意；這裡是隨使用者進度動態求值的條件。
 * 後續 session 會讓 locked/spoiler 的判定接上這裡。
 */

import { completionFlag } from './markers';
import type { ProgressTreeAdapter } from './tree';
import type { ProgressState } from './types';

/** 內容節點的 gating 條件（存於 page/entry/segment metadata） */
export interface GateCondition {
  /** 需持有的旗標（全部滿足，AND 語意）；觀測者 bypass */
  requiresFlags?: string[];
  /** 純潔者限定：探索者且無觀測者印記才可見；觀測者不 bypass */
  pristineOnly?: boolean;
}

/**
 * 是否為「純潔者」——從未見證過一切的人。
 * 切換至觀測者的瞬間 observerEver 即為 true，因此只需檢查印記；
 * view 的防禦性檢查是為了容忍外部資料破壞不變量的情況。
 */
export function isPristine(state: ProgressState): boolean {
  return !state.observerEver && state.view !== 'observer';
}

/** 是否持有全部旗標 */
export function hasAllFlags(state: ProgressState, flags: string[]): boolean {
  return flags.every((f) => state.flags.includes(f));
}

/**
 * 求值 gating 條件。回傳 true 表示內容對目前使用者可見。
 *
 * 求值順序：
 * 1. 無條件 → 可見
 * 2. pristineOnly 不滿足 → 不可見（觀測者與印記者到此為止）
 * 3. requiresFlags：觀測者 bypass；探索者需持有全部旗標
 */
export function evaluateGate(
  state: ProgressState,
  condition: GateCondition | null | undefined
): boolean {
  if (!condition) return true;

  if (condition.pristineOnly && !isPristine(state)) {
    return false;
  }

  const required = condition.requiresFlags;
  if (required && required.length > 0) {
    if (state.view === 'observer') return true; // 全知 bypass（已通過 pristine 檢查）
    return hasAllFlags(state, required);
  }

  return true;
}

/**
 * 讀取「這是進度頁」旗標。
 *
 * progressPage 是頁面本體性質（與 `locked` / `hidden` 同層平鋪），
 * 語意為「本頁的解鎖倚賴同層前一個進度頁完成」。實際的鏈條件由
 * `effectiveGate`（見 B 步驟）動態注入，不落地到 metadata.gate。
 *
 * Arc / Chapter 也可標為進度頁 → 觸發容器繼承（底下所有 section 預設繼承）。
 */
export function isProgressPage(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return metadata.progressPage === true;
}

/**
 * 從 metadata JSON 解析 gating 條件。
 * 支援兩種存放形狀：
 * - 平鋪：`{ requiresFlags: [...], pristineOnly: true }`
 * - 巢狀：`{ gate: { requiresFlags: [...], pristineOnly: true } }`
 * 無有效條件時回傳 null（代表無限制）。
 */
export function parseGateCondition(
  metadata: Record<string, unknown> | null | undefined
): GateCondition | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const source =
    typeof metadata.gate === 'object' && metadata.gate !== null
      ? (metadata.gate as Record<string, unknown>)
      : metadata;

  const condition: GateCondition = {};

  if (Array.isArray(source.requiresFlags)) {
    const flags = source.requiresFlags.filter(
      (f): f is string => typeof f === 'string' && f.length > 0
    );
    if (flags.length > 0) condition.requiresFlags = flags;
  }

  if (source.pristineOnly === true) {
    condition.pristineOnly = true;
  }

  return condition.requiresFlags || condition.pristineOnly ? condition : null;
}

/* ═════════════════════════════════════════════════════════════════════
 * B 步驟：Tree 感知求值（effectiveGate + isEffectivelyCompleted）
 * ═════════════════════════════════════════════════════════════════════
 *
 * 為什麼要 tree？因為以下三種鏈條件無法只從單一 metadata 求值：
 *
 * 1. 「本頁是進度頁」→ 需注入「前一個進度 sibling 的 completed:*」
 * 2. 「父層是進度頁」→ 需注入「父層的前一個進度 sibling 的 completed:*」（容器繼承）
 * 3. 「completed:X 是否真的滿足」→ 需遞迴驗證 X 自己也解得開，避免孤兒 flag 洩漏
 *
 * evaluateGate 保留為純語意版（測試友善、向後相容）；
 * evaluateEffectiveGate 是新的完整版，會走 tree 遞迴。
 */

/** completed:* 旗標前綴常數（與 markers.completionFlag 對齊，單一事實來源） */
export const COMPLETION_FLAG_PREFIX = completionFlag('');

/** 為避免遞迴環的訪問集合 */
type VisitSet = Set<string>;

/**
 * 產出節點的完整 gating 條件（手動 gate ∪ progressPage 鏈 ∪ 父層繼承）。
 *
 * 純結構層合流，不涉及 progress state。輸出符合 GateCondition 格式，
 * 可餵回 evaluateGate 或 evaluateEffectiveGate。
 *
 * @returns 合流後的條件；若既無手動也無鏈條件則回傳 null（無限制）
 */
export function effectiveGate(
  nodeId: string,
  tree: ProgressTreeAdapter
): GateCondition | null {
  const node = tree.getNode(nodeId);
  if (!node) return null;

  const flags = new Set<string>();
  let pristineOnly = false;

  // 手動 gate（既有語意）
  const manual = parseGateCondition(node.metadata ?? null);
  if (manual) {
    manual.requiresFlags?.forEach((f) => flags.add(f));
    if (manual.pristineOnly) pristineOnly = true;
  }

  // 本頁進度頁鏈：加上前一個進度 sibling 的 completed:*
  if (isProgressPage(node.metadata ?? null)) {
    const prev = tree.getPreviousProgressSiblingId(nodeId);
    if (prev) flags.add(completionFlag(prev));
  }

  // 容器繼承：走 parent chain，若父層是進度頁則加其鏈條件
  let cursorId: string | null | undefined = tree.getParentId(nodeId);
  const walked: VisitSet = new Set([nodeId]);
  while (cursorId) {
    if (walked.has(cursorId)) break; // 環保護
    walked.add(cursorId);
    const parent = tree.getNode(cursorId);
    if (!parent) break;
    if (isProgressPage(parent.metadata ?? null)) {
      const parentPrev = tree.getPreviousProgressSiblingId(cursorId);
      if (parentPrev) flags.add(completionFlag(parentPrev));
    }
    cursorId = tree.getParentId(cursorId);
  }

  if (flags.size === 0 && !pristineOnly) return null;
  const result: GateCondition = {};
  if (flags.size > 0) result.requiresFlags = Array.from(flags);
  if (pristineOnly) result.pristineOnly = true;
  return result;
}

/**
 * 遞迴驗證頁面「有效完成」——進度旗標存在 **且** 該頁本身可解鎖。
 *
 * 解決孤兒 completed 洩漏：測試模式手動蓋 completed:1-4，但 1-4 依賴的
 * 1-3 尚未 completed → 1-4 的 effectiveGate 不通過 → 視為未完成，
 * 下游的 1-5 也就跟著鎖住。
 *
 * Container（arc/chapter）沒有自己的 completed:* 旗標，改判定為
 * 「底下所有 progressPage 葉節點都 effectively completed」。
 *
 * @param nodeId 要驗證完成狀態的頁面 id
 * @param visiting 遞迴保護集合，外部呼叫無需傳
 */
export function isEffectivelyCompleted(
  nodeId: string,
  progress: ProgressState,
  tree: ProgressTreeAdapter,
  visiting: VisitSet = new Set()
): boolean {
  if (visiting.has(nodeId)) return false; // 環保護：視為未完成
  const node = tree.getNode(nodeId);
  if (!node) return false;

  // Container 判定：有 progressPage 後代 → 底下全 completed 才算 container 完成
  const descendants = tree.getProgressDescendantIds(nodeId);
  if (descendants.length > 0) {
    const nextVisit = new Set(visiting);
    nextVisit.add(nodeId);
    return descendants.every((id) =>
      isEffectivelyCompleted(id, progress, tree, nextVisit)
    );
  }

  // Leaf 判定：flags 有 completed:X 且自己 effectiveGate 通過
  if (!progress.flags.includes(completionFlag(nodeId))) return false;

  const nextVisit = new Set(visiting);
  nextVisit.add(nodeId);
  const gate = effectiveGate(nodeId, tree);
  return evaluateEffectiveGate(nodeId, progress, tree, gate, nextVisit);
}

/**
 * Tree 感知的三維求值。
 *
 * 差別於 evaluateGate：`completed:X` 走 isEffectivelyCompleted 遞迴驗證，
 * 其餘旗標維持 literal 比對；pristineOnly 語意不變。
 *
 * @param resolvedGate 若已透過 effectiveGate 算出可直接傳入避免重算；否則自動計算
 */
export function evaluateEffectiveGate(
  nodeId: string,
  progress: ProgressState,
  tree: ProgressTreeAdapter,
  resolvedGate?: GateCondition | null,
  visiting: VisitSet = new Set()
): boolean {
  const gate =
    resolvedGate === undefined ? effectiveGate(nodeId, tree) : resolvedGate;
  if (!gate) return true;

  if (gate.pristineOnly && !isPristine(progress)) return false;

  const required = gate.requiresFlags;
  if (!required || required.length === 0) return true;

  // 觀測者 bypass requiresFlags（維持既有語意；pristine 已上面擋掉）
  if (progress.view === 'observer') return true;

  return required.every((flag) => {
    if (flag.startsWith(COMPLETION_FLAG_PREFIX)) {
      const depId = flag.slice(COMPLETION_FLAG_PREFIX.length);
      return isEffectivelyCompleted(depId, progress, tree, visiting);
    }
    return progress.flags.includes(flag);
  });
}
