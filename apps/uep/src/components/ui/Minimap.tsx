import React, { useEffect, useState, useRef } from 'react';
import type { ZoneData } from '../../data/zones';

interface MinimapProps {
  zones: ZoneData[];
  currentId?: string | null;
  onExpand?: () => void;
  onPickZone?: (zoneId: string) => void;
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
}

const MINIMAP_POSITION_KEY = 'uep-minimap-position';

type MinimapPosition = {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
};

function defaultPosition(position: MinimapProps['position'] = 'bottom-left'): MinimapPosition {
  return {
    'bottom-left': { left: 20, top: undefined, right: undefined, bottom: 20 },
    'bottom-right': { right: 20, top: undefined, left: undefined, bottom: 20 },
    'top-left': { left: 20, top: 20, right: undefined, bottom: undefined },
    'top-right': { right: 20, top: 20, left: undefined, bottom: undefined },
  }[position];
}

function clampPosition(left: number, top: number, width: number, height: number) {
  return {
    left: Math.max(8, Math.min(window.innerWidth - width - 8, left)),
    top: Math.max(8, Math.min(window.innerHeight - height - 8, top)),
    right: undefined,
    bottom: undefined,
  };
}

function readStoredPosition(): MinimapPosition | null {
  try {
    const raw = localStorage.getItem(MINIMAP_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown };
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
    return { left: parsed.left, top: parsed.top, right: undefined, bottom: undefined };
  } catch {
    return null;
  }
}

export default function Minimap({ zones, currentId, onExpand, onPickZone, position = 'bottom-left' }: MinimapProps) {
  const [pos, setPos] = useState<MinimapPosition>(() => {
    if (typeof window === 'undefined') return defaultPosition(position);
    return readStoredPosition() || defaultPosition(position);
  });
  const [drag, setDrag] = useState<{ offX: number; offY: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const posRef = useRef<MinimapPosition>(pos);

  function updatePos(next: MinimapPosition) {
    posRef.current = next;
    setPos(next);
  }

  useEffect(() => {
    const stored = readStoredPosition();
    if (!stored || !ref.current) return;
    updatePos(clampPosition(stored.left || 0, stored.top || 0, ref.current.offsetWidth, ref.current.offsetHeight));
  }, []);

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
    const current = posRef.current;
    if (current.left == null || current.top == null) return;
    localStorage.setItem(MINIMAP_POSITION_KEY, JSON.stringify({ left: current.left, top: current.top }));
  }

  const cur = zones.find(z => z.id === currentId);

  return (
    <div ref={ref} style={{
      position: 'fixed',
      ...(pos.left != null ? { left: pos.left } : {}),
      ...(pos.right != null ? { right: pos.right } : {}),
      ...(pos.top != null ? { top: pos.top } : {}),
      ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
      width: 138,
      background: 'var(--bg-card)',
      border: '1px solid var(--hairline-strong)',
      borderRadius: 2,
      fontFamily: 'var(--font-mono)', fontSize: 10,
      color: 'var(--ink-soft)',
      zIndex: 300,
      transition: drag ? 'none' : 'box-shadow .25s var(--ease)',
      boxShadow: drag ? '0 18px 40px rgba(0,0,0,.22)' : '0 6px 18px rgba(0,0,0,.10)',
      userSelect: 'none',
    }}>
      {/* drag handle */}
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '7px 10px', cursor: drag ? 'grabbing' : 'grab',
          borderBottom: '1px solid var(--hairline)',
          touchAction: 'none',
        }}
      >
        <span style={{ letterSpacing: '0.18em', textTransform: 'uppercase' as const }}>·· map</span>
        <span style={{ color: 'var(--uep-gold)', fontSize: 11 }}>⤢</span>
      </div>

      <button onClick={onExpand} title="展開大地圖" style={{
        all: 'unset', display: 'block', width: '100%',
        padding: '10px 10px 6px', cursor: 'pointer',
      }}>
        <svg viewBox="-50 -50 100 100" style={{ width: '100%', height: 92, overflow: 'visible' }}>
          <circle r="44" fill="none" stroke="var(--uep-gold)" strokeOpacity="0.32" strokeDasharray="0.6 1.6" strokeWidth="0.4" />
          {zones.map((z, i) => {
            const a0 = (i / 5) * Math.PI * 2 - Math.PI / 2 - Math.PI / 5;
            const a1 = a0 + Math.PI * 2 / 5;
            const r = 38;
            const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r;
            const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
            const isCurrent = z.id === currentId;
            return (
              <path key={z.id}
                d={`M0 0 L${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1} Z`}
                fill={z.main} fillOpacity={isCurrent ? 0.18 : 0.04}
                stroke={z.main} strokeOpacity={isCurrent ? 0.95 : 0.45}
                strokeWidth={isCurrent ? 0.7 : 0.4}
                style={{ cursor: onPickZone ? 'pointer' : 'inherit' }}
                onClick={(e) => { e.stopPropagation(); onPickZone?.(z.id); }}
              />
            );
          })}
          {/* sector dividers */}
          {zones.map((z, i) => {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2 - Math.PI / 5;
            return <line key={z.id} x1="0" y1="0"
              x2={Math.cos(a) * 38} y2={Math.sin(a) * 38}
              stroke="var(--uep-gold)" strokeOpacity="0.25" strokeWidth="0.2" />;
          })}
          {/* center U */}
          <circle r="8.5" fill="var(--bg-card)" stroke="var(--uep-gold)" strokeWidth="0.7" />
          <text textAnchor="middle" y="2.5" fontSize="7" fontWeight="600"
            fill="var(--uep-gold)" fontFamily="var(--font-display)">U</text>
        </svg>
      </button>

      <div style={{
        padding: '4px 10px 10px',
        color: cur ? cur.main : 'var(--ink)',
        fontWeight: 600, fontFamily: 'var(--font-serif-tc)', fontSize: 12,
        letterSpacing: 0,
      }}>
        {cur?.label || '邊際世界'}
      </div>
    </div>
  );
}
