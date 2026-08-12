/**
 * 身分證吊掛面板 — 登入後出現的固定元件（Epic 2 S5，翻面 + 撕下版）
 *
 * 概念：一張掛在 TopBar 下的識別證。未展開時只露出小尺寸的吊牌，
 * 點擊後**原地翻面**——吊牌翻過來成為完整證卡（含代稱、視角、進度與
 * 視角切換）。翻回去時證卡收回為吊牌。
 *
 * 登出互動——**撕下識別證**：滑鼠按住卡片往下拖曳，吊繩會被拉長；
 * 拉超過閾值鬆手 → 詢問是否闔上記錄；確認即登出、取消或拉不夠即回彈。
 *
 * 為什麼是翻面而不是「下方彈出」：更符合「掛在吊繩上的證件」的物理意象，
 * 也把展開/收起收斂到單一元素——切換觀看方式的入口只此一處。
 *
 * 相對進度（對照全站主線）待主線進度定義制定後再接上，目前先以計數呈現。
 * 未來會加上小工具開關（哪些浮島/元件要顯示），目前在右上齒輪按鈕預留。
 */

/* global ResizeObserver, getComputedStyle */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getReaderAuth, useReaderAuth } from '../../auth';
/* islands 相依走子路徑而非 barrel：barrel 會一併拉進 islandRuntime 的
   模組載入副作用（它在載入當下就讀 readerAuth） */
import IslandSettingsPanel from '../../islands/IslandSettingsPanel';
import { requestGuide } from '../../islands/guide/guideRequest';
import {
  IDENT_GUIDE_FLAG,
  IDENT_OPEN_EVENT,
} from '../../islands/guide/identGuide';
import { useDeferredStyle } from '../../islands/useDeferredStyle';
import { useDesktopIslandViewport } from '../../islands/useIslands';
import { getProgressManager } from '../../progress';
import { useProgress } from '../../progress/useProgress';
import { useBrowserLayoutEffect } from '../../utils/useBrowserLayoutEffect';
import { isZoneEntryActive, subscribeZoneEntry } from '../zone/zoneEntryLock';

import { WELCOME_DONE_EVENT, WELCOME_PENDING_KEY } from './GlobalWelcomeHost';
import identCardCss from './IdentCard.css?inline';
import ViewSwitch from './ViewSwitch';

/**
 * 識別證掛在 TopBar 下緣，但**不能**是 TopBar 的子元素。
 *
 * TopBar 是 `position: sticky`，本身就是一個堆疊上下文，整個子樹都畫在
 * 它那一層（100）——浮島（2000–2999）與便條（3000）一律蓋在上面，
 * 指著識別證的教學聚光燈挖出來的洞裡看到的會是浮島。
 * 而把 TopBar 抬高不是解法：整條頂欄會跟著浮到浮島之上，浮島往上捲就被
 * 頂欄裁掉一截。
 *
 * 所以 portal 到 body 自己站一層，改用 `position: fixed`，垂直位置量
 * TopBar 的下緣。量測是必要的：TopBar 是 sticky 不是 fixed，捲到頂之前
 * 它還在文件流裡（上方可能有 TEST MODE banner），下緣位置會變。
 *
 * 找不到 TopBar 時回傳 null，呼叫端退回 CSS 的預設值——沒有頂欄的頁面
 * 本來就不該掛識別證，這只是不讓量測失敗變成整張卡消失。
 */
function useTopBarBottom(): number | null {
  const [bottom, setBottom] = useState<number | null>(null);

  useEffect(() => {
    const bar = document.querySelector('.uep-topbar');
    if (!bar) return undefined;

    let frame = 0;
    function measure() {
      frame = 0;
      const next = (bar as HTMLElement).getBoundingClientRect().bottom;
      /* 次像素抖動不觸發 re-render——捲動時這個函式每一幀都會跑 */
      setBottom((prev) =>
        prev !== null && Math.abs(prev - next) < 0.5 ? prev : next
      );
    }
    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(bar);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, []);

  return bottom;
}

/** 掛上動畫總時長，動畫走完後移除 class */
const ARRIVAL_ANIM_MS = 1600;
/** WelcomeCeremony 結束後多久才播 arrival——留一段緩衝讓頁面入場動畫穩定
 *  下來，避免識別證接上時視覺焦點還在頁面 boot 動畫上 */
const ARRIVAL_POST_WELCOME_DELAY_MS = 350;

/** 儀式遲遲沒有結束時的保險：超過這段時間就無條件顯示識別證。
 *  沒有它的話，任何讓 WELCOME_DONE 送不出來的情況（layout 沒掛
 *  GlobalWelcomeHost、儀式元件擲錯）都會讓識別證永遠隱形 */
const ARRIVAL_FAILSAFE_MS = 6000;

/** 拖曳判定：小於此距離視為 click（翻面），超過才進入 tear mode */
const DRAG_THRESHOLD_PX = 8;
/** 撕下閾值：拉超過此距離鬆手即觸發確認登出 */
const TEAR_THRESHOLD_PX = 96;
/** 最大拉伸距離（避免拉到螢幕外，也給拉扯物理感一個上限） */
const TEAR_MAX_PX = 140;

export default function IdentCard() {
  const session = useReaderAuth();
  // 未登入時識別證整個 return null，樣式一併省下（訪客首屏不必付這 14KB）
  useDeferredStyle('ident-card', identCardCss, Boolean(session));
  const progress = useProgress();
  /* 手機沒有浮島（浮島根守門同一個斷點），於是齒輪開的偏好面板必然是
     空的；而撕下手勢在手機上與瀏覽器的下拉重整直接衝突——識別證掛在
     頂端，往下拉正是觸發重整的區域。兩者都改走手機分支。 */
  const desktopViewport = useDesktopIslandViewport();
  const [open, setOpen] = useState(false);
  /** 浮島偏好設定視窗（右上齒輪開啟） */
  const [showSettings, setShowSettings] = useState(false);
  /** 是否播「剛從 /login 完成、識別證正在掛上」的加強動畫 */
  const [arriving, setArriving] = useState(false);
  /* 儀式進行中先藏起來——否則識別證會在 Welcome 全屏遮罩底下把自己的
     drop 動畫（0.7s）跑完，遮罩一淡出就是「已經掛好的識別證」，接著才
     播 arrival，視覺上變成同一張卡出現兩次。
     判定來源是 <html> 上的 uep-welcome-pending class：它由 DesignLayout
     的 head inline script 掛上，必定早於 React 掛載，比讀 sessionStorage
     可靠（那個 flag 已被 GlobalWelcomeHost 消費即清）。 */
  const [pendingHidden, setPendingHidden] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('uep-welcome-pending')
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const topBarBottom = useTopBarBottom();

  /* 掛上動畫由 WelcomeCeremony 完成事件驅動——不再自己讀 sessionStorage。
     這樣時序上：頁面入場動畫先跑（Welcome 遮罩下）→ Welcome 播完 dispatch
     event → 短延遲讓入場焦點穩定 → 識別證接上。
     訪客沒 session 也不 render 就自然不會誤觸發 */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let animTimer: ReturnType<typeof setTimeout> | null = null;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    let failsafeTimer: ReturnType<typeof setTimeout> | null = null;

    function handleWelcomeDone() {
      /* 延遲一小段時間再播 arrival，等 zone/主頁的入場動畫穩下來 */
      delayTimer = setTimeout(() => {
        /* 解除隱藏與播動畫必須是同一刻：先顯示再播，中間會有一幀
           靜止的識別證，那正是要消掉的破綻 */
        setPendingHidden(false);
        setArriving(true);
        animTimer = setTimeout(() => {
          setArriving(false);
          /* 掛上動畫演完才請求教學——與浮島「甦醒動畫演完才請求」對稱，
             教學蓋在正在播的動畫上等於把剛給的東西立刻搶走。
             這裡是識別證教學唯一的自動觸發點：WELCOME_DONE 只在登入／註冊
             儀式後發出，一般換頁不會走到。看過的人由旗標擋下。 */
          if (!getProgressManager().hasFlag(IDENT_GUIDE_FLAG)) {
            requestGuide('ident');
          }
        }, ARRIVAL_ANIM_MS);
      }, ARRIVAL_POST_WELCOME_DELAY_MS);
    }

    /* 教學要指的東西全在證卡背面，所以播放前由 GuideRunner 要求翻開。
       已經開著就不必動——重設 state 會讓 React 多跑一次渲染 */
    function handleGuideOpen() {
      setOpen((v) => (v ? v : true));
    }

    if (document.documentElement.classList.contains('uep-welcome-pending')) {
      failsafeTimer = setTimeout(
        () => setPendingHidden(false),
        ARRIVAL_FAILSAFE_MS
      );
    }

    window.addEventListener(WELCOME_DONE_EVENT, handleWelcomeDone);
    window.addEventListener(IDENT_OPEN_EVENT, handleGuideOpen);
    return () => {
      window.removeEventListener(WELCOME_DONE_EVENT, handleWelcomeDone);
      window.removeEventListener(IDENT_OPEN_EVENT, handleGuideOpen);
      if (delayTimer) clearTimeout(delayTimer);
      if (animTimer) clearTimeout(animTimer);
      if (failsafeTimer) clearTimeout(failsafeTimer);
    };
  }, []);
  /* 過場動畫期間收合（效法浮島訂閱 zoneEntryLock）：CSS 的
     body class 規則只負責「看不見」，展開狀態若不收掉，動畫結束後
     證卡會以展開態直接跳回來。持鎖來源涵蓋「即將經歷」的狀態
     （IntroOverlay 的 zone 預覽卡開啟期間就持鎖），掛載當下也同步
     一次——識別證可能在鎖已生效之後才 mount。 */
  useEffect(() => {
    function collapseOnEntry() {
      if (isZoneEntryActive()) setOpen(false);
    }
    collapseOnEntry();
    return subscribeZoneEntry(collapseOnEntry);
  }, []);

  /** 證卡背面的內容層，量它決定展開高度 */
  const backInnerRef = useRef<HTMLDivElement>(null);

  /* 展開高度不能寫死：資料列有兩列是條件渲染，代稱在窄視窗還會折行——
     兩者都會改變內容高度，而背面是 absolute 定位、撐不開容器，
     多出來的部分會被 overflow: hidden 切掉（首當其衝是唯一的登出說明）。

     所以量實際內容。背面固定用展開寬度佈局（見 CSS 的 --ident-w），
     卡片收著時也量得準，不必等展開動畫跑完。
     ResizeObserver 顧的是字型載入、代稱變化、resize 換斷點。 */
  useBrowserLayoutEffect(() => {
    const inner = backInnerRef.current;
    const root = rootRef.current;
    if (!inner || !root || typeof ResizeObserver === 'undefined')
      return undefined;

    const apply = () => {
      const face = inner.parentElement;
      if (!face) return;
      const cs = getComputedStyle(face);
      const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      root.style.setProperty(
        '--ident-open-h',
        `${Math.ceil(inner.offsetHeight + padding)}px`
      );
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(inner);
    return () => ro.disconnect();
    // 依賴 session：訪客不 render 證卡，此時 ref 是 null、effect 直接空轉。
    // 少了這條依賴，登入狀態晚一拍抵達時就再也沒有機會量了
  }, [session]);

  /** 拖曳狀態透過 ref 存，避免每一 pointermove 都 rerender */
  const dragRef = useRef<{
    startY: number;
    startX: number;
    lastDelta: number;
    passedThreshold: boolean;
  } | null>(null);
  /** 剛剛完成 tear 拖曳（拖過閾值），要壓下隨後的 click（避免翻面） */
  const suppressClickRef = useRef(false);

  /* 訪客沒有身分證——這是銘刻過記錄的人才有的東西 */
  if (!session) return null;

  const isObserver = progress.view === 'observer';

  /* ── 拖曳處理：吊繩隨拉伸拉長 + flip 順勢下移 ── */

  function applyTear(dy: number) {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty('--tear-y', `${dy}px`);
    /* progress 0~1 驅動 cord 顏色從金色連續 lerp 到警戒紅 */
    const progress = Math.min(1, Math.max(0, dy / TEAR_THRESHOLD_PX));
    el.style.setProperty('--tear-progress', progress.toFixed(3));
  }

  function resetTear(withTransition = true) {
    const el = rootRef.current;
    if (!el) return;
    if (withTransition) {
      el.classList.remove('is-dragging');
    } else {
      el.classList.add('is-dragging'); // 無 transition
    }
    el.style.setProperty('--tear-y', '0px');
    el.style.setProperty('--tear-progress', '0');
    el.classList.remove('is-near-tear');
  }

  function handlePointerDown(e: React.PointerEvent) {
    /* 主鍵才響應；觸控/滑鼠皆走 pointer events */
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    /* 手機不用撕下手勢：往下拉會先被瀏覽器判定成下拉重整。
       登出改由證卡內的按鈕提供 */
    if (!desktopViewport) return;
    /* 展開狀態下讓內部互動優先——只在吊牌狀態允許拖曳撕下
       （避免拖到 view row / gear 時觸發撕下） */
    if (open) return;
    dragRef.current = {
      startY: e.clientY,
      startX: e.clientX,
      lastDelta: 0,
      passedThreshold: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const dx = Math.abs(e.clientX - drag.startX);
    /* 尚未過 drag 閾值：純點擊或水平移動不算撕下 */
    if (!drag.passedThreshold) {
      if (dy < DRAG_THRESHOLD_PX || dx > dy) return;
      drag.passedThreshold = true;
      rootRef.current?.classList.add('is-dragging');
    }
    /* 有阻尼感的映射：越拉越沉 */
    const damped = Math.min(TEAR_MAX_PX, dy * 0.85);
    drag.lastDelta = damped;
    applyTear(damped);
    if (damped >= TEAR_THRESHOLD_PX) {
      rootRef.current?.classList.add('is-near-tear');
    } else {
      rootRef.current?.classList.remove('is-near-tear');
    }
  }

  /**
   * 登出本體：確認 → 撕開動畫 → 登出 → 種儀式 flag → 回主頁。
   *
   * 撕下手勢與手機版登出按鈕共用這一條，不各寫一份——兩者只有「怎麼
   * 發起」不同，之後的每一步都必須一致。撕開動畫也在共用範圍內：
   * 那是登出的視覺語彙，不是手勢的裝飾（`is-torn` 動的是整個 flip
   * 容器，證卡展開著也成立）。
   *
   * @returns 是否真的登出了。false = 使用者取消或 dialog 尚未就緒，
   *          呼叫端自行決定要不要回彈。
   */
  async function performLogout(): Promise<boolean> {
    const mgr = window.__uepDialogManager;
    /* dialog 尚未 mount：保守起見不當作已登出。
       Container 已改 client:load（見 DesignLayout），正常情況下不會走到
       這裡；但仍要出聲——回彈與「手勢沒做對」在體感上無法區分，使用者
       只會一直重試。不 fallback 到 uepDialog 單例：沒有 Container 訂閱時
       它的 confirm 永遠不 resolve，卡住比失敗更糟。 */
    if (!mgr) {
      window.__uepToastManager?.info('介面尚未就緒，請稍候再試');
      return false;
    }

    const ok = await mgr.confirm(
      '要把識別證從吊繩上撕下嗎？闔上這份記錄後，你的足跡會留在此地，但不會跟你走。',
      {
        title: '闔上記錄',
        confirmText: '撕下（登出）',
        cancelText: '掛回去',
      }
    );
    if (!ok) return false;

    /* 撕開動畫（cord 斷裂 + 卡片墜落），完成後真正登出 */
    rootRef.current?.classList.add('is-torn');
    const alias = session?.alias ?? '';
    await new Promise((r) => setTimeout(r, 550));
    await getReaderAuth().logout();
    /* 登出儀式（S7 驗收 #14）：鏡射登入的 pending 模式——
       種 flag + 導向主頁，GlobalWelcomeHost 在主頁播放登出變體
       （WelcomeCeremony kind='logout'），取代原本的 toast 提示 */
    try {
      sessionStorage.setItem(
        WELCOME_PENDING_KEY,
        JSON.stringify({ kind: 'logout', alias })
      );
    } catch {
      /* sessionStorage 不可用時就沒儀式，不影響登出 */
    }
    window.location.assign('/');
    return true;
  }

  async function handlePointerUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* 忽略：某些瀏覽器對重覆 release 會擲例外 */
    }
    if (!drag.passedThreshold) {
      /* 純點擊沒進 drag：不干擾原本的翻面 click */
      return;
    }
    /* 進了 drag：無論結果都要抑制隨後的 click（避免撕下後又翻面） */
    suppressClickRef.current = true;
    setTimeout(() => (suppressClickRef.current = false), 0);

    if (drag.lastDelta < TEAR_THRESHOLD_PX) {
      /* 拉不夠：回彈 */
      resetTear(true);
      return;
    }
    /* 拉夠了——固定在拉伸位置詢問是否闔上記錄。
       dialog 未就緒與使用者取消都回 false，兩者都該回彈 */
    const ok = await performLogout();
    if (!ok) {
      /* 掛回去：回彈 */
      resetTear(true);
    }
  }

  function handleClick() {
    if (suppressClickRef.current) return;
    setOpen((v) => !v);
  }

  /* flip-inner 從 <button> 改為 div[role=button]（S6-3）：
     內部含齒輪 button 與 ViewSwitch，button 巢狀 button 是無效 HTML，
     React 會噴 validateDOMNesting 警告。鍵盤語意手動補齊。 */
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    /* 事件來自內部互動元件（齒輪/ViewSwitch）時不翻面 */
    if (e.target !== e.currentTarget) return;
    e.preventDefault(); // Space 不捲動頁面
    handleClick();
  }

  const card = (
    <div
      className={`uep-ident${open ? ' is-open' : ''}${arriving ? ' is-arriving' : ''}${pendingHidden ? ' is-welcome-pending' : ''}`}
      ref={rootRef}
      style={
        topBarBottom === null
          ? undefined
          : ({
              '--ident-anchor-top': `${topBarBottom}px`,
            } as React.CSSProperties)
      }
    >
      {/* 吊繩：從 TopBar 下緣垂下，撕下拖曳時會被拉長 */}
      <div className="uep-ident__cord" aria-hidden="true" />

      {/* 翻面主體：吊牌與證卡是同一張卡的正反面 */}
      <div className="uep-ident__flip">
        <div
          role="button"
          tabIndex={0}
          className="uep-ident__flip-inner"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-expanded={open}
          aria-label={open ? '收起識別證' : '展開識別證（往下拖曳可撕下登出）'}
          title={
            open ? '收起識別證' : '點擊展開 · 往下拖曳可撕下識別證（登出）'
          }
        >
          {/* 正面：吊牌 */}
          <div className="uep-ident__face uep-ident__face--front">
            <span className="uep-ident__tab-glyph" aria-hidden="true">
              {isObserver ? '◉' : '◈'}
            </span>
            <span className="uep-ident__tab-label">識別證</span>
          </div>

          {/* 背面：完整證卡（用 span 包起來以免整張證卡吃到 button 語意過多） */}
          <div
            className="uep-ident__face uep-ident__face--back"
            role="region"
            aria-label="身分證"
          >
            <div className="uep-ident__punch" aria-hidden="true" />

            {/* 右上角設定按鈕：開啟浮島偏好設定視窗。
                stopPropagation 避免點下去把證卡翻回吊牌。
                手機不顯示——面板內容（浮島開關、教學回顧）全部以浮島
                存在為前提，而浮島在手機根本不掛，點開必然是空的 */}
            {desktopViewport && (
              <button
                type="button"
                className="uep-ident__gear"
                aria-label="偏好設定"
                title="偏好設定"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSettings(true);
                }}
              >
                ⚙
              </button>
            )}

            {/* 內容層：量它決定卡片高度（punch 與 gear 是絕對定位，
                不進流也就不影響高度，所以留在外面） */}
            <div className="uep-ident__back-inner" ref={backInnerRef}>
              <div className="uep-ident__kicker">U.E.P · IDENTIFICATION</div>

              <div className="uep-ident__alias">
                {getReaderAuth().displayAlias()}
              </div>
              <div className="uep-ident__username">@{session.username}</div>

              <div className="uep-ident__sep" />

              <div className="uep-ident__rows">
                <div className="uep-ident__row">
                  <span className="uep-ident__row-label">視角</span>
                  <span className="uep-ident__row-value">
                    {isObserver ? '◉ 觀測者' : '◈ 探索者'}
                  </span>
                </div>
                <div className="uep-ident__row">
                  <span className="uep-ident__row-label">走過的篇章</span>
                  <span className="uep-ident__row-value">
                    {progress.completedPageIds.length}
                  </span>
                </div>
                <div className="uep-ident__row">
                  <span className="uep-ident__row-label">留下的印象</span>
                  <span className="uep-ident__row-value">
                    {progress.flags.length}
                  </span>
                </div>
                {progress.islandsUnlocked.length > 0 && (
                  <div className="uep-ident__row">
                    <span className="uep-ident__row-label">喚醒的浮島</span>
                    <span className="uep-ident__row-value">
                      {progress.islandsUnlocked.length}
                    </span>
                  </div>
                )}
                {session.observerEver && (
                  <div className="uep-ident__row uep-ident__row--mark">
                    <span className="uep-ident__row-label">印記</span>
                    <span className="uep-ident__row-value">已見證</span>
                  </div>
                )}
              </div>

              <div className="uep-ident__sep" />

              {/* 觀看世界的方式：一律只在識別證內切換（S5 起唯一入口） */}
              <div
                className="uep-ident__view-row"
                /* 阻止事件冒泡到翻面按鈕，避免切換視角時把證卡翻回去 */
                onClick={(e) => e.stopPropagation()}
              >
                <span className="uep-ident__row-label">觀看世界的方式</span>
                <ViewSwitch />
              </div>

              {/* 桌面：撕下登出是純手勢互動，沒有任何按鈕可循——證卡底部
                明說一次。撕下只在吊牌狀態允許（避免拖到 ViewSwitch 誤觸），
                所以文案要先講「收起」。
                手機：手勢與下拉重整衝突，改給明確按鈕；走的是同一條
                performLogout（確認 → 撕開動畫 → 登出 → 儀式 → 回主頁）。 */}
              {desktopViewport ? (
                <p className="uep-ident__tear-hint">
                  <span
                    className="uep-ident__tear-hint-glyph"
                    aria-hidden="true"
                  >
                    ↓
                  </span>
                  收起後往下拉，可撕下識別證（登出）
                </p>
              ) : (
                <button
                  type="button"
                  className="uep-ident__logout"
                  onClick={(e) => {
                    e.stopPropagation();
                    void performLogout();
                  }}
                >
                  撕下識別證（登出）
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 浮島偏好設定視窗（自己也 portal，它要蓋在識別證之上） */}
      {showSettings && (
        <IslandSettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </div>
  );

  /* 見 useTopBarBottom 的說明：一定要離開 TopBar 的堆疊上下文。
     document 不存在（SSR）時直接回傳——這條路實務上走不到，
     session 在伺服器端一律是 null，上面早就 return 了。 */
  return typeof document === 'undefined'
    ? card
    : createPortal(card, document.body);
}
