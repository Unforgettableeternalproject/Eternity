/**
 * pageContext — 當前子頁位置的路由級真相（S9-A 驗收根因 E）
 *
 * 「目前在哪一頁」不可從 document.title 倒推——各 zone layout 只給主層
 * title，且 title 更新沒有標準事件，島 header / 釘選 pageLabel 讀到的
 * 永遠是殘值（艾斯維爾 07/24 定案：一律由路由解析）。
 *
 * 真相來源是各 Reader：它們本來就把 `?page=` 等 query 解析成內容樹上的
 * 節點（history 的 zone/chapter/arc/section 等），解析完成即發佈：
 *  - `label`：當前子頁標題（null = 停在 zone 主層）
 *  - `trail`：祖先鏈標題（如 ['第一章', '殘響之弧']），可空
 *
 * 消費端：useCurrentLocation（島 header 位置條）、dragToPin.commitPin
 * （釘選 pageLabel 快照）。
 *
 * ⚠️ Reader 與浮島是不同 Astro island bundle，module-level state 不共享
 * ——狀態一律放 window bridge，變更派 window event（沿 progressStore /
 * pinnedStore 慣例）。SSR 期間全部 no-op。
 */

export interface PageContext {
  /** 當前子頁標題；null = zone 主層（landing） */
  label: string | null;
  /** 祖先鏈標題（不含 zone 本身、不含當前頁），由淺至深 */
  trail: string[];
}

export const PAGE_CONTEXT_CHANGE_EVENT = 'uep:page-context-change';

declare global {
  interface Window {
    __uepPageContext?: PageContext;
  }
}

const EMPTY: PageContext = { label: null, trail: [] };

/** 取當前 pageContext；SSR / 尚未發佈時回空值 */
export function getPageContext(): PageContext {
  if (typeof window === 'undefined') return EMPTY;
  return window.__uepPageContext ?? EMPTY;
}

/**
 * 發佈當前子頁位置（Reader 於路由解析完成時呼叫）。
 * 內容沒變時不派事件（Reader effect 重跑不應觸發下游重算）。
 */
export function setPageContext(
  label: string | null,
  trail: string[] = []
): void {
  if (typeof window === 'undefined') return;
  const prev = getPageContext();
  const normLabel = label && label.trim() ? label.trim() : null;
  if (
    prev.label === normLabel &&
    prev.trail.length === trail.length &&
    prev.trail.every((t, i) => t === trail[i])
  ) {
    return;
  }
  window.__uepPageContext = { label: normLabel, trail: [...trail] };
  window.dispatchEvent(new CustomEvent(PAGE_CONTEXT_CHANGE_EVENT));
}

/** 清空（Reader unmount / 回 landing）——等同 setPageContext(null) */
export function clearPageContext(): void {
  setPageContext(null, []);
}
