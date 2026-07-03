/**
 * UEP 進度系統 — 掃描線標記點的共用常數與純函式
 *
 * 標記點有兩種來源，在 DOM 中以文件順序統一編號：
 * 1. 分隔線 `<hr>` — 內容中的天然標記點（自動）
 * 2. `div[data-role="progress-marker"]` — 編輯器手動插入的
 *    ProgressMarkerNode；帶 `data-grants-flags` 者為 FlagMarker，
 *    掃描線通過時授予對應旗標（位置粒度授予）
 *
 * 此檔案不碰 store 也不碰 React——編輯器（TipTap node）與前台
 * （useScanline）都從這裡取用，確保序列化格式只有一份定義。
 */

/** 進度標記在 HTML 中的 data-role 值 */
export const PROGRESS_MARKER_ROLE = 'progress-marker';

/** 掃描線監聽的標記點選擇器（hr 自動標記 + 手動標記，文件順序） */
export const PROGRESS_MARKER_SELECTOR = `hr, [data-role="${PROGRESS_MARKER_ROLE}"]`;

/** 解析 data-grants-flags 屬性（逗號分隔 → 去空白、去空值、去重複） */
export function parseFlagsAttr(value: string | null | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0)
    ),
  ];
}

/** 序列化旗標陣列為 data-grants-flags 屬性值 */
export function serializeFlagsAttr(flags: string[]): string {
  return parseFlagsAttr(flags.join(',')).join(',');
}

/** 掃描線觀察的單一標記點 */
export interface ScanMarker {
  /** 對應的 DOM 元素 */
  el: Element;
  /** 文件順序索引（0-based） */
  index: number;
  /** 通過時授予的旗標（hr 與一般標記為空陣列） */
  grantsFlags: string[];
}

/**
 * 從文章容器收集所有標記點（文件順序）。
 * 注意：回傳的是當下 DOM 快照，內容重渲染後需重新收集。
 */
export function collectMarkers(container: Element): ScanMarker[] {
  return Array.from(container.querySelectorAll(PROGRESS_MARKER_SELECTOR)).map(
    (el, index) => ({
      el,
      index,
      grantsFlags:
        el.getAttribute('data-role') === PROGRESS_MARKER_ROLE
          ? parseFlagsAttr(el.getAttribute('data-grants-flags'))
          : [],
    })
  );
}

/** 完成判定：通過最後一個標記點（totalMarkers 含文末哨兵） */
export function isPageCompleted(
  maxMarkerIdx: number,
  totalMarkers: number
): boolean {
  return totalMarkers > 0 && maxMarkerIdx >= totalMarkers - 1;
}

/** 頁面完成旗標的命名慣例（gating 統一以旗標消費完成狀態） */
export function completionFlag(pageId: string): string {
  return `completed:${pageId}`;
}
