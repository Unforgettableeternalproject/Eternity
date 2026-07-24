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
import { useCurrentLocation } from '../useCurrentLocation';

import { resolveAnchorRect } from './contentAnchors';
import type { ResolvedAnchor } from './contentAnchors';
import {
  DRAG_THRESHOLD,
  commitPin,
  resolveDropTarget,
  takeJumpToPinned,
} from './dragToPin';
import { getPinnedStore, matchesLocation } from './pinnedStore';
import type { PinnedNote } from './pinnedStore';
import { usePinnedNotes } from './usePinnedNotes';
import { findContentContainers } from './zoneContentTargets';

import './PinnedNoteLayer.css';

/** 手機/窄視窗守門值——與其他浮島相關功能一致（IslandHost 也用同值） */
const DESKTOP_MIN_WIDTH = 761;

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
  // page 級釘選：viewport 固定右下（未來若有精細語意化錨點再擴充）
  if (pinned.anchorKind === 'page') {
    return {
      style: {
        position: 'fixed',
        right: 16 + pinned.offsetX,
        bottom: 16 + pinned.offsetY,
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

/* ─────────────────────────────────────────────────────────
 * 主體
 * ───────────────────────────────────────────────────────── */

export default function PinnedNoteLayer() {
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
   * 容器——要捲的是它追蹤的錨點元素（trackEl）；page 級只做高亮。 */
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
        entry.placement.trackEl?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
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
        el.style.left = `${rect.left + pinned.offsetX}px`;
        el.style.top = `${rect.top + pinned.offsetY}px`;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** pointer 起點 + 是否已觸發拖曳（S9-A Codex #6 場上便條 reposition） */
  const pointerStart = useRef<{ x: number; y: number; id: number } | null>(
    null
  );
  const pointerDragged = useRef(false);
  /** 拖曳起點時卡片的 viewport 位置——move 時直寫 style 讓卡片跟指標走 */
  const dragBase = useRef<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (editing && note) {
      setDraft(note.text);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [editing, note?.text]);

  // 便條本體被刪（且 sweepOrphans 尚未處理完 UI 這一 tick）→ 不 render
  if (!note) return null;

  const commitEdit = useCallback(() => {
    const text = draft.trim();
    if (!text || text === note.text) {
      setEditing(false);
      return;
    }
    getProgressManager().updateStorageNote(note.id, text);
    setEditing(false);
  }, [draft, note.id, note.text]);

  const cancelEdit = useCallback(() => {
    setDraft(note.text);
    setEditing(false);
  }, [note.text]);

  const handleUnpin = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      getPinnedStore().unpin(pinned.noteId);
    },
    [pinned.noteId]
  );

  /* ── S9-A Codex #6 場上便條 pointer drag reposition ──
   * pool 拖曳沿用 dragToPin 的 pointer pattern；場上便條同套流程：
   *  - pointerdown 記起點 + setPointerCapture
   *  - pointermove > DRAG_THRESHOLD 才進拖曳態（否則走 click / edit）
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
      /* ⚠️ 不在 pointerdown 立刻 setPointerCapture——這會讓後續 click
       * 事件的 target 被鎖在此 div 而不會分派到內部 button，變成「點
       * 下去完全沒反應」（艾斯維爾 07/24 二次驗收）。改成超過
       * DRAG_THRESHOLD 才捕獲，比照 StorageIsland.NoteCard 的模式。 */
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
        // 記下拖曳起點的 viewport 位置（卡片是 fixed，rect 即座標）
        const rect = el.getBoundingClientRect();
        dragBase.current = { left: rect.left, top: rect.top };
        // 超過閾值才捕獲，避免離開卡片就斷（click 語意在此之前已放行）
        try {
          el.setPointerCapture?.(e.pointerId);
        } catch {
          /* 靜默；捕獲失敗仍可靠 pointerStart 追 move */
        }
      }
      // 拖曳中：卡片直接跟指標走（直寫 style，不進 React state）
      if (pointerDragged.current && dragBase.current) {
        el.style.left = `${dragBase.current.left + dx}px`;
        el.style.top = `${dragBase.current.top + dy}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = pointerStart.current;
      pointerStart.current = null;
      if (!pointerDragged.current) {
        setDragging(false);
        return; // 沒動 → click 語意（讓 button 的 onClick 進 edit）
      }
      // 拖曳態才 release 捕獲（pointerdown 已不再無條件 capture）
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      setDragging(false);
      dragBase.current = null;
      if (!start) return;
      // 落點解析——不改 zone/pathname/search（釘選本頁移位不跨頁）。
      // 拖曳中卡片 pointer-events: none（CSS .is-dragging），
      // elementFromPoint 才不會命中卡片自己而誤判 page 級。
      const resolution = resolveDropTarget(e.clientX, e.clientY);
      commitPin(pinned.noteId, resolution);
    },
    [pinned.noteId]
  );

  const handlePointerCancel = useCallback(() => {
    pointerStart.current = null;
    pointerDragged.current = false;
    dragBase.current = null;
    setDragging(false);
  }, []);

  const showStaleHint = placement.kind === 'top' || placement.kind === 'fixed';

  const className = [
    'uep-pinned-note',
    `uep-pinned-note--${placement.origin}`,
    placement.kind === 'nearest' ? 'is-nearest' : '',
    editing ? 'is-editing' : '',
    showStaleHint ? 'is-stale' : '',
    dragging ? 'is-dragging' : '',
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
          maxLength={STORAGE_NOTE_TEXT_MAX}
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
          onClick={() => setEditing(true)}
          aria-label={`編輯便條：${note.text}`}
        >
          {note.text}
        </button>
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

/** export helper for external mount guard checks */
export function isPinnedLayerDesktopViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= DESKTOP_MIN_WIDTH;
}
