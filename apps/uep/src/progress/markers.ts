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

import type { ProgressState } from './types';

/** 進度標記在 HTML 中的 data-role 值 */
export const PROGRESS_MARKER_ROLE = 'progress-marker';
/** Echoes 插播標記；同樣由掃描線觀察，但不走 grantsFlags 屬性。 */
export const ECHO_SPOT_ROLE = 'echo-spot';
/**
 * Visual Clue 成對錨點（S8 下半場 V-D）：同 data-clue-id 的起訖兩個
 * 隱形標記，界定書籤按鈕浮現的橋段區間。同樣由掃描線觀察、
 * 不走 grantsFlags；區間內外判定由 useVisualClues 消費端負責。
 */
export const VISUAL_CLUE_START_ROLE = 'visual-clue-start';
export const VISUAL_CLUE_END_ROLE = 'visual-clue-end';

/** 掃描線監聽的標記點選擇器（hr 自動標記 + 手動標記，文件順序） */
export const PROGRESS_MARKER_SELECTOR = `hr, [data-role="${PROGRESS_MARKER_ROLE}"], [data-role="${ECHO_SPOT_ROLE}"], [data-role="${VISUAL_CLUE_START_ROLE}"], [data-role="${VISUAL_CLUE_END_ROLE}"]`;

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
  /** hr / progress-marker / echo-spot / visual-clue-*，供額外消費端辨識。 */
  role:
    | 'hr'
    | typeof PROGRESS_MARKER_ROLE
    | typeof ECHO_SPOT_ROLE
    | typeof VISUAL_CLUE_START_ROLE
    | typeof VISUAL_CLUE_END_ROLE;
}

/**
 * 從文章容器收集所有標記點（文件順序）。
 * 注意：回傳的是當下 DOM 快照，內容重渲染後需重新收集。
 */
export function collectMarkers(container: Element): ScanMarker[] {
  return Array.from(container.querySelectorAll(PROGRESS_MARKER_SELECTOR)).map(
    (el, index) => {
      const dataRole = el.getAttribute('data-role');
      const role =
        dataRole === PROGRESS_MARKER_ROLE
          ? PROGRESS_MARKER_ROLE
          : dataRole === ECHO_SPOT_ROLE
            ? ECHO_SPOT_ROLE
            : dataRole === VISUAL_CLUE_START_ROLE
              ? VISUAL_CLUE_START_ROLE
              : dataRole === VISUAL_CLUE_END_ROLE
                ? VISUAL_CLUE_END_ROLE
                : 'hr';
      return {
        el,
        index,
        role,
        grantsFlags:
          role === PROGRESS_MARKER_ROLE
            ? parseFlagsAttr(el.getAttribute('data-grants-flags'))
            : [],
      };
    }
  );
}

/**
 * 完成判定：通過文末哨兵。
 * totalMarkers = 內容標記點數（不含哨兵），哨兵索引 = totalMarkers，
 * 因此完成時 maxMarkerIdx === totalMarkers（數字直覺對齊：max = total）。
 */
export function isPageCompleted(
  maxMarkerIdx: number,
  totalMarkers: number
): boolean {
  return maxMarkerIdx >= totalMarkers;
}

/** 頁面完成旗標的命名慣例（gating 統一以旗標消費完成狀態） */
export function completionFlag(pageId: string): string {
  return `completed:${pageId}`;
}

/**
 * 續讀判定：回傳「回到上次位置」提示應指向的標記索引，
 * 不該提示時回傳 null。
 *
 * 不提示的情況：
 * - 沒有進度紀錄，或上次位置在開頭（lastMarkerIdx <= 0）
 * - 頁面已完成（completedPageIds 或 max 已達哨兵）——讀完後回捲
 *   會讓 lastMarkerIdx 變小，但完成狀態不會消失，不該再提示
 * - lastMarkerIdx 落在哨兵（>= totalMarkers），無對應內容標記元素
 */
export function resolveResumeMarkerIdx(
  state: ProgressState,
  pageId: string
): number | null {
  const progress = state.pageMarkers[pageId];
  if (!progress || progress.lastMarkerIdx <= 0) return null;
  if (state.completedPageIds.includes(pageId)) return null;
  if (isPageCompleted(progress.maxMarkerIdx, progress.totalMarkers))
    return null;
  if (progress.lastMarkerIdx >= progress.totalMarkers) return null;
  return progress.lastMarkerIdx;
}
