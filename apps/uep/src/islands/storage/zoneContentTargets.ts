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

/**
 * 各 zone Reader 的**捲動容器** CSS selector（07/25 三驗+，S9-A.8）。
 *
 * 用途：page 級 pinned 便條要「附著在頁面內容上」——需要相對此容器的
 * 內容座標定位，並在此容器 scroll 時同步位置。
 *
 * 五個 zone 都有各自的 overflow-y:auto 容器（Reader 內層捲動），
 * window 本身從不捲動：
 * - history: `.history-content` (`HistoryReader.css:509`)
 * - echoes:  `.echoes-content`  (`EchoesReader.css:197`)
 * - storage: `.sto-content`     (`StorageReader.tsx:1797` scrollRef)
 * - concepts:`.conc-content`    (`ConceptsReader.css:22`)
 * - visuals: `.visuals-content` (`VisualsReader.css:131`)
 *
 * 若 zone 未登記或 selector 找不到 → 回退 document.scrollingElement
 * （非 Reader 頁的極端 fallback）。
 */
const SCROLL_CONTAINER_SELECTORS: Record<string, string> = {
  history: '.history-content',
  echoes: '.echoes-content',
  storage: '.sto-content',
  concepts: '.conc-content',
  visuals: '.visuals-content',
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

/** 取該 zone 的**捲動容器** selector；未登記回 null（07/25 三驗+） */
export function getScrollContainerSelector(zone: string | null): string | null {
  if (!zone) return null;
  return SCROLL_CONTAINER_SELECTORS[zone] ?? null;
}

/**
 * 找當前 document 內該 zone 的捲動容器；找不到 fallback 到
 * document.scrollingElement（非 Reader 頁的極端退路）。
 * PinnedNoteLayer 用此決定 page 級 pinned 相對誰的 scrollTop 做補償。
 */
export function findScrollContainer(zone: string | null): HTMLElement | null {
  const selector = getScrollContainerSelector(zone);
  if (typeof document === 'undefined') return null;
  if (selector) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  // 極端 fallback：使用 documentElement（window scroll，若真的存在）
  return (document.scrollingElement as HTMLElement | null) ?? null;
}
