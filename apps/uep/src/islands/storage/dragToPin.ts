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
import type { AnchorHit } from './contentAnchors';
import { getPinnedStore } from './pinnedStore';
import type { PinnedNote } from './pinnedStore';
import { findScrollContainer } from './zoneContentTargets';

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
 * 拖曳時「便條左上角相對指標」的偏移（通常為負值——抓在便條中間拖時，
 * 左上角在指標的左上方）。
 *
 * 為什麼需要它：釘選存的 offset 是「便條左上角相對錨點」，還原時
 * `left = anchorRect.left + offsetX` 直接把**左上角**貼到該座標。若落點
 * 解析拿指標座標當 offset，放開瞬間便條就會往右下跳一整個抓取偏移量
 * ——艾斯維爾 07/25 四驗回報的「拖曳卡卡」主因。
 *
 * 落點**判定**（命中哪個容器 / 哪個錨點）仍用指標座標：使用者感知的
 * 落點是游標，不是便條的角。只有存下來的**偏移**改用左上角。
 */
export interface GrabOffset {
  dx: number;
  dy: number;
}

/** 無抓取偏移（呼叫端本來就傳左上角座標時用） */
const NO_GRAB: GrabOffset = { dx: 0, dy: 0 };

/**
 * 依 drop 點在頁面上的座標，解析出應該建立的釘選型態。
 * 純函式（依賴 DOM 但不修改）——測試可用 stubbed elementFromPoint。
 *
 * `grab` 為便條左上角相對 (clientX, clientY) 的偏移，見 {@link GrabOffset}。
 */
export function resolveDropTarget(
  clientX: number,
  clientY: number,
  grab: GrabOffset = NO_GRAB
): DropResolution {
  if (typeof document === 'undefined') {
    return { kind: 'page', offsetX: 0, offsetY: 0 };
  }

  // 1. 先試 drop 點正上方：落在 prose 容器內 → 綁該容器最近 anchor
  const target = document.elementFromPoint(clientX, clientY);
  const container = target?.closest<HTMLElement>(CONTENT_CONTAINER_SELECTOR);

  if (container) {
    const hit = findNearestAnchor(container, clientX, clientY);
    if (hit) {
      return {
        kind: 'element',
        container,
        anchorId: hit.anchorId,
        offsetX: hit.offsetX + grab.dx,
        offsetY: hit.offsetY + grab.dy,
      };
    }
  }

  // 2. 07/25 三驗+：drop 落在 prose 外 → 掃全頁 prose 容器，取整體
  //    距離最近的 anchor 綁定（不局限於 drop 點正上方的容器）。這樣
  //    「拖到螢幕邊緣、圖片區、邊欄」等 prose 外的位置也能綁 anchor，
  //    scroll sync 自然跟著內容捲；否則走 page 級固定 viewport 不動，
  //    使用者向下捲時便條不會跟著頁面走（艾斯維爾三驗回饋）。
  // for-of 而非 forEach——TS 追不到 forEach 閉包內的 mutation，會把
  // outer let 收窄回 null，用 for-of 才能正常 narrow。
  const allContainers = document.querySelectorAll<HTMLElement>(
    CONTENT_CONTAINER_SELECTOR
  );
  let bestContainer: HTMLElement | null = null;
  let bestHit: AnchorHit | null = null;
  for (const c of allContainers) {
    const hit = findNearestAnchor(c, clientX, clientY);
    if (!hit) continue;
    if (!bestHit || hit.distance < bestHit.distance) {
      bestHit = hit;
      bestContainer = c;
    }
  }
  if (bestContainer && bestHit) {
    return {
      kind: 'element',
      container: bestContainer,
      anchorId: bestHit.anchorId,
      offsetX: bestHit.offsetX + grab.dx,
      offsetY: bestHit.offsetY + grab.dy,
    };
  }

  // 3. 頁面完全沒 prose（storage stuff、concepts 互動頁）→ page 級 fallback
  //    07/25 三驗+ 語意調整：改用「相對 scroll container 內容左上角的座標」
  //    （scrollLeft+clientX-containerLeft, scrollTop+clientY-containerTop）
  //    ——這樣便條會附著在頁面內容上、隨 container scroll 跟著捲；
  //    舊語意「相對 viewport 右下角」讓便條固定在螢幕角落，違反艾斯維爾
  //    三驗要求的「附著頁面」行為。找不到 container 時退為 client 座標
  //    加當前 scroll 相當於「當前 viewport 位置對應的內容座標」。
  const zone = extractZone(window.location.pathname);
  const scrollContainer = findScrollContainer(zone);
  const scrollRect = scrollContainer?.getBoundingClientRect();
  const contentX =
    (scrollContainer?.scrollLeft ?? 0) +
    clientX +
    grab.dx -
    (scrollRect?.left ?? 0);
  const contentY =
    (scrollContainer?.scrollTop ?? 0) +
    clientY +
    grab.dy -
    (scrollRect?.top ?? 0);
  return {
    kind: 'page',
    offsetX: Math.max(0, contentX),
    offsetY: Math.max(0, contentY),
  };
}

/**
 * 展開中的便條島根元素 selector（`DraggableIsland` 根 class
 * `uep-island` + `IslandHost` 傳入的 `uep-island--${id}`）。
 * 收合成 dock chip 時這個元素不存在——艾斯維爾 07/25 定案：**只有展開的
 * 便條島**是拆除目標，收合狀態下拖曳仍照常釘到頁面上。
 */
const STORAGE_ISLAND_SELECTOR = '.uep-island--storage';

/**
 * 判定放開點是否落在展開的便條島上 → 語意為「把便條收回島裡」（解除釘選）。
 *
 * ⚠️ 呼叫端必須確保拖曳中的卡片是 `pointer-events: none`（CSS `.is-dragging`），
 * 否則 `elementFromPoint` 會命中卡片自己而永遠判不到島。
 */
export function isUnpinDropTarget(clientX: number, clientY: number): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof document.elementFromPoint !== 'function') return false;
  const target = document.elementFromPoint(clientX, clientY);
  return target?.closest(STORAGE_ISLAND_SELECTOR) != null;
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
