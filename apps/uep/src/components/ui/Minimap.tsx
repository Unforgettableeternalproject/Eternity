import React, { useLayoutEffect, useState, useRef, useEffect } from 'react';
import type { ZoneData } from '../../data/zones';
import { zoneTextColor } from '../../data/zones';

interface MinimapProps {
  zones: ZoneData[];
  currentId?: string | null;
  onExpand?: () => void;
  onPickZone?: (zoneId: string) => void;
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
}

const MINIMAP_POSITION_KEY = 'uep-minimap-position';
const MINIMAP_WIDTH = 120;
const MINIMAP_HEIGHT_APPROX = 140;

// 永遠只用 left/top，不使用 right/bottom，避免四值同時存在時被合併為 inset
type MinimapPosition = { left: number; top: number };

/** 小地圖在視窗中的比例位置，用於 resize 時等比移動 */
type PositionRatio = { lr: number; tr: number };

/* ────────────────────────── helpers ────────────────────────── */

function clampPosition(
  left: number,
  top: number,
  width: number,
  height: number
): MinimapPosition {
  return {
    left: Math.max(8, Math.min(window.innerWidth - width - 8, left)),
    top: Math.max(8, Math.min(window.innerHeight - height - 8, top)),
  };
}

/** 從絕對座標算出比例 */
function toRatio(left: number, top: number): PositionRatio {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    lr: vw > 0 ? left / vw : 0,
    tr: vh > 0 ? top / vh : 0,
  };
}

/** 從比例還原為絕對座標（再 clamp） */
function fromRatio(
  ratio: PositionRatio,
  width: number,
  height: number
): MinimapPosition {
  const raw = {
    left: ratio.lr * window.innerWidth,
    top: ratio.tr * window.innerHeight,
  };
  return clampPosition(raw.left, raw.top, width, height);
}

function readStoredPosition(): MinimapPosition | null {
  try {
    const raw = localStorage.getItem(MINIMAP_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown };
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number')
      return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

// 根據 position prop 換算 left/top pixel 值（需要知道元件尺寸）
function resolveDefaultPosition(
  position: NonNullable<MinimapProps['position']>,
  w: number,
  h: number
): MinimapPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const PAD = 20;
  return {
    'bottom-left': { left: PAD, top: vh - h - PAD },
    'bottom-right': { left: vw - w - PAD, top: vh - h - PAD },
    'top-left': { left: PAD, top: PAD },
    'top-right': { left: vw - w - PAD, top: PAD },
  }[position];
}

/* ══════════════════════════ Component ══════════════════════════ */

export default function Minimap({
  zones,
  currentId,
  onExpand,
  onPickZone,
  position = 'bottom-left',
}: MinimapProps) {
  // SSR 時先給一個佔位值，mount 後由 useLayoutEffect 立即修正
  const [pos, setPos] = useState<MinimapPosition>({ left: 20, top: 20 });
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<{ offX: number; offY: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const posRef = useRef<MinimapPosition>(pos);
  /** 記錄使用者設定位置時的比例，resize 時以此等比移動 */
  const ratioRef = useRef<PositionRatio>({ lr: 0, tr: 0 });

  function updatePos(next: MinimapPosition) {
    posRef.current = next;
    setPos(next);
  }

  /** 設定位置並同步更新比例快照 */
  function setPositionWithRatio(next: MinimapPosition) {
    updatePos(next);
    ratioRef.current = toRatio(next.left, next.top);
  }

  /* ---------- mount：讀取存儲位置 ---------- */
  useLayoutEffect(() => {
    if (!ref.current) return;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    const stored = readStoredPosition();

    let initial: MinimapPosition;
    if (stored) {
      initial = clampPosition(stored.left, stored.top, w, h);
    } else {
      initial = resolveDefaultPosition(position, w, h);
    }
    setPositionWithRatio(initial);
    setReady(true);
  }, []);

  /* ---------- resize：用比例等比移動 + clamp ---------- */
  useEffect(() => {
    function onResize() {
      const w = ref.current?.offsetWidth || MINIMAP_WIDTH;
      const h = ref.current?.offsetHeight || MINIMAP_HEIGHT_APPROX;
      // 用 mount / drag 時記下的比例換算新座標，再 clamp
      const next = fromRatio(ratioRef.current, w, h);
      updatePos(next);
      // 注意：這裡不更新 ratioRef，保持原始比例
      // 這樣放大回去時小地圖會回到原位而不是被逼到中間
    }

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* ---------- drag handlers ---------- */
  function startDrag(e: React.PointerEvent) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setDrag({ offX: e.clientX - rect.left, offY: e.clientY - rect.top });
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function moveDrag(e: React.PointerEvent) {
    if (!drag || !ref.current) return;
    const px = e.clientX - drag.offX;
    const py = e.clientY - drag.offY;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    updatePos(clampPosition(px, py, w, h));
  }

  function endDrag() {
    setDrag(null);
    const { left, top } = posRef.current;
    // 拖曳結束：更新比例快照 + 存 localStorage
    ratioRef.current = toRatio(left, top);
    localStorage.setItem(MINIMAP_POSITION_KEY, JSON.stringify({ left, top }));
  }

  const cur = zones.find((z) => z.id === currentId);
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'dark';

  return (
    <div
      ref={ref}
      className="uep-minimap"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: MINIMAP_WIDTH,
        background: 'var(--bg-card)',
        border: '1px solid var(--hairline-strong)',
        borderRadius: 2,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--ink-soft)',
        zIndex: 300,
        opacity: ready ? 1 : 0,
        transition: drag
          ? 'none'
          : 'box-shadow .25s var(--ease), opacity .2s var(--ease)',
        boxShadow: drag
          ? '0 18px 40px rgba(0,0,0,.22)'
          : '0 6px 18px rgba(0,0,0,.10)',
        userSelect: 'none',
      }}
    >
      {/* drag handle */}
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          padding: '5px 8px',
          cursor: drag ? 'grabbing' : 'grab',
          borderBottom: '1px solid var(--hairline)',
          touchAction: 'none',
          letterSpacing: '0.18em',
          textTransform: 'uppercase' as const,
        }}
      >
        ·· map
      </div>

      <button
        onClick={(e) => {
          // 點擊扇形 sector 時不展開大地圖（由 path onClick 處理）
          if ((e.target as Element).tagName === 'path') return;
          onExpand?.();
        }}
        title="展開大地圖"
        style={{
          all: 'unset',
          display: 'grid',
          placeItems: 'center',
          width: '100%',
          boxSizing: 'border-box',
          padding: '4px',
          cursor: 'pointer',
        }}
      >
        <svg
          viewBox="-46 -46 92 92"
          style={{ width: 82, height: 82, display: 'block' }}
        >
          <circle
            r="44"
            fill="none"
            stroke="var(--uep-gold)"
            strokeOpacity="0.32"
            strokeDasharray="0.6 1.6"
            strokeWidth="0.4"
          />
          {zones.map((z, i) => {
            const a0 = (i / 5) * Math.PI * 2 - Math.PI / 2 - Math.PI / 5;
            const a1 = a0 + (Math.PI * 2) / 5;
            const r = 38;
            const x0 = Math.cos(a0) * r,
              y0 = Math.sin(a0) * r;
            const x1 = Math.cos(a1) * r,
              y1 = Math.sin(a1) * r;
            const isCurrent = z.id === currentId;
            return (
              <path
                key={z.id}
                d={`M0 0 L${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1} Z`}
                fill={z.main}
                fillOpacity={isCurrent ? 0.18 : 0.04}
                stroke={z.main}
                strokeOpacity={isCurrent ? 0.95 : 0.45}
                strokeWidth={isCurrent ? 0.7 : 0.4}
                style={{ cursor: onPickZone ? 'pointer' : 'inherit' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onPickZone?.(z.id);
                }}
              />
            );
          })}
          {/* sector dividers */}
          {zones.map((z, i) => {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2 - Math.PI / 5;
            return (
              <line
                key={z.id}
                x1="0"
                y1="0"
                x2={Math.cos(a) * 38}
                y2={Math.sin(a) * 38}
                stroke="var(--uep-gold)"
                strokeOpacity="0.25"
                strokeWidth="0.2"
              />
            );
          })}
          {/* center U */}
          <circle
            r="8.5"
            fill="var(--bg-card)"
            stroke="var(--uep-gold)"
            strokeWidth="0.7"
          />
          <text
            textAnchor="middle"
            y="2.5"
            fontSize="7"
            fontWeight="600"
            fill="var(--uep-gold)"
            fontFamily="var(--font-display)"
          >
            U
          </text>
        </svg>
      </button>

      <div
        style={{
          padding: '2px 6px 6px',
          textAlign: 'center',
          color: cur ? zoneTextColor(cur.main, isDark) : 'var(--ink)',
          fontWeight: 600,
          fontFamily: 'var(--font-serif-tc)',
          fontSize: 11,
          letterSpacing: 0,
        }}
      >
        {cur?.label || '邊際世界'}
      </div>

      <style>{`
        @media (max-width: 760px) {
          .uep-minimap { display: none !important; }
        }
      `}</style>
    </div>
  );
}
