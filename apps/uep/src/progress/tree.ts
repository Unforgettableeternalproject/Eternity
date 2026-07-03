/**
 * UEP 進度系統 — Tree 感知適配器
 *
 * B 步驟引入的新概念：gating 求值不再只吃 metadata，還需要 tree 上下文
 * 才能算出「同層前一個進度頁」「父層繼承」「容器體 completed」等鏈條件。
 *
 * 適配器由消費端（HistoryReader）從 flatPages / tree 資料實作，
 * 純函式（effectiveGate、isEffectivelyCompleted）以此為唯一入口，
 * 保持與具體資料結構解耦、方便單元測試 mock。
 *
 * 「進度頁」定義：`metadata.progressPage === true`（見 gating.isProgressPage）。
 * 「同層前一個進度頁」：同 parent、sortOrder 較小、跳過非進度頁的最靠近 sibling。
 */

import { isProgressPage } from './gating';

/** tree 節點的最小介面：只需能取 metadata，其餘由 adapter 反查 */
export interface TreeNodeLike {
  metadata?: Record<string, unknown> | null;
}

/** Tree 上下文適配器 — 由消費端（如 HistoryReader）實作 */
export interface ProgressTreeAdapter {
  /** 依 id 取節點；找不到回傳 undefined（容錯） */
  getNode(id: string): TreeNodeLike | undefined;

  /** 取父節點；root 或找不到回傳 undefined */
  getParent(id: string): TreeNodeLike | undefined;

  /** 取父節點 id；root 回傳 null；找不到回傳 undefined */
  getParentId(id: string): string | null | undefined;

  /**
   * 同 parent 內、tree order 中的前一個進度頁 id。
   * 跳過非進度頁（番外/註解）。若無則 undefined（本頁是第一個進度頁）。
   */
  getPreviousProgressSiblingId(id: string): string | undefined;

  /**
   * 節點底下所有進度葉節點 id（container completeness 判定用）。
   * 「葉」= 該節點本身標為進度頁、且底下沒有其他進度頁；
   * 或是 progressPage children 遞迴展開到最深的進度頁節點。
   * 若節點本身非 container 或無進度後代，回傳 []。
   */
  getProgressDescendantIds(id: string): string[];
}

/** 具 id 與 children 的樹節點（collectProgressLeafIds 用的最小形狀） */
export interface ProgressTreeNode extends TreeNodeLike {
  id: string;
  children?: ProgressTreeNode[] | null;
}

/**
 * 收集節點底下的進度葉節點 id — getProgressDescendantIds 的參考實作。
 *
 * 依上方合約：「葉」= 本身標為進度頁、且子樹內沒有其他進度頁。
 * 因此進度頁若「有 children 但子樹內無進度後代」（例：標為進度的
 * section 底下掛圖片子頁），本身即視為葉，計入父容器的完成判定——
 * 這是 2026-07-03 審核發現的邊界修正（原實作遞迴時直接略過該節點）。
 *
 * 目標節點本身不計入（container completeness 只看後代；
 * 無後代的進度頁由 isEffectivelyCompleted 的 leaf fallback 處理）。
 *
 * **排除 hidden 與 static-locked**（2026-07-03 修正）：這兩類節點按定義
 * 不可被合法抵達完成，若計入會讓容器 completeness 永遠不成立、arc-to-arc
 * 的「倒數第二 leaf」判定亦失準。整個子樹一併跳過。
 *
 * **父容器繼承**（2026-07-03 修正 #10）：若容器本身標為進度頁，其直接
 * 子節點無論是否個別標記，都自動視為進度葉（節省手動一個一個勾）。
 * 想例外的子節點勾 `gateExempt`（切斷點語意，整個子樹一併豁免）。
 * 繼承只走一層——sub-sub 節點不會層層自動繼承，除非各層都標進度頁。
 *
 * 順序保證：DFS in tree order，供 `isProgressionChainHidden` 的
 * penultimate/last leaf 規則使用。
 */
export function collectProgressLeafIds(node: ProgressTreeNode): string[] {
  const acc: string[] = [];
  const inheritFromRoot = isProgressPage(node.metadata ?? null);

  const walk = (current: ProgressTreeNode, inheritFromParent: boolean) => {
    for (const child of current.children ?? []) {
      const meta = (child.metadata ?? {}) as Record<string, unknown>;
      // hidden / static-locked：整段子樹排除
      if (meta.hidden === true || meta.locked === true) continue;

      const isSelfProgress = isProgressPage(meta);
      const isSelfExempt = meta.gateExempt === true;
      // gateExempt 切「父繼承」，但不影響本身若明確標 progressPage 的效果
      // （原豁免語意保留：豁免頁若同時標進度頁 → 仍計入父容器完成判定）
      const isEffectiveProgress =
        isSelfProgress || (inheritFromParent && !isSelfExempt);
      // pass down 給子孫：只有本身標為 progress container 才傳遞繼承
      // （繼承只走一層，孫層要重新看自己父的標記）
      const passDownInherit = isSelfProgress;

      const before = acc.length;
      walk(child, passDownInherit);
      // 子樹沒貢獻任何進度葉、且本節點被視為進度頁 → 本節點即為葉
      if (isEffectiveProgress && acc.length === before) acc.push(child.id);
    }
  };
  walk(node, inheritFromRoot);
  return acc;
}

/**
 * 節點是否為「有效進度頁」——本身標記或父容器標記後繼承。
 *
 * 供 adapter 端與求值層共用。單層繼承：只看直接父的 progressPage 標記。
 * gateExempt 為切斷點——本節點若豁免則不視為進度頁（即使父容器標記）。
 */
export function isEffectiveProgressPage(
  metadata: Record<string, unknown> | null | undefined,
  parentMetadata: Record<string, unknown> | null | undefined
): boolean {
  if (!metadata) return false;
  if (metadata.gateExempt === true) return false;
  if (isProgressPage(metadata)) return true;
  return isProgressPage(parentMetadata ?? null);
}
