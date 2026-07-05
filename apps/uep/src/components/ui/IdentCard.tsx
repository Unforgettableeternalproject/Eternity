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
import IslandSettingsPanel from '../../islands/IslandSettingsPanel';
import { useProgress } from '../../progress/useProgress';

import { WELCOME_DONE_EVENT } from './GlobalWelcomeHost';
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
        animTimer = setTimeout(() => setArriving(false), ARRIVAL_ANIM_MS);
      }, ARRIVAL_POST_WELCOME_DELAY_MS);
    }

    window.addEventListener(WELCOME_DONE_EVENT, handleWelcomeDone);
    return () => {
      window.removeEventListener(WELCOME_DONE_EVENT, handleWelcomeDone);
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
      await new Promise((r) => setTimeout(r, 550));
      await getReaderAuth().logout();
      window.__uepToastManager?.info('記錄已闔上。你的足跡仍會留在此處。');
      /* session 變 null 後元件會 unmount，這裡不用手動 reset */
    } else {
      /* 掛回去：回彈 */
      resetTear(true);
    }
  }

  function handleClick() {
    if (suppressClickRef.current) return;
    setOpen((v) => !v);
  }

  return (
    <div
      className={`uep-ident${open ? ' is-open' : ''}${arriving ? ' is-arriving' : ''}`}
      ref={rootRef}
    >
      {/* 吊繩：從 TopBar 下緣垂下，撕下拖曳時會被拉長 */}
      <div className="uep-ident__cord" aria-hidden="true" />

      {/* 翻面主體：吊牌與證卡是同一張卡的正反面 */}
      <div className="uep-ident__flip">
        <button
          type="button"
          className="uep-ident__flip-inner"
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-expanded={open}
          aria-label={open ? '收起識別證' : '展開識別證（往下拖曳可撕下登出）'}
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
          </div>
        </button>
      </div>

      {/* 浮島偏好設定視窗（portal 到 body，逃出 TopBar 堆疊上下文） */}
      {showSettings && (
        <IslandSettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
