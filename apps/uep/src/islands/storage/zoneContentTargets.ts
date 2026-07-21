/**
 * 便條釘選 — zone 內容容器 selector 對照（S9-A.5）
 *
 * 各 zone 的內容容器 class 不同：
 *  - History：`.history-prose`（單一 prose，全連續文章）
 *  - Echoes content 頁：`.echoes-prose`
 *  - Storage blog/dialogue/log 頁：`.sto-prose`
 *  - Concepts / Visuals：互動元件頁，**沒有連續文字流**——降級為頁面級
 *
 * 釘選層依 zone 查對照表：
 *  - `element` 錨點：找得到容器 → 相對容器 absolute 定位
 *  - `page` 級：viewport 固定側（互動頁或錨點失效 fallback）
 *
 * 同一頁可能有多個 prose 容器（Storage/Echoes 分頁多 rich_text）——
 * 我們用 querySelectorAll 掃全部，PinnedNoteLayer 逐一比對 anchorId 存在性
 * 找到真正該掛的容器。
 */

import { extractZone } from '../useCurrentLocation';

/** 「文字頁」zone → 內容容器 CSS selector（同一 zone 同 selector） */
const ELEMENT_ANCHOR_SELECTORS: Record<string, string> = {
  history: '.history-prose',
  echoes: '.echoes-prose',
  storage: '.sto-prose',
};

/** 判定該 zone 是否支援 element 錨點（否則走 page 級降級） */
export function supportsElementAnchor(zone: string | null): boolean {
  return zone !== null && zone in ELEMENT_ANCHOR_SELECTORS;
}

/** 取該 zone 的內容容器 selector；不支援 element 錨點時回 null */
export function getContentSelector(zone: string | null): string | null {
  if (!zone) return null;
  return ELEMENT_ANCHOR_SELECTORS[zone] ?? null;
}

/**
 * 從 pathname 直接查對應的內容容器 selector（合成便利函式）。
 */
export function getContentSelectorForPath(pathname: string): string | null {
  return getContentSelector(extractZone(pathname));
}

/**
 * 掃當前 document 找所有 zone 內容容器實例（同一頁可能有多個 prose 塊）。
 * 用於 PinnedNoteLayer 找釘選便條的實際掛載容器。
 */
export function findContentContainers(zone: string | null): HTMLElement[] {
  const selector = getContentSelector(zone);
  if (!selector || typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLElement>(selector));
}
