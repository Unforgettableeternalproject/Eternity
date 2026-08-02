/* global ResizeObserver, MutationObserver */
/**
 * 浮島教學的聚光燈 overlay（S10-4 C 段）
 *
 * ## 為什麼是聚光燈
 *
 * 三個候選裡：「島上一次性訊息」要改五次（島寬只有 300–380px，五座島內部
 * 版面各自為政，塞一塊訊息等於改五個島的版面）；「純全螢幕 overlay」得另外
 * 畫島的示意圖，而示意圖與真島必然漂移——介紹的東西不在畫面上。聚光燈是
 * 外掛一層、五島共用一份實作，指向由 `getBoundingClientRect` 天然正確。
 *
 * ## 挖空用 box-shadow 不切四塊 div
 *
 * `box-shadow: 0 0 0 9999px rgba(...)` 打在高亮框上，一個元素就是整片遮罩。
 * 四塊 div 的做法在 resize 或島被拖曳時要重算四次，而且接縫會有次像素裂縫。
 *
 * ## 幾何要持續追
 *
 * 「每步進場量一次 + resize」不夠：島內容會經 ResizeObserver 改變外殼尺寸與
 * 位置、島可能被關掉、anchor 本身可能因資料變化而 unmount。四個來源都要聽，
 * 見 `useSpotlightRect`。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { getIslandRuntime, ISLAND_CHANGE_EVENT } from '../islandRuntime';
import type { IslandChangeDetail } from '../islandRuntime';
import type { IslandId } from '../types';

import { islandRoot, type GuideStep } from './guideSteps';
import './IslandGuideOverlay.css';

/** 聚光框往外留的呼吸空間 */
const PADDING = 8;

export type GuideCloseReason =
  /** 走完最後一步 */
  | 'completed'
  /** 按了「略過教學」——與完成同樣算數，使用者明確表達不想看 */
  | 'skipped'
  /** Escape 或守門條件消失——只停止這次播放，不算看過 */
  | 'dismissed';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measureAnchor(step: GuideStep | undefined): Rect | null {
  if (!step) return null;
  const el = step.anchor();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // 已 unmount 或被摺疊成 0 的元素照 rect 畫會是一個點——降級成置中卡
  if (r.width <= 0 || r.height <= 0) return null;
  return {
    top: r.top - PADDING,
    left: r.left - PADDING,
    width: r.width + PADDING * 2,
    height: r.height + PADDING * 2,
  };
}

/**
 * 追蹤目前這一步的聚光框。
 *
 * 回傳 null 代表「量不到」——呼叫端據此降級為無聚光燈的置中卡，並在元素
 * 再次出現時自動恢復（不保留舊 rect：舊位置比沒有位置更誤導）。
 */
function useSpotlightRect(
  islandId: IslandId,
  step: GuideStep | undefined
): { rect: Rect | null; dragging: boolean } {
  const [rect, setRect] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<number | null>(null);

  const remeasure = useCallback(() => {
    if (frameRef.current !== null) return;
    // 併到下一個 frame：resize 與 ResizeObserver 可能在同一拍連發數次，
    // 而 getBoundingClientRect 是同步佈局讀取
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const root = islandRoot(islandId);
      setDragging(root?.classList.contains('uep-island--dragging') === true);
      setRect(measureAnchor(step));
    });
  }, [islandId, step]);

  useEffect(() => {
    remeasure();

    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, { passive: true });

    // 島開合／移動／焦點變化
    const onIslandChange = () => remeasure();
    window.addEventListener(ISLAND_CHANGE_EVENT, onIslandChange);

    const observers: Array<ResizeObserver | MutationObserver> = [];
    const root = islandRoot(islandId);
    if (root && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(remeasure);
      // 觀察島根與 anchor 兩者：島的外殼尺寸與 anchor 自己的尺寸
      // 是兩件事，只看其中一個都會漏
      ro.observe(root);
      const anchorEl = step?.anchor();
      if (anchorEl && anchorEl !== root) ro.observe(anchorEl);
      observers.push(ro);
    }
    if (root && typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(remeasure);
      // childList：anchor 因資料變化 unmount／重新出現
      // attributes：拖曳中的 class
      mo.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      observers.push(mo);
    }

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure);
      window.removeEventListener(ISLAND_CHANGE_EVENT, onIslandChange);
      observers.forEach((o) => o.disconnect());
    };
  }, [islandId, step, remeasure]);

  return { rect, dragging };
}

interface IslandGuideOverlayProps {
  islandId: IslandId;
  steps: GuideStep[];
  onClose: (reason: GuideCloseReason) => void;
}

export default function IslandGuideOverlay({
  islandId,
  steps,
  onClose,
}: IslandGuideOverlayProps) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const { rect, dragging } = useSpotlightRect(islandId, step);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const isLast = index >= steps.length - 1;

  // 島被關掉就沒有東西可介紹了——這不算看過
  useEffect(() => {
    const onIslandChange = (event: Event) => {
      const detail = (event as CustomEvent<IslandChangeDetail>).detail;
      if (detail?.source !== 'close') return;
      if (!getIslandRuntime().getState().windows[islandId]?.open) {
        closeRef.current('dismissed');
      }
    };
    window.addEventListener(ISLAND_CHANGE_EVENT, onIslandChange);
    return () =>
      window.removeEventListener(ISLAND_CHANGE_EVENT, onIslandChange);
  }, [islandId]);

  // Escape 只停止這次播放，不寫 seen——使用者可能只是想先看眼前的東西
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current('dismissed');
        return;
      }
      if (e.key !== 'Tab') return;
      // 焦點圈：教學是 modal，Tab 不該掉到底下的島或頁面上
      const focusables = cardRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled])'
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (
        e.shiftKey &&
        (active === first || !cardRef.current?.contains(active))
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // 進場把焦點收進說明卡，否則 Tab 的第一下仍會落在底下的頁面
  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  if (!step) return null;

  const spotlightVisible = rect !== null && !dragging;

  return (
    <div
      className="iguide"
      role="dialog"
      aria-modal="true"
      aria-label={`${step.title}（第 ${index + 1} 步，共 ${steps.length} 步）`}
      // modal 教學：不讓滑鼠事件穿過挖空處直接操作島
      onPointerDown={(e) => e.stopPropagation()}
    >
      {spotlightVisible ? (
        <div
          className="iguide-spot"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
          aria-hidden="true"
        />
      ) : (
        // 量不到 anchor（或拖曳中）就鋪滿整片遮罩，說明卡置中
        <div className="iguide-scrim" aria-hidden="true" />
      )}

      <div
        ref={cardRef}
        className={`iguide-card${spotlightVisible ? '' : ' iguide-card--center'}`}
        style={spotlightVisible ? cardPosition(rect) : undefined}
      >
        <div className="iguide-count">
          {index + 1} / {steps.length}
        </div>
        <div className="iguide-title">{step.title}</div>
        <div className="iguide-body">{step.body}</div>
        <div className="iguide-actions">
          <button
            type="button"
            className="iguide-skip"
            onClick={() => onClose('skipped')}
          >
            略過教學
          </button>
          <div className="iguide-nav">
            {index > 0 && (
              <button
                type="button"
                className="iguide-btn"
                onClick={() => setIndex((i) => i - 1)}
              >
                上一步
              </button>
            )}
            <button
              type="button"
              className="iguide-btn iguide-btn--primary"
              onClick={() =>
                isLast ? onClose('completed') : setIndex((i) => i + 1)
              }
            >
              {isLast ? '知道了' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 說明卡貼在聚光框旁邊。島固定在畫面邊緣，所以只需要決定左右——
 * 島偏右就把卡片放左邊，反之亦然。
 */
function cardPosition(rect: Rect): React.CSSProperties {
  const CARD_WIDTH = 260;
  const GAP = 16;
  const viewportWidth =
    typeof window === 'undefined' ? 1280 : window.innerWidth;
  const spaceOnLeft = rect.left;
  const placeLeft = spaceOnLeft > CARD_WIDTH + GAP;
  const left = placeLeft
    ? rect.left - CARD_WIDTH - GAP
    : Math.min(rect.left + rect.width + GAP, viewportWidth - CARD_WIDTH - GAP);
  return { top: Math.max(GAP, rect.top), left: Math.max(GAP, left) };
}
