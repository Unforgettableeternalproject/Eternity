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
 */
export function collectProgressLeafIds(node: ProgressTreeNode): string[] {
  const acc: string[] = [];
  const walk = (current: ProgressTreeNode) => {
    for (const child of current.children ?? []) {
      const isProgress = isProgressPage(child.metadata ?? null);
      const before = acc.length;
      walk(child);
      // 子樹沒貢獻任何進度葉、且 child 本身是進度頁 → child 即為葉
      if (isProgress && acc.length === before) acc.push(child.id);
    }
  };
  walk(node);
  return acc;
}
