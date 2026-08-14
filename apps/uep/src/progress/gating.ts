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
  /**
   * 恆鎖定：條件恆不成立，任何身分都通不過（觀測者也不 bypass）。
   *
   * 給「內容已經寫好，但它該綁的頁面或旗標還沒設計出來」的過渡期用——
   * 先擋住，之後回來換成真正的條件。沒有這個開關的話，暫時的做法只能是
   * 隨手掰一個永遠不會有人授予的旗標名，那會在註冊表留下一顆看不出是
   * 佔位的死旗標。
   */
  alwaysLocked?: boolean;
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
 * 2. alwaysLocked → 一律不可見（最優先，任何身分皆不 bypass）
 * 3. pristineOnly 不滿足 → 不可見（觀測者與印記者到此為止）
 * 4. requiresFlags：觀測者 bypass；探索者需持有全部旗標
 */
export function evaluateGate(
  state: ProgressState,
  condition: GateCondition | null | undefined
): boolean {
  if (!condition) return true;

  if (condition.alwaysLocked) return false;

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
 * 讀取「不繼承容器進度」豁免旗標（與 progressPage 同層平鋪）。
 *
 * 切斷點語意（2026-07-03 艾斯維爾定案）：豁免節點與其整個子樹
 * 都不繼承祖先容器的進度鏈——effectiveGate 的 parent chain 走訪
 * 遇到豁免節點即停止（該節點自己的鏈條件也不加）。
 *
 * 豁免「只」影響祖先繼承，不影響：
 * - 節點自身的手動 gate 與 progressPage 同層鏈（照常生效）
 * - 父容器的完成判定——豁免頁若同時標 progressPage 仍計入
 *   （豁免管「何時能讀」，progressPage 管「算不算進度」，語意正交）
 *
 * 典型場景：番外/特別篇掛在 arc 底下但開放提前閱讀。
 */
export function isGateExempt(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return metadata.gateExempt === true;
}

/** 祖先鏈走訪需要的最小節點形狀（單頁 API 與樹節點都滿足） */
export interface ProgressAncestorNode {
  metadata?: Record<string, unknown> | null;
  parentId?: string | null;
}

/**
 * 這一頁是否位於某個生效中的進度容器內。
 *
 * 規則與 `effectiveGate`／`flattenProgressTree` 同一份：
 *
 *   effective(n) = raw(n) || (!exempt(n) && effective(parent(n)))
 *   inContainer(page) = effective(parent(page))
 *
 * 由下往上走，因為呼叫端（文章編輯器）手上只有 `parentId`——樹狀 top-down
 * 是總覽那邊的形狀。兩者結論必須一致，所以規則寫在這裡一份。
 *
 * ⚠️ **只看直接父頁是錯的**。三層巢狀（chapter 自標 → arc 被動繼承 →
 * section）時 arc 的 raw 是 false，只查一層會判 section 不在容器內，於是
 * 顯示成未繼承、還會放行 0.9.16.33 起禁止的「自標進度頁 ＋ 豁免」組合。
 *
 * @param loadAncestor 依 id 取祖先節點；查不到（已刪／新建頁）回 null 即停止
 * @param maxDepth 走訪上限，防資料成環（History 最深是 zone→chapter→arc→
 *   section→page 五層，8 已經很寬鬆）
 */
export async function resolveInProgressContainer(
  parentId: string | null | undefined,
  loadAncestor: (id: string) => Promise<ProgressAncestorNode | null>,
  maxDepth = 8
): Promise<boolean> {
  let cursor = parentId?.trim() || null;
  const seen = new Set<string>();
  for (let hop = 0; cursor && hop < maxDepth; hop++) {
    if (seen.has(cursor)) return false; // 資料成環，當作沒有容器
    seen.add(cursor);
    const node = await loadAncestor(cursor);
    if (!node) return false;
    const meta = node.metadata ?? null;
    // 自標優先於豁免：豁免只切斷「向上要」，不影響「自己是不是容器」
    if (isProgressPage(meta)) return true;
    if (isGateExempt(meta)) return false;
    cursor = node.parentId?.trim() || null;
  }
  return false;
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

  // 恆鎖定的 UI 目前只在 Concepts 露出（條目／群組／revision 層級），但解析
  // 與求值一律支援：資料寫得進去、讀出來卻被丟掉的話，症狀是「明明勾了卻
  // 沒鎖住」的靜默失效，比功能缺席難查得多。
  if (source.alwaysLocked === true) {
    condition.alwaysLocked = true;
  }

  return condition.requiresFlags ||
    condition.pristineOnly ||
    condition.alwaysLocked
    ? condition
    : null;
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
  let alwaysLocked = false;

  // 手動 gate（既有語意）
  const manual = parseGateCondition(node.metadata ?? null);
  if (manual) {
    manual.requiresFlags?.forEach((f) => flags.add(f));
    if (manual.pristineOnly) pristineOnly = true;
    if (manual.alwaysLocked) alwaysLocked = true;
  }

  // 依賴頁選擇（2026-07-03 修 #11）：前一個 sibling 若是 container
  // （有 progress leaves），本節點依賴其**最後一個 leaf** 的 completion
  // ——排除 static-locked/hidden（由 adapter 保證）。因為 leaves 之間
  // 已經是完整鏈（01-05 completed 需要 01-04 completed …），只要最
  // 後一個 completed 就代表全部走完。純 leaf sibling 沿用自身依賴。
  //   arc.02 前 sibling = arc.01（container）→ 最後 leaf = 01-05
  //     → 依賴 completed:01-05（讀完最後一節才解鎖 arc.02）
  //   01-02 前 sibling = 01-01（leaf）→ 依賴 completed:01-01
  const chainDepFor = (depId: string): string => {
    const leaves = tree.getProgressDescendantIds(depId);
    if (leaves.length === 0) return completionFlag(depId);
    return completionFlag(leaves[leaves.length - 1]);
  };

  // 本頁進度頁鏈：加上前一個進度 sibling 的完成依賴。
  // 「父容器繼承」（2026-07-03 修 #10）：父標為進度頁時，本節點即便
  // 未個別勾選也自動視為進度頁——省去使用者一個個 section 手動勾。
  // gateExempt 只切「父繼承」與「祖先繼承」，不影響本身若自標
  // progressPage 的同層鏈（原設計語意保留）。
  const parentIdForInherit = tree.getParentId(nodeId);
  const parentMetaForInherit = parentIdForInherit
    ? (tree.getNode(parentIdForInherit)?.metadata ?? null)
    : null;
  const selfIsExempt = isGateExempt(node.metadata ?? null);
  const selfIsProgress = isProgressPage(node.metadata ?? null);
  const inheritedFromParent =
    !selfIsExempt && isProgressPage(parentMetaForInherit);
  if (selfIsProgress || inheritedFromParent) {
    const prev = tree.getPreviousProgressSiblingId(nodeId);
    if (prev) {
      flags.add(chainDepFor(prev));
    } else if (inheritedFromParent && parentIdForInherit) {
      // 首節 fallback（2026-07-03 修 #11）：無前一 sibling + 父為
      // progress container → 依賴父自身 landing 讀完（用 completed
      // 而非 finished 避免循環：父的 container completeness 需要
      // 本節點完成，本節點又不能等父 container 完成）。
      flags.add(completionFlag(parentIdForInherit));
    }
  }

  // 容器繼承：走 parent chain，若父層是進度頁則加其鏈條件。
  // 豁免切斷點：自身標 gateExempt → 整段繼承跳過；
  // 祖先標 gateExempt → 走到該節點即停（其鏈條件也不加，子樹一併豁免）
  let cursorId: string | null | undefined = isGateExempt(node.metadata ?? null)
    ? null
    : tree.getParentId(nodeId);
  const walked: VisitSet = new Set([nodeId]);
  while (cursorId) {
    if (walked.has(cursorId)) break; // 環保護
    walked.add(cursorId);
    const parent = tree.getNode(cursorId);
    if (!parent) break;
    if (isGateExempt(parent.metadata ?? null)) break; // 豁免切斷點
    if (isProgressPage(parent.metadata ?? null)) {
      const parentPrev = tree.getPreviousProgressSiblingId(cursorId);
      if (parentPrev) flags.add(chainDepFor(parentPrev));
    }
    cursorId = tree.getParentId(cursorId);
  }

  if (flags.size === 0 && !pristineOnly && !alwaysLocked) return null;
  const result: GateCondition = {};
  if (flags.size > 0) result.requiresFlags = Array.from(flags);
  if (pristineOnly) result.pristineOnly = true;
  if (alwaysLocked) result.alwaysLocked = true;
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
 * 靜態鎖（`metadata.locked === true`）的頁面永遠視為未完成——按定義
 * 靜態鎖頁面不可被正常抵達，因此不存在合法完成，任何 completed 旗標
 * 都是孤兒（sweep 會清）。
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
  // 靜態鎖：不可被合法完成
  if (
    node.metadata &&
    typeof node.metadata === 'object' &&
    (node.metadata as Record<string, unknown>).locked === true
  ) {
    return false;
  }

  const nextVisit = new Set(visiting);
  nextVisit.add(nodeId);

  // Flag 快速路徑：頁面本身讀完（掃描線授旗）就算 completed，即使底下
  // sections 未讀完——這樣 arc landing 讀完就能推進、第一個 section 也
  // 能露出。gate 仍需通過（孤兒偵測：手動塞 completed:X 但依賴鏈不成立
  // 時仍視為未完成，供 sweep 清除）。
  const hasFlag = progress.flags.includes(completionFlag(nodeId));
  if (hasFlag) {
    const gate = effectiveGate(nodeId, tree);
    if (evaluateEffectiveGate(nodeId, progress, tree, gate, nextVisit)) {
      return true;
    }
  }

  // Container fallback：純目錄型頁（landing 無實質內容、無 flag）靠
  // 「底下 progress leaves 都有 flag」推得完成。用 flag-only 判定避免
  // 與「首節 gate 依賴父 flag」形成循環（否則 s1 gate 需要 completed:arc、
  // arc container 又需要 s1 completed → 死鎖）。
  const descendants = tree.getProgressDescendantIds(nodeId);
  if (descendants.length > 0) {
    return descendants.every((id) =>
      progress.flags.includes(completionFlag(id))
    );
  }

  return false;
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

  if (gate.alwaysLocked) return false;

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
