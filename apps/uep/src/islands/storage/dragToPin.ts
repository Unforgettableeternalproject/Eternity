/**
 * 便條拖曳釘選 — 純函式 + hook（S9-A.6）
 *
 * pool 便條被拖到頁面內容上時的落地判定：
 *  1. `elementFromPoint(x, y)` 找命中元素
 *  2. 元素 `closest('.history-prose, .echoes-prose, .sto-prose')` 找 zone 內容容器
 *  3. 命中容器 → `findNearestAnchor(container, x, y)` → element 錨點 pin
 *  4. 沒命中容器 or 互動頁 → page 級 pin（drop 點相對 viewport 存偏移）
 *
 * 不用 HTML5 DnD——它對 fixed/z-index 不友善、drop zone 難自訂、
 * ghost 樣式也很難控。改用 pointer events + setPointerCapture。
 *
 * 拖曳門檻：pointerdown → 移動 > `DRAG_THRESHOLD` 才算拖（避免跟 click 衝突）。
 */

import { getPageContext } from '../../utils/pageContext';
import { extractZone } from '../useCurrentLocation';

import { findNearestAnchor } from './contentAnchors';
import { getPinnedStore } from './pinnedStore';
import type { PinnedNote } from './pinnedStore';

/** 拖曳判定門檻（px）——低於這個位移量還原成 click */
export const DRAG_THRESHOLD = 6;

/** 所有支援 element 錨點的內容容器 selector（合併字串） */
const CONTENT_CONTAINER_SELECTOR = '.history-prose, .echoes-prose, .sto-prose';

export interface DropTarget {
  /** drop 落在支援 element 錨點的容器 */
  kind: 'element';
  container: HTMLElement;
  anchorId: string;
  offsetX: number;
  offsetY: number;
}

export interface DropTargetPage {
  /** drop 落在頁面（互動頁降級 or 容器外） */
  kind: 'page';
  offsetX: number;
  offsetY: number;
}

export type DropResolution = DropTarget | DropTargetPage;

/**
 * 依 drop 點在頁面上的座標，解析出應該建立的釘選型態。
 * 純函式（依賴 DOM 但不修改）——測試可用 stubbed elementFromPoint。
 */
export function resolveDropTarget(
  clientX: number,
  clientY: number
): DropResolution {
  if (typeof document === 'undefined') {
    return { kind: 'page', offsetX: 0, offsetY: 0 };
  }

  // 找命中元素 → 找容器
  const target = document.elementFromPoint(clientX, clientY);
  const container = target?.closest<HTMLElement>(CONTENT_CONTAINER_SELECTOR);

  if (container) {
    const hit = findNearestAnchor(container, clientX, clientY);
    if (hit) {
      return {
        kind: 'element',
        container,
        anchorId: hit.anchorId,
        offsetX: hit.offsetX,
        offsetY: hit.offsetY,
      };
    }
  }

  // page 級 fallback：drop 點相對 viewport 右下角的偏移（PinnedNoteLayer 用同角落定位）
  return {
    kind: 'page',
    // right/bottom 座標的正向偏移——右下角基準
    offsetX: Math.max(0, window.innerWidth - clientX - 16),
    offsetY: Math.max(0, window.innerHeight - clientY - 16),
  };
}

/**
 * 把 drop 解析結果轉成 PinnedNote 並寫入 pinnedStore。
 * pathname / search / zone / pageLabel 從當前 location 快照——
 * search 讓釘選能對回到正確的 Reader 子頁（S9-A Codex #1）。
 */
export function commitPin(
  noteId: string,
  resolution: DropResolution
): PinnedNote {
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : '';
  const search =
    typeof window !== 'undefined' ? window.location.search || '' : '';
  const zone = extractZone(pathname);
  // pageLabel 以 pageContext（Reader 路由解析發佈）為準——document.title
  // 只有 zone 主層資訊，倒推指不出實際文章（艾斯維爾 07/24 定案）
  const pageLabel =
    getPageContext().label ??
    (typeof document !== 'undefined' ? document.title || '' : '');
  const now = new Date().toISOString();

  const pinned: PinnedNote =
    resolution.kind === 'element'
      ? {
          noteId,
          pagePath: pathname,
          pageSearch: search,
          zone,
          pageLabel,
          anchorKind: 'element',
          anchorId: resolution.anchorId,
          offsetX: resolution.offsetX,
          offsetY: resolution.offsetY,
          createdAt: now,
        }
      : {
          noteId,
          pagePath: pathname,
          pageSearch: search,
          zone,
          pageLabel,
          anchorKind: 'page',
          anchorId: null,
          offsetX: resolution.offsetX,
          offsetY: resolution.offsetY,
          createdAt: now,
        };

  getPinnedStore().pin(pinned);
  return pinned;
}

/**
 * sessionStorage key —— 點暗掉便條 → 導向釘選頁時傳遞 noteId，
 * PinnedNoteLayer 到頁後讀取並 scrollIntoView。
 */
export const JUMP_TO_PINNED_KEY = 'uep.storage.jumpToPinned';

/**
 * 讀並清 jumpToPinned flag——PinnedNoteLayer 掛回來時呼叫。
 */
export function takeJumpToPinned(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.sessionStorage.getItem(JUMP_TO_PINNED_KEY);
    if (v) window.sessionStorage.removeItem(JUMP_TO_PINNED_KEY);
    return v;
  } catch {
    return null;
  }
}

/**
 * 點暗掉便條 → 導向到該便條的釘選頁 + 記錄 noteId 供到頁後跳。
 * 同頁不重載（用 replaceState + scrollIntoView）；跨頁 assign。
 *
 * canonical location = pathname + search（S9-A Codex #1）——各 Reader 的
 * `useZoneRouter` 用 pushState/replaceState 在同 pathname 下切 query，
 * 若釘選在別的子頁（`?page=…`），必須：
 *  - 同 pathname 但 query 不同 → pushState 到目標 query，讓 Reader 內部
 *    react 到 URL 變化並載入對應內容；到內容 render 完 PinnedNoteLayer
 *    scrollIntoView 接手。
 *  - 不同 pathname → 整頁 assign（跨 zone 只能重載）。
 */
export function navigateToPinned(pinned: PinnedNote): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(JUMP_TO_PINNED_KEY, pinned.noteId);
  } catch {
    // 靜默；到頁後找不到便條也不影響 PinnedNoteLayer 正常渲染
  }
  const targetSearch = pinned.pageSearch || '';
  const currentPath = window.location.pathname;
  const currentSearch = window.location.search || '';
  if (currentPath === pinned.pagePath) {
    if (currentSearch !== targetSearch) {
      // 同 pathname 但子頁不同——pushState 只改 URL，**不會**產生 popstate
      // 事件（規範限制，只有瀏覽器 back/forward 才觸發）。useZoneRouter 只
      // 監聽 popstate 決定切子頁——必須手動派 PopStateEvent 讓它接手載入
      // 對應內容，否則 URL 換了但頁面不切（07/25 三驗根因）。
      // 沿 historyIslandData.navigateToHistoryPage / TerminalIsland
      // 已建立的模式。
      window.history.pushState({}, '', pinned.pagePath + targetSearch);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    // 同頁 / 子頁切換 —— 讓 PinnedNoteLayer scrollIntoView 接手
    window.dispatchEvent(new CustomEvent('uep:storage-jump'));
  } else {
    window.location.assign(pinned.pagePath + targetSearch);
  }
}
