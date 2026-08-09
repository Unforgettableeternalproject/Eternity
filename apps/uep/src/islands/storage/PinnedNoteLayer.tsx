/**
 * PinnedNoteLayer — 全站釘選便條層（S9-A.5）
 *
 * 掛在 IslandHost portal 內，但**獨立於任何浮島的開合**——就算所有島都
 * 收合、或使用者沒開任何島，只要 storage 島有解鎖（未停用、桌面、探索者），
 * 場上的釘選便條都要繼續顯示。
 *
 * 訂閱：
 *  - `usePinnedNotes()` — 全部釘選（走 pinnedStore singleton）
 *  - `useCurrentLocation()` — 當前 pathname / zone（跨頁重算過濾）
 *  - `useProgress()` — 便條本體（inline 編輯要拿到最新 text）
 *
 * 定位策略（每張便條）：
 *  1. `anchorKind: 'element'`：
 *     a. 找 zone 內容容器（`.history-prose` 等）——可能多個
 *     b. 逐個容器 `resolveAnchorRect(container, anchorId)`
 *     c. exact/nearest 命中 → fixed（viewport 座標）+ 捲動時追蹤錨點元素
 *     d. 全部 top → 退容器頂端 + 顯示「原位置已變動」小提示
 *     e. 全部找不到（fixed） → viewport 固定右下（page 級 fallback）
 *  2. `anchorKind: 'page'`：viewport 相對固定位置
 *
 * ⚠️ 定位一律 `position: fixed`（viewport 座標）而非 absolute + window
 * scroll offset——各 Reader 是**內層容器捲動**（`.history-content` 等
 * overflow auto），window 從不捲動，用 window.scrollX/Y 換算會讓便條
 * 永遠停在初算的 viewport 位置（S9-A 驗收根因 C）。element 錨點的追蹤
 * 走 capture-phase scroll 監聽（scroll 不冒泡，但 capture 會經過 window）
 * + rAF 直寫 style，不進 React state，避免捲動高頻 re-render。
 *
 * 錨點會隨頁面重排失效——`refreshTick` 每次 `useCurrentLocation` 變化 +
 * mount 時遞增，觸發 rect 重算；不用 mutation observer（成本高、大部分
 * 情境不需要）。
 *
 * ⚠️ 手機/窄視窗一律不掛（沿浮島相關功能守門）——PinnedNoteLayer 的
 * mount 由呼叫端（IslandHost）自行守門，本元件只負責畫。
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  STORAGE_NOTE_TEXT_MAX,
  getProgressManager,
  useProgress,
} from '../../progress';
import type { StorageNote } from '../../progress';
import { getSetting } from '../../lib/uepSettings';
import { markChipAttention } from '../chipAttention';
import { HOME_ZONE_ID, useCurrentLocation } from '../useCurrentLocation';

import { resolveAnchorRect } from './contentAnchors';
import type { ResolvedAnchor } from './contentAnchors';
import {
  DRAG_THRESHOLD,
  commitPin,
  isUnpinDropTarget,
  resolveDropTarget,
  takeJumpToPinned,
} from './dragToPin';
import type { GrabOffset } from './dragToPin';
import { formatCapturedAt, formatLocationLabel } from './noteMeta';
import { getPinnedStore, matchesLocation } from './pinnedStore';
import type { PinnedNote } from './pinnedStore';
import { usePinnedNotes } from './usePinnedNotes';
import {
  findContentContainers,
  findScrollContainer,
} from './zoneContentTargets';

import layerCss from './PinnedNoteLayer.css?inline';
import { useDeferredStyle } from '../useDeferredStyle';

/** 定位計算的結果 */
interface PinnedPlacement {
  /** 便條要用的 style（left/top/position），呼叫端直接展開 */
  style: React.CSSProperties;
  /** 是否走 fallback（顯示提示） */
  kind: ResolvedAnchor['kind'] | 'page';
  /** page 級（viewport）或 element 錨點命中 */
  origin: 'element' | 'page' | 'fixed';
  /**
   * 捲動追蹤目標：exact/nearest = 錨點元素、top = 容器；page/fixed 為
   * null（viewport 固定不追）。捲動 sync 直接讀此元素的 rect 更新便條
   * style，不重跑 React render。
   */
  trackEl: HTMLElement | null;
}

/** 由 PinnedNote 算出位置 style（每次 refresh 重算） */
function computePlacement(
  pinned: PinnedNote,
  zone: string | null
): PinnedPlacement {
  // page 級釘選（07/25 三驗+ 語意）：offsetX/Y 是相對於 scroll container
  // 內容左上角的座標；render 用 fixed 定位 + 減去 container.scrollLeft/Top
  // 補償，這樣便條會附著在頁面內容上、隨 container scroll 一起走。
  // trackEl 設為 container 供 sync effect 追它的 scroll 事件。
  if (pinned.anchorKind === 'page') {
    const container = findScrollContainer(zone);
    if (container) {
      const rect = container.getBoundingClientRect();
      return {
        style: {
          position: 'fixed',
          left: rect.left + pinned.offsetX - container.scrollLeft,
          top: rect.top + pinned.offsetY - container.scrollTop,
        },
        kind: 'page',
        origin: 'page',
        trackEl: container,
      };
    }
    // 找不到 container（非 Reader 頁的極端 fallback）→ 用 offset 當
    // viewport 座標，至少能顯示出來（雖然不會跟頁面走，但也沒得追）
    return {
      style: {
        position: 'fixed',
        left: pinned.offsetX,
        top: pinned.offsetY,
      },
      kind: 'page',
      origin: 'page',
      trackEl: null,
    };
  }

  // element 錨點：找容器 → resolveAnchorRect
  const containers = findContentContainers(zone);
  if (containers.length === 0 || !pinned.anchorId) {
    // 容器不在 → 退 fixed page 級（設計文件的第 4 層 fallback）
    return {
      style: {
        position: 'fixed',
        right: 16 + pinned.offsetX,
        bottom: 16 + pinned.offsetY,
      },
      kind: 'fixed',
      origin: 'fixed',
      trackEl: null,
    };
  }

  // 掃所有容器找 exact 命中（同一頁可能多 prose 塊——S9-A Codex #3
  // 頁級一次編號後，錨點跨容器唯一，理論上最多一個 exact）；沒 exact 就
  // 記下最後一個 nearest；都無 → top。用 union 型別包含 'unmatched' 初值
  // 讓 exact 短路 + nearest 蓋值的流程不觸發 TS2367 不可能比較（S9-A
  // Codex 品質門檻）。
  let bestKind: 'exact' | 'nearest' | 'unmatched' = 'unmatched';
  let bestContainer: HTMLElement = containers[0];
  let bestElement: HTMLElement | null = null;
  for (const container of containers) {
    const resolved = resolveAnchorRect(container, pinned.anchorId);
    if (resolved.kind === 'exact') {
      bestKind = 'exact';
      bestContainer = container;
      bestElement = resolved.element;
      break;
    }
    if (resolved.kind === 'nearest') {
      // exact 會 break 出去，走到這一定尚未定 exact；直接蓋 nearest
      bestKind = 'nearest';
      bestContainer = container;
      bestElement = resolved.element;
    }
  }

  if (bestKind === 'unmatched') {
    // 沒任何容器有此錨點 → 退第一個容器頂端 + 提示；捲動時追容器
    const containerRect = bestContainer.getBoundingClientRect();
    return {
      style: {
        position: 'fixed',
        left: containerRect.left + pinned.offsetX,
        top: containerRect.top + pinned.offsetY,
      },
      kind: 'top',
      origin: 'element',
      trackEl: bestContainer,
    };
  }

  // exact / nearest：抓命中元素的 rect（viewport 座標，fixed 直接用）
  const el = bestElement!;
  const rect = el.getBoundingClientRect();
  return {
    style: {
      position: 'fixed',
      left: rect.left + pinned.offsetX,
      top: rect.top + pinned.offsetY,
    },
    kind: bestKind,
    origin: 'element',
    trackEl: el,
  };
}

/**
 * 拖曳中的便條懸在便條島上方時掛在 `<body>` 的 class，讓 CSS 把島高亮成
 * 「可接收」狀態。
 *
 * ⚠️ 為什麼掛 body 而不是直接 `島.classList.add()`：島的根 className 是
 * `DraggableIsland` 用模板字串每次 render 重算的，直接加 class 會在島的
 * 任何一次 re-render（pool 內容變動、拖曳位置更新…）被整串覆蓋掉。
 * 掛 body + 後代選擇器不受 React 重繪影響，沿用專案既有的
 * `zoneEntryLock` body class 模式。
 */
const UNPIN_HOVER_BODY_CLASS = 'uep-pin-unpin-hover';

function setUnpinHover(on: boolean): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle(UNPIN_HOVER_BODY_CLASS, on);
}

/**
 * 取得元素「未旋轉」的 layout 左上角（viewport 座標）。
 *
 * ⚠️ 便條卡帶 `transform: rotate(tilt)`，`getBoundingClientRect()` 回的是
 * 旋轉後的**外接矩形**——直接拿 `rect.left/top` 當拖曳基準，卡片一按下
 * 就會偏掉幾 px 並在拖曳全程維持該誤差。rotate 以中心為 origin（CSS 未
 * 覆寫 `transform-origin`），而 `offsetWidth/Height` 不受 transform 影響，
 * 所以由外接矩形中心減去 offset 尺寸的一半即可還原真正的左上角。
 */
function getLayoutTopLeft(el: HTMLElement): { left: number; top: number } {
  const rect = el.getBoundingClientRect();
  return {
    left: rect.left + rect.width / 2 - el.offsetWidth / 2,
    top: rect.top + rect.height / 2 - el.offsetHeight / 2,
  };
}

/**
 * 點浮島 pool 內的暗掉便條 → 導向後把釘選位置捲進視野。
 *
 * ⚠️ element 錨點與 page 級要走**不同**路徑：
 *  - element：`trackEl` 是錨點元素本身，`scrollIntoView` 正確。
 *  - page 級：`trackEl` 是**捲動容器自己**，對它 scrollIntoView 只會把
 *    容器捲進「它父層」的視野，完全不會改它自己的 scrollTop——摺線下方
 *    建立的 page pin 點下去仍在畫面外（07/25 code review finding 1）。
 *    page 級的 offset 是「相對容器內容左上角」的座標（07/25 三驗+ 語意），
 *    所以直接 scrollTo 該座標、並置中在視野內。
 */
function scrollToPin(pinned: PinnedNote, placement: PinnedPlacement): void {
  const track = placement.trackEl;
  if (!track) return;
  if (placement.origin === 'page') {
    if (typeof track.scrollTo !== 'function') return; // jsdom / 舊環境
    track.scrollTo({
      left: Math.max(0, pinned.offsetX - track.clientWidth / 2),
      top: Math.max(0, pinned.offsetY - track.clientHeight / 2),
      behavior: 'smooth',
    });
    return;
  }
  track.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ─────────────────────────────────────────────────────────
 * 主體
 * ───────────────────────────────────────────────────────── */

export default function PinnedNoteLayer() {
  useDeferredStyle('pinned-note-layer', layerCss);
  const progress = useProgress();
  const pinnedAll = usePinnedNotes();
  const location = useCurrentLocation();
  /** 觸發 rect 重算（換頁、捲動、視窗 resize） */
  const [refreshTick, setRefreshTick] = useState(0);
  /** 便條 DOM ref 池（jump-to 用） */
  const noteRefs = useRef<Map<string, HTMLElement>>(new Map());
  /** 尚未消化的 jump-to 目標——rAF/timeout 內 scrollIntoView 後清除 */
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);

  // 依當前 path + search 過濾——各 Reader 用 query string 切子頁，
  // 只靠 pathname 會跨同 zone 的不同文章錯誤顯示（S9-A Codex #1）
  const currentPins = useMemo(
    () =>
      pinnedAll.filter((p) =>
        matchesLocation(p, location.pathname, location.search)
      ),
    [pinnedAll, location.pathname, location.search]
  );

  /* 換頁後補幾次遲延重算——內容 DOM 可能還在 mount / fetch 中，直接算
   * 會抓不到錨點而誤退 fixed fallback。search 也要當 dep：Reader 用
   * pushState 切 query 子頁不換 pathname。 */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raf = window.requestAnimationFrame(() =>
      setRefreshTick((t) => t + 1)
    );
    const timers = [250, 800, 2000].map((ms) =>
      window.setTimeout(() => setRefreshTick((t) => t + 1), ms)
    );
    return () => {
      window.cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [location.pathname, location.search]);

  /* jump-to：換頁後或同頁事件 → 讀 sessionStorage flag → scrollIntoView */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    function tryJump() {
      const id = takeJumpToPinned();
      if (id) setPendingJumpId(id);
    }

    // 掛載時檢查（跨頁導向到頁後的情境）
    tryJump();
    // 同頁點暗掉便條時 dragToPin.navigateToPinned 派 uep:storage-jump
    window.addEventListener('uep:storage-jump', tryJump);
    return () => window.removeEventListener('uep:storage-jump', tryJump);
  }, []);

  /* pendingJumpId 有值 → 等到該 note 的 DOM 存在 → 捲到釘選位置。
   * ⚠️ 便條卡是 fixed（viewport 座標），對它 scrollIntoView 捲不動內層
   * 容器——要捲的是它追蹤的錨點元素（trackEl）。 */
  useEffect(() => {
    if (!pendingJumpId || typeof window === 'undefined') return;
    let attempts = 0;
    const MAX_ATTEMPTS = 12; // 6s (500ms * 12) 內容還沒 mount 就放棄
    const tick = () => {
      const el = noteRefs.current.get(pendingJumpId);
      const entry = placementsRef.current.find(
        (p) => p.pinned.noteId === pendingJumpId
      );
      if (el && entry) {
        scrollToPin(entry.pinned, entry.placement);
        // 短暫高亮視覺（沿 CSS class 一次性）
        el.classList.add('is-jump-target');
        window.setTimeout(() => el.classList.remove('is-jump-target'), 1600);
        setPendingJumpId(null);
        return;
      }
      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        setPendingJumpId(null);
        return;
      }
      window.setTimeout(tick, 500);
    };
    const raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [pendingJumpId, refreshTick]);

  // 位置計算——refreshTick 依賴讓每次重算重新執行 findContentContainers。
  // refreshTick 本身在 body 內沒讀，只當 dep 訊號用；顯式 void 一次讓
  // future react-hooks/exhaustive-deps 啟用時不會被抓為 missing dep。
  const placements = useMemo(() => {
    void refreshTick;
    return currentPins.map((p) => ({
      pinned: p,
      placement: computePlacement(p, location.zone),
    }));
  }, [currentPins, location.zone, refreshTick]);

  /** 捲動 sync 與 jump 共用的最新 placements（不觸發 re-render） */
  const placementsRef = useRef(placements);
  placementsRef.current = placements;

  /* 捲動 / resize：直寫 style 追蹤錨點元素。
   * capture-phase 監聽——Reader 是內層容器捲動，scroll 不冒泡但 capture
   * 會經過 window；同步執行（scroll handler 在 paint 前跑）便條與內容
   * 零延遲貼合，不進 React state 避免高頻 re-render。 */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let staleRefreshQueued = false;
    const sync = () => {
      for (const { pinned, placement } of placementsRef.current) {
        const track = placement.trackEl;
        if (!track) continue; // page / fixed：viewport 固定不追
        const el = noteRefs.current.get(pinned.noteId);
        if (!el) continue;
        if (!track.isConnected) {
          // 內容重繪把錨點元素換掉了 → 排一次重解析（防抖避免迴圈）
          if (!staleRefreshQueued) {
            staleRefreshQueued = true;
            setRefreshTick((t) => t + 1);
          }
          continue;
        }
        const rect = track.getBoundingClientRect();
        if (placement.origin === 'page') {
          // page 級（07/25 三驗+）：track 是 scroll container，offset 是
          // 內容座標；viewport 位置 = containerRect + 內容座標 - scrollTop/Left
          el.style.left = `${rect.left + pinned.offsetX - track.scrollLeft}px`;
          el.style.top = `${rect.top + pinned.offsetY - track.scrollTop}px`;
        } else {
          // element 錨點：track 是 anchor 元素，offset 是相對 anchor 左上
          el.style.left = `${rect.left + pinned.offsetX}px`;
          el.style.top = `${rect.top + pinned.offsetY}px`;
        }
      }
    };
    sync();
    window.addEventListener('scroll', sync, { capture: true, passive: true });
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
    };
  }, [placements]);

  return (
    <>
      {placements.map(({ pinned, placement }) => (
        <PinnedNoteCard
          key={pinned.noteId}
          pinned={pinned}
          placement={placement}
          note={
            progress.storageNotes.find((n) => n.id === pinned.noteId) ?? null
          }
          registerRef={(el) => {
            if (el) noteRefs.current.set(pinned.noteId, el);
            else noteRefs.current.delete(pinned.noteId);
          }}
        />
      ))}
    </>
  );
}

/* ─────────────────────────────────────────────────────────
 * 單張釘選便條卡
 * ───────────────────────────────────────────────────────── */

interface PinnedNoteCardProps {
  pinned: PinnedNote;
  placement: PinnedPlacement;
  note: StorageNote | null;
  /** 給 PinnedNoteLayer 註冊 DOM ref 供 jump-to 用 */
  registerRef?: (el: HTMLElement | null) => void;
}

function PinnedNoteCard({
  pinned,
  placement,
  note,
  registerRef,
}: PinnedNoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [dragging, setDragging] = useState(false);
  /** 拖曳中懸在便條島上 → 放開即解除釘選（艾斯維爾 07/25 UX） */
  const [overIsland, setOverIsland] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** pointer 起點 + 是否已觸發拖曳（S9-A Codex #6 場上便條 reposition） */
  const pointerStart = useRef<{ x: number; y: number; id: number } | null>(
    null
  );
  const pointerDragged = useRef(false);
  /** 拖曳起點時卡片的 viewport 位置——move 時直寫 style 讓卡片跟指標走 */
  const dragBase = useRef<{ left: number; top: number } | null>(null);
  /** 卡片左上角相對指標的偏移（進拖曳態時算一次，整段拖曳為定值） */
  const grabOffset = useRef<GrabOffset | null>(null);
  /** overIsland 的同步鏡像——pointermove 每 frame 讀，不能靠 state 回讀 */
  const overIslandRef = useRef(false);

  useEffect(() => {
    if (editing && note) {
      setDraft(note.text);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [editing, note?.text]);

  /* ⚠️ 所有 hook 一律在條件式 early return **之前**宣告——便條本體可能
   * 從無到有（本機釘選 metadata 先在、ProgressState 尚未 hydrate 完），
   * 若 `if (!note) return null` 擋在 hook 前面，該次轉換會改變 hook 數量
   * 讓 React 直接 crash（07/25 code review finding 2）。 */
  const commitEdit = useCallback(() => {
    if (!note) return;
    const text = draft.trim();
    if (!text || text === note.text) {
      setEditing(false);
      return;
    }
    getProgressManager().updateStorageNote(note.id, text);
    setEditing(false);
  }, [draft, note?.id, note?.text]);

  const cancelEdit = useCallback(() => {
    setDraft(note?.text ?? '');
    setEditing(false);
  }, [note?.text]);

  const handleUnpin = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      getPinnedStore().unpin(pinned.noteId);
      /* 便條沒有被刪掉，只是回到島裡的未釘選狀態（S9-D.7）——島收合時
         畫面上就只是「便條消失了」，chip 閃一下交代它去了哪。
         另一條 unpin 路徑（拖回島上）不需要：那時島必然展開著。 */
      markChipAttention('storage', '便條已收回島裡');
    },
    [pinned.noteId]
  );

  /* ── S9-A Codex #6 場上便條 pointer drag reposition ──
   * pool 拖曳沿用 dragToPin 的 pointer pattern；場上便條同套流程：
   *  - pointerdown 記起點 + setPointerCapture
   *  - pointermove > DRAG_THRESHOLD 才進拖曳態（否則算 click / edit）
   *  - pointerup 解析新 drop target → commitPin 覆蓋原釘選（同 noteId
   *    語意上就是搬家；createdAt / pageLabel / pageSearch 一起更新）
   * 編輯中或按 × 拆除不啟動拖曳。
   */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (editing) return;
      // 拆除鈕內部 pointerdown 不啟動拖曳（讓它自己吃 click）
      const target = e.target as HTMLElement | null;
      if (target?.closest('.uep-pinned-note__unpin')) return;
      pointerStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      pointerDragged.current = false;
      grabOffset.current = null;
      /* pointerdown 就捕獲——便條只有 200px 寬，快速甩動時指標常常在
       * 超過 DRAG_THRESHOLD 之前就已經飛出卡片邊界，pointermove 只掛在
       * 卡片上會直接斷線，主觀感受就是「拖不太動」（艾斯維爾 07/25 四驗）。
       *
       * ⚠️ 捕獲後原生 click 的 target 被鎖在此 div，不會分派到內部
       * `.uep-pinned-note__text` button——07/24 二次驗收「點下去沒反應」
       * 就是這樣來的。因此點擊進編輯的語意改由 handlePointerUp 自行判定，
       * 不再依賴 click 事件分派；button 的 onClick 只留給鍵盤操作。 */
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* 靜默；捕獲失敗仍可靠 pointerStart 追 move（只是可能中途斷） */
      }
    },
    [editing]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = pointerStart.current;
      if (!start || start.id !== e.pointerId) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const el = e.currentTarget as HTMLElement;
      if (!pointerDragged.current && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        pointerDragged.current = true;
        setDragging(true);
        // 記下拖曳起點的 layout 左上角（不能直接用 rect——卡片有 rotate）
        const base = getLayoutTopLeft(el);
        dragBase.current = base;
        // 抓取偏移在整段拖曳中是定值：卡片左上角一直跟著指標平移
        grabOffset.current = {
          dx: base.left - start.x,
          dy: base.top - start.y,
        };
      }
      // 拖曳中：卡片直接跟指標走（直寫 style，不進 React state）
      if (pointerDragged.current && dragBase.current) {
        el.style.left = `${dragBase.current.left + dx}px`;
        el.style.top = `${dragBase.current.top + dy}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        /* 懸在便條島上 → 放開即「收回島裡」。用 ref 比較只在**跨越邊界**
         * 時才進 state（不是每個 frame）；side effect 不能寫在 setState 的
         * updater 裡——StrictMode 會 double-invoke updater。 */
        const over = isUnpinDropTarget(e.clientX, e.clientY);
        if (over !== overIslandRef.current) {
          overIslandRef.current = over;
          setOverIsland(over);
          setUnpinHover(over);
        }
      }
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = pointerStart.current;
      const grab = grabOffset.current;
      pointerStart.current = null;
      grabOffset.current = null;
      // pointerdown 一律捕獲，這裡也一律歸還（未捕獲時 catch 吞掉）
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      // start 為 null → 這次 pointer 沒從卡片本體起手（拆除鈕等），不接管
      if (!start) return;
      if (!pointerDragged.current) {
        setDragging(false);
        // 沒動 → click 語意。pointer 已被捕獲，原生 click 不會走到內部
        // button，所以在這裡自己進編輯態。
        setEditing(true);
        return;
      }
      setDragging(false);
      dragBase.current = null;
      // 離開拖曳態一律清掉島的高亮（不論落在哪）
      overIslandRef.current = false;
      setOverIsland(false);
      setUnpinHover(false);

      /* 放開在展開的便條島上 → 語意是「把便條收回島裡」= 解除釘選。
       * 便條本體不刪，只是回到 pool 的未釘選狀態（艾斯維爾 07/25 UX）。 */
      if (isUnpinDropTarget(e.clientX, e.clientY)) {
        getPinnedStore().unpin(pinned.noteId);
        return;
      }

      /* 落點解析——不改 zone/pathname/search（釘選本頁移位不跨頁）。
       * 拖曳中卡片 pointer-events: none（CSS .is-dragging），
       * elementFromPoint 才不會命中卡片自己而誤判 page 級。
       * 帶上 grab：存的 offset 要對齊卡片左上角，否則放開瞬間便條會
       * 往右下跳一個抓取偏移量（艾斯維爾 07/25 四驗主訴）。 */
      const resolution = resolveDropTarget(
        e.clientX,
        e.clientY,
        grab ?? undefined
      );
      commitPin(pinned.noteId, resolution);
    },
    [pinned.noteId]
  );

  const handlePointerCancel = useCallback(() => {
    pointerStart.current = null;
    pointerDragged.current = false;
    dragBase.current = null;
    grabOffset.current = null;
    overIslandRef.current = false;
    setOverIsland(false);
    setUnpinHover(false);
    setDragging(false);
  }, []);

  /* 卡片在拖曳中被卸載（換頁、便條被刪、島狀態變動）時，body 上的高亮
   * class 沒人清 → 島會一直亮著。掛一個 unmount 清理。 */
  useEffect(() => {
    return () => {
      if (overIslandRef.current) setUnpinHover(false);
    };
  }, []);

  // 便條本體被刪（且 sweepOrphans 尚未處理完 UI 這一 tick）→ 不 render。
  // ⚠️ 必須在所有 hook 之後（見上方 commitEdit 的註解）
  if (!note) return null;

  const showStaleHint = placement.kind === 'top' || placement.kind === 'fixed';

  const className = [
    'uep-pinned-note',
    `uep-pinned-note--${placement.origin}`,
    // 首頁的轉場漸暗層（z-index 199）與黑幕（200）是 fixed 全螢幕覆蓋，
    // 便條預設 z-index 500 會浮在它們**上面**；掛 zone class 讓 CSS 把
    // 首頁便條壓到覆蓋層之下，轉場時跟著頁面一起淡出（07/25 四驗）
    pinned.zone === HOME_ZONE_ID ? 'is-home' : '',
    placement.kind === 'nearest' ? 'is-nearest' : '',
    editing ? 'is-editing' : '',
    showStaleHint ? 'is-stale' : '',
    dragging ? 'is-dragging' : '',
    overIsland ? 'is-unpin-pending' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={registerRef}
      className={className}
      style={{
        ...placement.style,
        transform: `rotate(${note.tilt}deg)`,
      }}
      role="note"
      aria-label={`釘選便條：${note.text}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          maxLength={getSetting('note.textMax', STORAGE_NOTE_TEXT_MAX)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitEdit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          }}
          className="uep-pinned-note__textarea"
          aria-label="編輯便條"
        />
      ) : (
        <button
          type="button"
          className="uep-pinned-note__text"
          /* 滑鼠點擊走 handlePointerUp（pointer 被捕獲，click 不會分派到
             這裡）；這個 onClick 是留給鍵盤 focus + Enter/Space 的無障礙
             路徑。兩條路都只是 setEditing(true)，重複觸發也冪等。 */
          onClick={() => setEditing(true)}
          aria-label={`編輯便條：${note.text}`}
        >
          {note.text}
        </button>
      )}

      {/* 地點／時間小標——與島內便條卡顯示同一份快照（唯讀，勾選只在島內
          的編輯態進行）。編輯中隱藏，讓 textarea 佔滿整張紙。 */}
      {!editing && (note.location || note.capturedAt) && (
        <div className="uep-pinned-note__meta">
          {note.location && (
            <span className="uep-pinned-note__meta-item">
              ◈ {formatLocationLabel(note.location)}
            </span>
          )}
          {note.capturedAt && (
            <span
              className="uep-pinned-note__meta-item"
              title={note.capturedAt}
            >
              {formatCapturedAt(note.capturedAt)}
            </span>
          )}
        </div>
      )}

      {/* 拆除鈕 */}
      <button
        type="button"
        className="uep-pinned-note__unpin"
        onClick={handleUnpin}
        aria-label="拆除便條"
        title="拆除"
      >
        ×
      </button>

      {/* 錨點失效提示（top / fixed 時） */}
      {showStaleHint && !editing && (
        <span className="uep-pinned-note__stale" aria-hidden>
          原位置已變動
        </span>
      )}
    </div>
  );
}
