/* global EventTarget */
/**
 * entity → 便條島 拖曳來源（S10-1 T-H2）
 *
 * 讀者在任何 zone 看到一個 entity（History 文內的互動式嵌入、Concepts
 * dossier 條目、Echoes 歌曲卡、Visuals 畫廊卡），可以直接把它拖進展開的
 * 便條島，變成一張寫著該 entity 名稱的便條。
 *
 * ## 一組 handlers 吃所有來源
 *
 * 各來源的共通點是「DOM 上找得到 entityKey」，所以拖曳來源端不需要各寫
 * 一份：呼叫端只要在**容器**掛這組 handlers，並讓可拖的元素帶上
 * `data-entity-key`（History 的嵌入 span 例外——它本來就有
 * `data-ref="entity:{key}"`，這裡直接認）。事件委派讓一個容器涵蓋
 * 底下所有條目，不必逐張卡片掛四個 pointer 事件。
 *
 * ## 拖出來的文字一律是 Concepts dossier 的名稱
 *
 * 艾斯維爾 2026-07-27 定案：dossier 條目才是 canonical entity。因此
 * 「可不可拖」與「拖出什麼字」是同一次查表（見
 * {@link findCanonicalEntityName}）——歌曲卡上寫的是曲名、History 文內
 * 寫的可能是暱稱，但拖進便條的一律是 dossier 那個正名。
 *
 * 索引在便條島掛載時就預載，pointerdown 當下同步查表：使用者按下去的
 * 瞬間就知道能不能拖，不會出現「拖到一半才發現不行」。
 *
 * ## 為什麼不用 HTML5 DnD
 *
 * 沿 S9 便條拖曳釘選的既有結論（見 dragToPin 檔頭）：DnD 對 fixed／
 * z-index 不友善、drop zone 難自訂、ghost 樣式難控。這裡同樣走
 * pointer events + `DRAG_THRESHOLD` + 延後 `setPointerCapture`
 * ——門檻前不抓 capture，輕點才能照常變成 click（開 Terminal／進詳細頁
 * 都靠它，S9-A 07/24 二次驗收的教訓）。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  UEP_ENTITY_ACTIVE_ATTR,
  UEP_REF_ATTR,
  parseEntityRef,
} from '../../embed';
import { useProgress } from '../../progress/useProgress';
import {
  loadEntityIndex,
  type TerminalIndexEntry,
} from '../concepts/terminalCore';
import { shouldMountIsland } from '../islandRuntime';

import { DRAG_THRESHOLD } from './dragToPin';
import {
  dropEntityText,
  findCanonicalEntityName,
  isEntityDropTarget,
  isStorageIslandOpenAndExpanded,
} from './entityDropBridge';

import './useEntityDragSource.css';

/** 可拖曳條目卡的標記屬性——條目卡端只要掛這個就成為拖曳來源 */
export const ENTITY_DRAG_ATTR = 'data-entity-key';

/**
 * 拖曳進行中掛在 `<body>` 的 class。
 *
 * 用途是全站停用文字選取——拖過一段文字會把它整段反白，視覺上像是誤觸。
 * 正式環境的內容保護（`scripts/content-protection.ts`）本來就會擋掉，但那
 * 是**可被關閉的獨立功能**（dev／測試模式預設關），拖曳手感不該依賴它。
 *
 * 掛 body 而非來源容器：拖曳中指標常常已經離開來源容器（甚至飛到島上），
 * 只鎖容器擋不住外面的選取。沿用 `zoneEntryLock`／`uep-pin-unpin-hover`
 * 既有的 body class 模式。
 */
const DRAG_BODY_CLASS = 'uep-entity-dragging';

function setDragBodyClass(on: boolean): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle(DRAG_BODY_CLASS, on);
}

/** ghost 退場動畫時長（ms）——與 CSS `.is-leaving` 的 transition 對齊 */
const GHOST_LEAVE_MS = 180;

interface EntitySource {
  key: string;
  el: HTMLElement;
}

/**
 * 從 pointerdown 的落點元素解析拖曳來源（entityKey + 來源元素）。
 *
 * 兩種來源格式：
 * - 條目卡：`data-entity-key="{key}"`（Concepts dossier／Echoes 歌曲卡／
 *   Visuals 畫廊卡）
 * - History 文內嵌入：`data-ref="entity:{key}"`，且**必須是已啟用的**
 *   （`data-uep-entity-active`）——未啟用的嵌入在前台是普通文字，
 *   讀者看不出它是 entity，能拖就成了隱形入口
 *
 * 回傳元素而不只是 key：連線起點要跟著來源元素走，捲動時才不會脫節
 * （見 {@link resolveOrigin}）。
 */
function resolveEntitySource(target: EventTarget | null): EntitySource | null {
  if (!(target instanceof Element)) return null;

  const card = target.closest<HTMLElement>(`[${ENTITY_DRAG_ATTR}]`);
  const cardKey = card?.getAttribute(ENTITY_DRAG_ATTR)?.trim();
  if (card && cardKey) return { key: cardKey, el: card };

  const embed = target.closest<HTMLElement>(`[${UEP_ENTITY_ACTIVE_ATTR}]`);
  if (!embed) return null;
  const parsed = parseEntityRef(embed.getAttribute(UEP_REF_ATTR) || '');
  return parsed.type === 'entity-key'
    ? { key: parsed.entityKey, el: embed }
    : null;
}

/** 從落點元素解析 entityKey（{@link resolveEntitySource} 的薄包裝）。 */
export function resolveEntityKeyFromTarget(
  target: EventTarget | null
): string | null {
  return resolveEntitySource(target)?.key ?? null;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  name: string;
  moved: boolean;
  /** 拖曳來源元素——連線起點每次都由它的 rect 重算 */
  sourceEl: HTMLElement | null;
  /** 按下點相對來源元素左上角的偏移（元素移動時維持同一個相對位置） */
  grabX: number;
  grabY: number;
}

/**
 * 連線起點（viewport 座標）。
 *
 * 不能直接用 pointerdown 當下的 `clientX/Y`——各 Reader 是內層容器捲動，
 * 拖曳中一捲動來源元素就跑掉了，起點卻還釘在原本的螢幕位置，虛線會從
 * 一個空無一物的地方拉出來（艾斯維爾 07/27 驗收回報）。改成每次由來源
 * 元素的即時 rect 加上按下時的相對偏移求值。
 *
 * 元素已從文件移除（內容重繪、gallery 換頁）時退回起始座標——這時本來
 * 就沒有正確答案，至少不要跳到 viewport 左上角。
 */
function resolveOrigin(state: DragState): { x: number; y: number } {
  const el = state.sourceEl;
  if (el?.isConnected) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + state.grabX, y: rect.top + state.grabY };
  }
  return { x: state.startX, y: state.startY };
}

interface GhostState {
  name: string;
  originX: number;
  originY: number;
  x: number;
  y: number;
  /** 指標目前是否停在便條島上（決定 ghost/連線的「即將落地」樣式） */
  over: boolean;
  /** 退場動畫中（已放開、尚未移除）——此時不再接受位置更新 */
  leaving?: boolean;
}

export interface EntityDragSource {
  /** 掛在條目容器上的 pointer handlers（事件委派） */
  handlers: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
  };
  /** 拖曳中的 ghost + 連線（portal 到 body，呼叫端直接放進 JSX） */
  ghost: React.ReactNode;
}

/**
 * 落地回饋。四個 Reader 的提示應該一致，所以內建在這裡而不是讓呼叫端
 * 各寫一份文案。走 `window.__uepToastManager` 而非直接 import——
 * 沿 HistoryReader 既有慣例，避免 islands 反向依賴 components/ui。
 */
function notifyDropped(name: string, ok: boolean): void {
  if (typeof window === 'undefined') return;
  if (ok) {
    window.__uepToastManager?.success(`「${name}」記到便條上了。`);
  } else {
    // 走到這裡幾乎只有一個原因：便條已達上限（addStorageNote 的 cap）
    window.__uepToastManager?.info('便條放不下了——先清掉幾張再試。');
  }
}

/** 建立一組 entity 拖曳來源 handlers。 */
export function useEntityDragSource(): EntityDragSource {
  const progress = useProgress();
  const storageMounted = shouldMountIsland(progress, 'storage');

  const [index, setIndex] = useState<TerminalIndexEntry[] | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  /** ghost 退場動畫的移除計時器 */
  const leaveTimerRef = useRef<number | null>(null);
  /** 拖曳中（ghost 在場且尚未退場）——捲動監聽只在這段期間掛 */
  const dragging = ghost !== null && !ghost.leaving;

  // 索引只在便條島能用時才抓——島沒掛載就沒有拖曳這件事，不浪費請求。
  // terminalCore 內部有模組級快取，與 Terminal Island／嵌入解鎖判定共用
  // 同一份，這裡通常是命中快取而非真的發請求。
  useEffect(() => {
    if (!storageMounted || index) return;
    let cancelled = false;
    void loadEntityIndex()
      .then((entries) => {
        if (!cancelled) setIndex(entries);
      })
      .catch(() => {
        /* 失敗維持 null——安全預設是全部不可拖 */
      });
    return () => {
      cancelled = true;
    };
  }, [storageMounted, index]);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  /**
   * 收拾一次拖曳。
   *
   * `animate` 為真時 ghost 不立刻消失，改標記 `leaving` 播退場動畫，計時
   * 到了才真正移除——**用計時器而不是 animationend**：`prefers-reduced-motion`
   * 下動畫可能整個不播，等事件會讓 ghost 永遠留在畫面上（S6-3 收合動畫
   * 踩過的同一個坑）。
   */
  const endDrag = useCallback(
    (event: React.PointerEvent, animate = false) => {
      const el = event.currentTarget as Element;
      if (el.hasPointerCapture?.(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }
      const wasDragging = dragRef.current?.moved === true;
      dragRef.current = null;
      // 放開的瞬間就還回選取權，不等退場動畫播完
      setDragBodyClass(false);

      if (!animate || !wasDragging) {
        clearLeaveTimer();
        setGhost(null);
        return;
      }
      setGhost((g) => (g ? { ...g, leaving: true } : null));
      clearLeaveTimer();
      leaveTimerRef.current = window.setTimeout(() => {
        leaveTimerRef.current = null;
        setGhost(null);
      }, GHOST_LEAVE_MS);
    },
    [clearLeaveTimer]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // 多點觸控：已經有一根手指在拖了，後來的不搶——否則 dragRef 被覆蓋，
      // 原本那根的 pointerup 會對不上而留下孤兒 ghost
      if (dragRef.current) return;
      // 收合／未解鎖／被停用的島不接拖曳——連 ghost 都不該出現，
      // 而不是拖到一半放開才失敗（設計文件 §7-4）
      if (!isStorageIslandOpenAndExpanded()) return;
      const source = resolveEntitySource(event.target);
      if (!source) return;
      // canonical name 查不到 = 這個 key 在 dossier 沒有（已解鎖的）條目，
      // 不可拖。同步判定，按下去當下就決定
      const name = findCanonicalEntityName(index, source.key, progress);
      if (!name) return;

      // 上一拖的 ghost 還在播退場動畫 → 立刻收掉，不與新的重疊
      clearLeaveTimer();
      setGhost(null);

      const rect = source.el.getBoundingClientRect();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        name,
        moved: false,
        sourceEl: source.el,
        grabX: event.clientX - rect.left,
        grabY: event.clientY - rect.top,
      };
    },
    [clearLeaveTimer, index, progress]
  );

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;

    if (!state.moved) {
      state.moved = true;
      // 門檻後才抓 capture：先抓會讓輕點也被當成拖曳手勢，
      // 條目卡的 click（開 Terminal／進詳細頁）就再也發不出來
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      setDragBodyClass(true);
    }

    const origin = resolveOrigin(state);
    setGhost({
      name: state.name,
      originX: origin.x,
      originY: origin.y,
      x: event.clientX,
      y: event.clientY,
      over: isEntityDropTarget(event.clientX, event.clientY),
    });
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const state = dragRef.current;
      // 別根手指放開不影響進行中的拖曳（也不清狀態，否則 ghost 會變孤兒）
      if (!state || state.pointerId !== event.pointerId) return;
      const dropped = state.moved;
      const name = state.name;
      const landed =
        dropped && isEntityDropTarget(event.clientX, event.clientY);
      if (dropped) {
        /* 這一下是拖曳的結束，不是給頁面的手勢——擋住不讓外層容器把它
         * 當成自己的滑動。Visuals 的 group 切換（`handleViewerPointerUp`）
         * 就掛在條目網格的父層，橫移超過 60px 就換頁，而 entity 拖曳幾乎
         * 一定會橫移超過那個距離：拖到一半整個列表被換掉，來源元素當場
         * 消失（艾斯維爾 07/27 驗收回報）。
         * 只在真的拖過（moved）時攔——沒過門檻的輕點要讓外層照常收到，
         * 否則正常的滑動手勢會一起失效。 */
        event.stopPropagation();
      }
      // 落地的 ghost 直接收掉——toast 與新出現的便條本身就是回饋，再播一段
      // 退場只會拖慢節奏；沒落地才播，讓「這一拖沒有結果」有個交代
      endDrag(event, !landed);
      if (!dropped) return; // 沒過門檻 = 這是一次點擊，讓 click 照常發生
      if (!landed) return;
      notifyDropped(name, dropEntityText(name));
    },
    [endDrag]
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      /* 取消（Esc／切換視窗／系統手勢接管）不播退場動畫——那是**中斷**
       * 不是「拖完了沒落地」，使用者多半已經不在看這個畫面，留一段淡出
       * 只會變成切回來時還掛在那裡的殘影。 */
      endDrag(event);
    },
    [endDrag]
  );

  /* 拖曳中頁面捲動／視窗改變大小 → 來源元素位移，連線起點要跟著走。
   * 指標沒動就不會有 pointermove，只靠那裡更新起點會脫節。
   * capture-phase 監聽——各 Reader 是內層容器捲動，scroll 不冒泡但
   * capture 會經過 window（沿 PinnedNoteLayer 既有作法）。 */
  useEffect(() => {
    if (!dragging || typeof window === 'undefined') return;
    const sync = () => {
      const state = dragRef.current;
      if (!state?.moved) return;
      const origin = resolveOrigin(state);
      setGhost((g) =>
        g && !g.leaving ? { ...g, originX: origin.x, originY: origin.y } : g
      );
    };
    window.addEventListener('scroll', sync, { capture: true, passive: true });
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
    };
  }, [dragging]);

  /* 拖曳中被卸載（換頁、島狀態變動）→ body class 與計時器沒人清 */
  useEffect(() => {
    return () => {
      clearLeaveTimer();
      setDragBodyClass(false);
    };
  }, [clearLeaveTimer]);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    ghost: ghost ? <EntityDragGhost {...ghost} /> : null,
  };
}

/**
 * 拖曳中的視覺：跟著指標走的名牌 + 從起點拉到指標的連線。
 *
 * 兩者都 portal 到 body：來源容器多半有 `overflow: hidden`／`transform`
 * （條目列表、時間軸都是），留在原地會被裁掉或被祖先的 containing block
 * 拖著跑。整層 `pointer-events: none`，否則 `elementFromPoint` 會命中
 * ghost 自己而永遠判不到便條島。
 */
function EntityDragGhost({
  name,
  originX,
  originY,
  x,
  y,
  over,
  leaving,
}: GhostState) {
  if (typeof document === 'undefined') return null;
  const leaveClass = leaving ? ' is-leaving' : '';
  return createPortal(
    <div className="uep-entity-drag" aria-hidden="true">
      <svg className={`uep-entity-drag__link${leaveClass}`}>
        <line
          className={`uep-entity-drag__line${over ? ' is-over' : ''}`}
          x1={originX}
          y1={originY}
          x2={x}
          y2={y}
        />
        <circle
          className="uep-entity-drag__origin"
          cx={originX}
          cy={originY}
          r={3}
        />
      </svg>
      {/* 兩層：外層只負責跟著指標平移（inline transform），內層負責置中與
          退場縮放（CSS）。合成一層的話 inline transform 會蓋掉 class 裡的
          transform，退場動畫永遠不生效。 */}
      <div
        className="uep-entity-drag__ghost-anchor"
        style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}
      >
        <div
          className={`uep-entity-drag__ghost${over ? ' is-over' : ''}${leaveClass}`}
        >
          {name}
        </div>
      </div>
    </div>,
    document.body
  );
}
