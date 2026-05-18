import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageItem } from '../editor/VisualsEditorBody';

// ──────────────────────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────────────────────
interface SpriteViewerProps {
  /** 精靈圖 ImageItem（必須有 isSpriteSheet = true） */
  sprite: ImageItem;
  /** 圖片完整 URL */
  spriteUrl: string;
  /** 打開原始精靈圖 lightbox */
  onOpenLightbox: () => void;
}

// ──────────────────────────────────────────────────────────────
// 速度選項
// ──────────────────────────────────────────────────────────────
const SPEED_OPTIONS = [0.25, 0.5, 1, 2] as const;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

type Point = { x: number; y: number };

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function getDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getMidpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function getRelativeToCenter(point: Point, el: HTMLElement): Point {
  const rect = el.getBoundingClientRect();
  return {
    x: point.x - (rect.left + rect.width / 2),
    y: point.y - (rect.top + rect.height / 2),
  };
}

// ──────────────────────────────────────────────────────────────
// 元件
// ──────────────────────────────────────────────────────────────
export default function SpriteViewer({
  sprite,
  spriteUrl,
  onOpenLightbox,
}: SpriteViewerProps) {
  const {
    frameWidth = 32,
    frameHeight = 32,
    frameCount = 1,
    columns = 1,
    fps = 8,
    animations = {},
    basePixelSize = 1,
  } = sprite;

  // 動畫名稱列表
  const animNames = Object.keys(animations);
  const defaultAnim = animNames[0] || null;

  // 播放狀態
  const [activeAnim, setActiveAnim] = useState<string | null>(defaultAnim);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [displayFrame, setDisplayFrame] = useState(0);

  // Zoom & Pan 狀態
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const pinchRef = useRef<{
    startDistance: number;
    startMidRel: Point;
    startZoom: number;
    startPan: Point;
  } | null>(null);

  // refs
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const frameRef = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  // 當前動畫的幀範圍
  const [rangeStart, rangeEnd] =
    activeAnim && animations[activeAnim]
      ? animations[activeAnim]
      : [0, frameCount - 1];

  // 切換動畫時重置
  useEffect(() => {
    frameRef.current = rangeStart;
    setDisplayFrame(rangeStart);
  }, [activeAnim, rangeStart]);

  // RAF 播放迴圈
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const interval = 1000 / (fps * speed);
    lastTimeRef.current = performance.now();

    const tick = (now: number) => {
      if (now - lastTimeRef.current >= interval) {
        lastTimeRef.current = now;
        const next =
          frameRef.current >= rangeEnd ? rangeStart : frameRef.current + 1;
        frameRef.current = next;
        setDisplayFrame(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, fps, speed, rangeStart, rangeEnd]);

  // 基準縮放（basePixelSize 決定顯示大小，zoom 是使用者互動縮放）
  const baseScale = Math.max(basePixelSize, 1);
  const viewW = frameWidth * baseScale;
  const viewH = frameHeight * baseScale;
  const sheetW = columns * frameWidth * baseScale;

  // 計算目前幀的 background-position（不含 zoom/pan，由 transform 處理）
  const col = displayFrame % columns;
  const row = Math.floor(displayFrame / columns);
  const bgX = -(col * viewW);
  const bgY = -(row * viewH);

  // ── Zoom（滾輪）──
  // eslint-disable-next-line no-undef
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom((z) => clampZoom(z + delta * z));
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    wrap.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      wrap.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  function beginPinch(points: Point[]) {
    const wrap = wrapRef.current;
    if (!wrap || points.length < 2) return;
    const [a, b] = points;
    const mid = getMidpoint(a, b);
    pinchRef.current = {
      startDistance: Math.max(getDistance(a, b), 1),
      startMidRel: getRelativeToCenter(mid, wrap),
      startZoom: zoomRef.current,
      startPan: panRef.current,
    };
    isPanningRef.current = false;
  }

  // ── Pan / Pinch（拖曳與雙指縮放）──
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const point = { x: e.clientX, y: e.clientY };
    pointersRef.current.set(e.pointerId, point);

    // 在 wrap 元素上設定 pointer capture，確保拖曳不中斷
    wrapRef.current?.setPointerCapture(e.pointerId);

    const points = Array.from(pointersRef.current.values());
    if (points.length >= 2) {
      beginPinch(points);
      return;
    }

    pinchRef.current = null;
    isPanningRef.current = true;
    panStartRef.current = point;
    panOriginRef.current = { ...panRef.current };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    e.preventDefault();

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = Array.from(pointersRef.current.values());

    if (points.length >= 2) {
      const wrap = wrapRef.current;
      if (!wrap) return;
      if (!pinchRef.current) beginPinch(points);
      const pinch = pinchRef.current;
      if (!pinch) return;

      const [a, b] = points;
      const distance = Math.max(getDistance(a, b), 1);
      const midRel = getRelativeToCenter(getMidpoint(a, b), wrap);
      const nextZoom = clampZoom(
        pinch.startZoom * (distance / pinch.startDistance)
      );
      const zoomRatio = nextZoom / pinch.startZoom;

      setZoom(nextZoom);
      setPan({
        x: midRel.x - (pinch.startMidRel.x - pinch.startPan.x) * zoomRatio,
        y: midRel.y - (pinch.startMidRel.y - pinch.startPan.y) * zoomRatio,
      });
      return;
    }

    if (!isPanningRef.current) return;
    setPan({
      x: panOriginRef.current.x + (e.clientX - panStartRef.current.x),
      y: panOriginRef.current.y + (e.clientY - panStartRef.current.y),
    });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (wrapRef.current?.hasPointerCapture(e.pointerId)) {
      wrapRef.current.releasePointerCapture(e.pointerId);
    }

    const points = Array.from(pointersRef.current.values());
    pinchRef.current = null;

    if (points.length === 1) {
      isPanningRef.current = true;
      panStartRef.current = points[0];
      panOriginRef.current = { ...panRef.current };
      return;
    }

    isPanningRef.current = false;
  }, []);

  // ── 復原 ──
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleDoubleClick = useCallback(() => {
    resetView();
  }, [resetView]);

  // 切換動畫
  const selectAnim = useCallback((name: string) => {
    setActiveAnim(name);
    setPlaying(true);
  }, []);

  const isZoomed = zoom !== 1 || pan.x !== 0 || pan.y !== 0;

  return (
    <div className="visuals-sprite-viewer">
      {/* ── 左側：動畫列表 ── */}
      <div className="visuals-sprite-anim-panel">
        <div className="visuals-sprite-anim-header">動畫列表</div>
        {animNames.length === 0 ? (
          <div className="visuals-sprite-anim-empty">尚未定義動畫</div>
        ) : (
          <div className="visuals-sprite-anim-list">
            {animNames.map((name) => {
              const [s, e] = animations[name]!;
              return (
                <button
                  key={name}
                  className={`visuals-sprite-anim-btn${activeAnim === name ? ' is-active' : ''}`}
                  onClick={() => selectAnim(name)}
                >
                  <span className="visuals-sprite-anim-name">{name}</span>
                  <span className="visuals-sprite-anim-range">
                    {s}–{e}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 右側：播放區 ── */}
      <div className="visuals-sprite-display-panel">
        {/* 精靈圖視窗（可 zoom/pan） */}
        <div
          ref={wrapRef}
          className="visuals-sprite-viewport-wrap"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          style={{
            cursor: isPanningRef.current ? 'grabbing' : 'grab',
            overflow: 'hidden',
            touchAction: 'none',
          }}
        >
          <div
            className="visuals-sprite-viewport"
            style={{
              width: viewW,
              height: viewH,
              backgroundImage: `url(${spriteUrl})`,
              backgroundSize: `${sheetW}px auto`,
              backgroundPosition: `${bgX}px ${bgY}px`,
              backgroundRepeat: 'no-repeat',
              imageRendering: 'pixelated',
              pointerEvents: 'none',
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transformOrigin: 'center center',
            }}
          />
        </div>

        {/* 播放控制列 */}
        <div className="visuals-sprite-controls">
          <button
            className="visuals-sprite-play-btn"
            onClick={() => setPlaying((p) => !p)}
            title={playing ? '暫停' : '播放'}
          >
            {playing ? '⏸' : '▶'}
          </button>

          <div className="visuals-sprite-speed-group">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                className={`visuals-sprite-speed-btn${speed === s ? ' is-active' : ''}`}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>

          <div className="visuals-sprite-frame-counter">
            Frame {displayFrame} / {frameCount - 1}
            {zoom !== 1 && (
              <span style={{ marginLeft: 8, opacity: 0.6 }}>
                {Math.round(zoom * 100)}%
              </span>
            )}
          </div>

          {/* 復原按鈕 */}
          {isZoomed && (
            <button
              className="visuals-sprite-speed-btn is-active"
              onClick={resetView}
              title="重置檢視"
              style={{ marginLeft: 4 }}
            >
              ↺
            </button>
          )}
        </div>

        {/* 檢視原始精靈圖 */}
        <button className="visuals-sprite-sheet-btn" onClick={onOpenLightbox}>
          檢視原始精靈圖
        </button>
      </div>
    </div>
  );
}
