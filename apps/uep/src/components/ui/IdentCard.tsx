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

import React, { useEffect, useRef, useState } from 'react';

import { getReaderAuth, useReaderAuth } from '../../auth';
import { getProgressManager } from '../../progress';
import { requestGuide } from '../../islands/guide/guideRequest';
import {
  IDENT_GUIDE_FLAG,
  IDENT_OPEN_EVENT,
} from '../../islands/guide/identGuide';
import IslandSettingsPanel from '../../islands/IslandSettingsPanel';
import { useProgress } from '../../progress/useProgress';

import { WELCOME_DONE_EVENT, WELCOME_PENDING_KEY } from './GlobalWelcomeHost';
import ViewSwitch from './ViewSwitch';

import './IdentCard.css';

/** 掛上動畫總時長，動畫走完後移除 class */
const ARRIVAL_ANIM_MS = 1600;
/** WelcomeCeremony 結束後多久才播 arrival——留一段緩衝讓頁面入場動畫穩定
 *  下來，避免識別證接上時視覺焦點還在頁面 boot 動畫上 */
const ARRIVAL_POST_WELCOME_DELAY_MS = 350;

/** 拖曳判定：小於此距離視為 click（翻面），超過才進入 tear mode */
const DRAG_THRESHOLD_PX = 8;
/** 撕下閾值：拉超過此距離鬆手即觸發確認登出 */
const TEAR_THRESHOLD_PX = 96;
/** 最大拉伸距離（避免拉到螢幕外，也給拉扯物理感一個上限） */
const TEAR_MAX_PX = 140;

export default function IdentCard() {
  const session = useReaderAuth();
  const progress = useProgress();
  const [open, setOpen] = useState(false);
  /** 浮島偏好設定視窗（右上齒輪開啟） */
  const [showSettings, setShowSettings] = useState(false);
  /** 是否播「剛從 /login 完成、識別證正在掛上」的加強動畫 */
  const [arriving, setArriving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* 掛上動畫由 WelcomeCeremony 完成事件驅動——不再自己讀 sessionStorage。
     這樣時序上：頁面入場動畫先跑（Welcome 遮罩下）→ Welcome 播完 dispatch
     event → 短延遲讓入場焦點穩定 → 識別證接上。
     訪客沒 session 也不 render 就自然不會誤觸發 */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let animTimer: ReturnType<typeof setTimeout> | null = null;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;

    function handleWelcomeDone() {
      /* 延遲一小段時間再播 arrival，等 zone/主頁的入場動畫穩下來 */
      delayTimer = setTimeout(() => {
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

    window.addEventListener(WELCOME_DONE_EVENT, handleWelcomeDone);
    window.addEventListener(IDENT_OPEN_EVENT, handleGuideOpen);
    return () => {
      window.removeEventListener(WELCOME_DONE_EVENT, handleWelcomeDone);
      window.removeEventListener(IDENT_OPEN_EVENT, handleGuideOpen);
      if (delayTimer) clearTimeout(delayTimer);
      if (animTimer) clearTimeout(animTimer);
    };
  }, []);
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

  /* 資料列數決定展開高度（見 IdentCard.css 的 --ident-rows）。
     視角／篇章／印象三列恆在，浮島與印記兩列有條件——證卡背面是
     absolute 定位，容器不會被內容撐開，列數變動時高度得跟著走，
     否則底部的撕下提示會被 overflow: hidden 切掉。 */
  const rowCount =
    3 +
    (progress.islandsUnlocked.length > 0 ? 1 : 0) +
    (session.observerEver ? 1 : 0);

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
    /* 拉夠了——固定在拉伸位置詢問是否闔上記錄 */
    const mgr = window.__uepDialogManager;
    if (!mgr) {
      /* dialog 尚未 mount：保守起見不當作已登出，先回彈 */
      resetTear(true);
      return;
    }
    const ok = await mgr.confirm(
      '要把識別證從吊繩上撕下嗎？闔上這份記錄後，你的足跡會留在此地，但不會跟你走。',
      {
        title: '闔上記錄',
        confirmText: '撕下（登出）',
        cancelText: '掛回去',
      }
    );
    if (ok) {
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
    } else {
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

  return (
    <div
      className={`uep-ident${open ? ' is-open' : ''}${arriving ? ' is-arriving' : ''}`}
      ref={rootRef}
      /* ⚠️ 必須是字串。React 對 style 裡的 number 會補上 px，連自訂屬性
         也不例外——`--ident-rows: 3px` 會讓 CSS 那條 calc 變成 invalid at
         computed-value time，height 直接掉回 auto（背面是 absolute，
         結果整張卡塌成 0 高）。專案既有的 `--diff-cols` 也是這樣包 String。 */
      style={{ '--ident-rows': String(rowCount) } as React.CSSProperties}
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
                stopPropagation 避免點下去把證卡翻回吊牌 */}
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

            {/* 撕下登出是純手勢互動，沒有任何按鈕可循——證卡底部明說一次。
                撕下只在吊牌狀態允許（避免拖到 ViewSwitch 誤觸），
                所以文案要先講「收起」。 */}
            <p className="uep-ident__tear-hint">
              <span className="uep-ident__tear-hint-glyph" aria-hidden="true">
                ↓
              </span>
              收起後往下拉，可撕下識別證（登出）
            </p>
          </div>
        </div>
      </div>

      {/* 浮島偏好設定視窗（portal 到 body，逃出 TopBar 堆疊上下文） */}
      {showSettings && (
        <IslandSettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
