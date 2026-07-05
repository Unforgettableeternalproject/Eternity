/**
 * UEP 浮島系統 — 可拖曳視窗外殼
 *
 * 只負責「視窗」行為：拖曳、收合、焦點置頂、位置持久化、手機 bottom sheet。
 * 內容 UI 由各島元件（children）自理——視覺語彙本質不同，不強行共用。
 *
 * 拖曳機制沿用 Minimap：pointer capture + viewport clamp + 比例式 resize。
 * 手機（<=760px）不拖曳，改為底部固定的 bottom sheet。
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  clampToViewport,
  fromRatio,
  resolveCornerPosition,
  toRatio,
} from './dragPosition';
import type { PositionRatio, XYPosition } from './dragPosition';
import { getIslandRuntime } from './islandRuntime';
import { ISLAND_DEFINITIONS } from './types';
import type { IslandId } from './types';
import { useIslandRuntimeState } from './useIslands';

import './islands.css';

interface DraggableIslandProps {
  id: IslandId;
  children: React.ReactNode;
  /** 附加於視窗根節點的 class（各島掛自己的視覺語彙） */
  className?: string;
}

/** 手機判定斷點（與 Minimap 隱藏斷點一致） */
const MOBILE_QUERY = '(max-width: 760px)';

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    setMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export default function DraggableIsland({
  id,
  children,
  className,
}: DraggableIslandProps) {
  const def = ISLAND_DEFINITIONS[id];
  const runtime = getIslandRuntime();
  const runtimeState = useIslandRuntimeState();
  const isMobile = useIsMobile();

  const win = runtimeState.windows[id];
  const zIndex = runtime.zIndexOf(id);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<XYPosition>({ left: 20, top: 20 });
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<{ offX: number; offY: number } | null>(null);
  const posRef = useRef<XYPosition>(pos);
  const ratioRef = useRef<PositionRatio>({ lr: 0, tr: 0 });

  function updatePos(next: XYPosition) {
    posRef.current = next;
    setPos(next);
  }

  /* ---------- mount：還原持久化位置或用預設角落 ---------- */
  useLayoutEffect(() => {
    if (isMobile || !ref.current) return;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    const stored = win?.position ?? null;
    const initial = stored
      ? clampToViewport(stored.left, stored.top, w, h)
      : resolveCornerPosition(def.defaultCorner, w, h);
    updatePos(initial);
    ratioRef.current = toRatio(initial.left, initial.top);
    setReady(true);
    // 位置只在 mount 時還原一次；之後以拖曳為準（win.position 由本元件寫入）
  }, [isMobile]);

  /* ---------- resize：等比移動 + clamp ---------- */
  useEffect(() => {
    if (isMobile) return;
    function onResize() {
      const w = ref.current?.offsetWidth || def.width;
      const h = ref.current?.offsetHeight || 200;
      updatePos(fromRatio(ratioRef.current, w, h));
      // 不更新 ratioRef：放大回去時視窗會回到原位
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isMobile, def.width]);

  /* ---------- drag handlers（header 專用） ---------- */
  function startDrag(e: React.PointerEvent) {
    if (isMobile || !ref.current) return;
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
    const { left, top } = posRef.current;
    ratioRef.current = toRatio(left, top);
    runtime.setPosition(id, { left, top });
  }

  /* ---------- 手機：bottom sheet ---------- */
  if (isMobile) {
    return (
      <div
        className={`uep-island uep-island--sheet${className ? ` ${className}` : ''}`}
        style={{ zIndex }}
        onPointerDown={() => runtime.focus(id)}
        role="dialog"
        aria-label={def.title}
      >
        <div className="uep-island__header">
          <span className="uep-island__icon" aria-hidden>
            {def.icon}
          </span>
          <span className="uep-island__title">{def.title}</span>
          <button
            className="uep-island__collapse"
            onClick={() => runtime.close(id)}
            aria-label={`收合${def.title}`}
            title="收合"
          >
            —
          </button>
        </div>
        <div className="uep-island__body">{children}</div>
      </div>
    );
  }

  /* ---------- 桌面：浮動視窗 ---------- */
  return (
    <div
      ref={ref}
      className={`uep-island${drag ? ' uep-island--dragging' : ''}${className ? ` ${className}` : ''}`}
      style={{
        left: pos.left,
        top: pos.top,
        width: def.width,
        zIndex,
        opacity: ready ? 1 : 0,
      }}
      onPointerDown={() => runtime.focus(id)}
      role="dialog"
      aria-label={def.title}
    >
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
            runtime.close(id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`收合${def.title}`}
          title="收合"
        >
          —
        </button>
      </div>
      <div className="uep-island__body">{children}</div>
    </div>
  );
}
