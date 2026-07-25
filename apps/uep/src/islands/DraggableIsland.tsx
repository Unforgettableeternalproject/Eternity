/* global ResizeObserver */
/**
 * UEP 浮島系統 — 可拖曳視窗外殼
 *
 * 只負責「視窗」行為：拖曳、收合、焦點置頂、位置持久化。
 * 內容 UI 由各島元件（children）自理——視覺語彙本質不同，不強行共用。
 *
 * 拖曳機制沿用 Minimap：pointer capture + viewport clamp + 比例式 resize。
 * 浮島只在桌面（>=761px）掛載，根守門在 IslandHost 的 useDesktopIslandViewport，
 * 因此本元件不需要任何手機分支。
 *
 * S9-C.1 起支援 bare 外殼：不畫 header 與底框，改用 IslandChromeContext
 * 把把手與收合交給島自畫（見 islandChrome.ts）。視窗行為完全不變。
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  clampToViewport,
  fromRatio,
  resolveCornerPosition,
  toRatio,
} from './dragPosition';
import type { PositionRatio, XYPosition } from './dragPosition';
import { IslandChromeContext } from './islandChrome';
import type { IslandChromeValue } from './islandChrome';
import { getIslandRuntime } from './islandRuntime';
import { DEFAULT_LEAVE_ANIM_MS, ISLAND_DEFINITIONS } from './types';
import type { IslandId } from './types';
import { useIslandRuntimeState } from './useIslands';

import './islands.css';

interface DraggableIslandProps {
  id: IslandId;
  children: React.ReactNode;
  /** 附加於視窗根節點的 class（各島掛自己的視覺語彙） */
  className?: string;
}

export default function DraggableIsland({
  id,
  children,
  className,
}: DraggableIslandProps) {
  const def = ISLAND_DEFINITIONS[id];
  const runtime = getIslandRuntime();
  const runtimeState = useIslandRuntimeState();
  const bare = def.shell === 'bare';
  const leaveMs = def.leaveMs ?? DEFAULT_LEAVE_ANIM_MS;

  const win = runtimeState.windows[id];
  const zIndex = runtime.zIndexOf(id);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<XYPosition>({ left: 20, top: 20 });
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<{ offX: number; offY: number } | null>(null);
  /** 收合動畫中（S6-3）：播完才真正 runtime.close，讓島縮往右下 dock */
  const [leaving, setLeaving] = useState(false);
  const posRef = useRef<XYPosition>(pos);
  const ratioRef = useRef<PositionRatio>({ lr: 0, tr: 0 });
  /** 尚未被使用者拖曳時，尺寸改變仍應維持各島的固定預設錨點。 */
  const usesDefaultPositionRef = useRef(win?.position == null);
  /** close 只觸發一次（animationend 與保底計時器可能都到） */
  const closeFinalizedRef = useRef(false);

  /* ---------- 收合：先播離場動畫，播完才通知 runtime ---------- */
  function finalizeClose() {
    if (closeFinalizedRef.current) return;
    closeFinalizedRef.current = true;
    runtime.close(id);
  }

  function requestClose() {
    if (leaving) return;
    setLeaving(true);
    /* 保底：prefers-reduced-motion 會把 animation 關掉（animationend
       不觸發），計時器確保無論如何都會關閉。各島離場動畫長短不同，
       時長由 def.leaveMs 指定，必須與該島 CSS 對齊。 */
    window.setTimeout(finalizeClose, leaveMs + 80);
  }

  function handleLeaveAnimationEnd(e: React.AnimationEvent) {
    /* 只認自己根節點的離場動畫，忽略子元素冒泡上來的 animationend */
    if (leaving && e.target === e.currentTarget) finalizeClose();
  }

  function updatePos(next: XYPosition) {
    posRef.current = next;
    setPos(next);
  }

  /* ---------- mount：還原持久化位置或用預設角落 ---------- */
  useLayoutEffect(() => {
    if (!ref.current) return;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    const stored = win?.position ?? null;
    usesDefaultPositionRef.current = stored == null;
    const initial = stored
      ? clampToViewport(stored.left, stored.top, w, h)
      : resolveCornerPosition(def.defaultCorner, w, h);
    updatePos(initial);
    ratioRef.current = toRatio(initial.left, initial.top);
    setReady(true);
    // 位置只在 mount 時還原一次；之後以拖曳為準（win.position 由本元件寫入）
  }, []);

  /* ---------- 內容尺寸改變：維持預設錨點並避免島被 viewport 截斷 ---------- */
  useLayoutEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') {
      return;
    }
    const element = ref.current;
    const observer = new ResizeObserver(() => {
      const w = element.offsetWidth;
      const h = element.offsetHeight;
      const next = usesDefaultPositionRef.current
        ? resolveCornerPosition(def.defaultCorner, w, h)
        : clampToViewport(posRef.current.left, posRef.current.top, w, h);
      updatePos(next);
      ratioRef.current = toRatio(next.left, next.top);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [def.defaultCorner]);

  /* ---------- resize：等比移動 + clamp ---------- */
  useEffect(() => {
    function onResize() {
      const w = ref.current?.offsetWidth || def.width;
      const h = ref.current?.offsetHeight || 200;
      updatePos(fromRatio(ratioRef.current, w, h));
      // 不更新 ratioRef：放大回去時視窗會回到原位
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [def.width]);

  /* ---------- drag handlers（header 專用） ---------- */
  function startDrag(e: React.PointerEvent) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setDrag({ offX: e.clientX - rect.left, offY: e.clientY - rect.top });
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function moveDrag(e: React.PointerEvent) {
    if (!drag || !ref.current) return;
    updatePos(
      clampToViewport(
        e.clientX - drag.offX,
        e.clientY - drag.offY,
        ref.current.offsetWidth,
        ref.current.offsetHeight
      )
    );
  }

  function endDrag() {
    if (!drag) return;
    setDrag(null);
    usesDefaultPositionRef.current = false;
    const { left, top } = posRef.current;
    ratioRef.current = toRatio(left, top);
    runtime.setPosition(id, { left, top });
  }

  /* 交給島自畫外殼的控制權（bare 模式才會被用到，但一律提供，
     島不必判斷有沒有 provider） */
  const chrome: IslandChromeValue = {
    bare,
    dragHandleProps: {
      'data-island-grip': '',
      onPointerDown: startDrag,
      onPointerMove: moveDrag,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    requestClose,
    leaving,
  };

  /* ---------- 浮動視窗 ---------- */
  return (
    <IslandChromeContext.Provider value={chrome}>
      <div
        ref={ref}
        className={`uep-island${bare ? ' uep-island--bare' : ''}${drag ? ' uep-island--dragging' : ''}${leaving ? ' uep-island--leaving' : ''}${className ? ` ${className}` : ''}`}
        style={{
          left: pos.left,
          top: pos.top,
          width: def.width,
          zIndex,
          opacity: ready ? 1 : 0,
        }}
        onPointerDown={() => runtime.focus(id)}
        onAnimationEnd={handleLeaveAnimationEnd}
        role="dialog"
        aria-label={def.title}
      >
        {!bare && (
          <div
            className="uep-island__header"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span className="uep-island__icon" aria-hidden>
              {def.icon}
            </span>
            <span className="uep-island__title">{def.title}</span>
            <button
              className="uep-island__collapse"
              onClick={(e) => {
                e.stopPropagation();
                requestClose();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={`收合${def.title}`}
              title="收合"
            >
              —
            </button>
          </div>
        )}
        <div
          className={`uep-island__body${bare ? ' uep-island__body--bare' : ''}`}
        >
          {children}
        </div>
      </div>
    </IslandChromeContext.Provider>
  );
}
