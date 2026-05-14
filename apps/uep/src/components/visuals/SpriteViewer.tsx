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

  // refs
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const frameRef = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 當前動畫的幀範圍
  const [rangeStart, rangeEnd] = activeAnim && animations[activeAnim]
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
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta * z)));
    },
    [],
  );

  // ── Pan（拖曳）──
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      panOriginRef.current = { ...pan };
      // 在 wrap 元素上設定 pointer capture，確保拖曳不中斷
      wrapRef.current?.setPointerCapture(e.pointerId);
    },
    [pan],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;
      e.preventDefault();
      setPan({
        x: panOriginRef.current.x + (e.clientX - panStartRef.current.x),
        y: panOriginRef.current.y + (e.clientY - panStartRef.current.y),
      });
    },
    [],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      wrapRef.current?.releasePointerCapture(e.pointerId);
    },
    [],
  );

  // ── 復原 ──
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleDoubleClick = useCallback(() => {
    resetView();
  }, [resetView]);

  // 切換動畫
  const selectAnim = useCallback(
    (name: string) => {
      setActiveAnim(name);
      setPlaying(true);
    },
    [],
  );

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
          onWheel={handleWheel}
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
        <button
          className="visuals-sprite-sheet-btn"
          onClick={onOpenLightbox}
        >
          檢視原始精靈圖
        </button>
      </div>
    </div>
  );
}
