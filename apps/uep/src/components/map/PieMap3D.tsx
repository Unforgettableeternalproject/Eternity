import React, { useState, useMemo } from 'react';
import type { ZoneData } from '../../data/zones';
import { zoneTextColor } from '../../data/zones';
import './PieMap3D.css';

interface PieMap3DProps {
  zones: ZoneData[];
  size?: number;
  defaultTilt?: number;
  defaultYaw?: number;
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
  onPickIntro?: (zone: ZoneData) => void;
  onCenterClick?: () => void;
  showHints?: boolean;
  depth?: number;
  baseTone?: 'auto' | 'light' | 'dark';
}

export default function PieMap3D({
  zones,
  size = 560,
  defaultTilt = 52,
  defaultYaw = -16,
  hoveredId,
  onHover,
  onPickIntro,
  onCenterClick,
  showHints = true,
  depth = 26,
  baseTone = 'auto',
}: PieMap3DProps) {
  const [tilt, setTilt] = useState(defaultTilt);
  const [yaw, setYaw] = useState(defaultYaw);
  const [drag, setDrag] = useState<{
    x: number;
    y: number;
    yaw: number;
    tilt: number;
    angle: number;
  } | null>(null);

  function getPointerAngle(e: React.PointerEvent) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
  }

  function normalizeAngleDelta(delta: number) {
    return ((((delta + 180) % 360) + 360) % 360) - 180;
  }

  function onPointerDown(e: React.PointerEvent) {
    setDrag({
      x: e.clientX,
      y: e.clientY,
      yaw,
      tilt,
      angle: getPointerAngle(e),
    });
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const angleDelta = normalizeAngleDelta(getPointerAngle(e) - drag.angle);
    const dy = e.clientY - drag.y;
    setYaw(drag.yaw + angleDelta);
    setTilt(Math.max(38, Math.min(62, drag.tilt + dy * 0.18)));
  }

  function onPointerUp(e: React.PointerEvent) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDrag(null);
  }

  const slices = useMemo(
    () =>
      zones.map((z, i) => {
        const a0 = (i / 5) * 360 - 90;
        const a1 = a0 + 72;
        const mid = a0 + 36;
        return { z, i, a0, a1, mid };
      }),
    [zones]
  );

  const cardZone = zones.find((z) => z.id === hoveredId);
  const cardIndex = cardZone ? zones.indexOf(cardZone) : -1;
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'dark';

  const renderDisc = (opacity = 1, mode: 'top' | 'wall' = 'top') => (
    <svg
      viewBox="-50 -50 100 100"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
      }}
    >
      {slices.map(({ z, a0, a1, mid }) => {
        const r = 46;
        const rad0 = (a0 * Math.PI) / 180,
          rad1 = (a1 * Math.PI) / 180;
        const x0 = Math.cos(rad0) * r,
          y0 = Math.sin(rad0) * r;
        const x1 = Math.cos(rad1) * r,
          y1 = Math.sin(rad1) * r;
        const isHover = hoveredId === z.id;
        const dx =
          mode === 'top' && isHover ? Math.cos((mid * Math.PI) / 180) * 2.4 : 0;
        const dy2 =
          mode === 'top' && isHover ? Math.sin((mid * Math.PI) / 180) * 2.4 : 0;
        const fillOp = mode === 'top' ? (isHover ? 0.1 : 0.04) : 0.06;

        return (
          <g
            key={z.id}
            style={{
              transition: 'transform 0.4s var(--ease)',
              transform: `translate(${dx}px, ${dy2}px)`,
              opacity,
            }}
            onPointerEnter={mode === 'top' ? () => onHover?.(z.id) : undefined}
            onPointerLeave={mode === 'top' ? () => onHover?.(null) : undefined}
            onPointerDown={
              mode === 'top' ? (e) => e.stopPropagation() : undefined
            }
            onClick={
              mode === 'top'
                ? (e) => {
                    e.stopPropagation();
                    onPickIntro?.(z);
                  }
                : undefined
            }
          >
            <path
              d={`M0 0 L${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1} Z`}
              fill={z.main}
              fillOpacity={fillOp}
              stroke={z.main}
              strokeOpacity={isHover ? 1 : 0.6}
              strokeWidth={mode === 'top' ? (isHover ? 0.7 : 0.4) : 0.2}
              style={{
                cursor: mode === 'top' ? 'pointer' : 'default',
                transition: 'all .3s var(--ease)',
              }}
            />
            {mode === 'top' && (
              <text
                x={Math.cos((mid * Math.PI) / 180) * 30}
                y={Math.sin((mid * Math.PI) / 180) * 30}
                textAnchor="middle"
                fontSize="4"
                fontWeight="600"
                fill={isHover ? z.main : 'var(--ink-title)'}
                fontFamily="var(--font-display)"
                style={{
                  pointerEvents: 'none',
                  letterSpacing: '0.08em',
                  transition: 'fill .3s var(--ease)',
                }}
              >
                {z.label}
              </text>
            )}
          </g>
        );
      })}

      {mode === 'top' && (
        <>
          <circle
            r="46.5"
            fill="none"
            stroke="var(--uep-gold)"
            strokeOpacity="0.45"
            strokeWidth="0.18"
          />
          <circle
            r="48"
            fill="none"
            stroke="var(--uep-gold)"
            strokeOpacity="0.18"
            strokeWidth="0.12"
            strokeDasharray="0.6 1.4"
          />
          {slices.map(({ z, a0 }) => {
            const rad = (a0 * Math.PI) / 180;
            return (
              <line
                key={z.id}
                x1="0"
                y1="0"
                x2={Math.cos(rad) * 46}
                y2={Math.sin(rad) * 46}
                stroke="var(--uep-gold)"
                strokeOpacity="0.28"
                strokeWidth="0.15"
              />
            );
          })}
          <g
            className="pie-center"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onCenterClick?.();
            }}
            style={{ cursor: onCenterClick ? 'pointer' : 'default' }}
          >
            {/* hover 光暈 */}
            <circle
              className="pie-center-glow"
              r="9"
              fill="var(--uep-gold)"
              fillOpacity="0"
            />
            <circle
              r="6.5"
              fill="none"
              stroke="var(--uep-gold)"
              strokeWidth="0.4"
              className="pie-center-ring"
            />
            <circle
              r="5"
              fill="none"
              stroke="var(--uep-gold)"
              strokeOpacity="0.4"
              strokeWidth="0.25"
            />
            <text
              textAnchor="middle"
              y="2.0"
              fontSize="5.4"
              fontFamily="var(--font-display)"
              fontWeight="600"
              fill="var(--uep-gold)"
              className="pie-center-label"
            >
              U
            </text>
            {/* hover 提示文字（描邊增加可讀性） */}
            <text
              className="pie-center-hint"
              textAnchor="middle"
              y="12"
              fontSize="2.2"
              fontFamily="var(--font-mono)"
              letterSpacing="0.08em"
              fill="var(--ink-title)"
              fillOpacity="0"
              stroke="var(--bg)"
              strokeOpacity="0"
              strokeWidth="0.3"
              paintOrder="stroke"
            >
              世界的軸心
            </text>
            <style>{`
              .pie-center-glow {
                transition: fill-opacity 0.3s ease;
              }
              .pie-center-hint {
                transition: fill-opacity 0.3s ease, stroke-opacity 0.3s ease;
              }
              .pie-center-ring {
                transition: stroke-width 0.3s ease, stroke-opacity 0.3s ease;
              }
              .pie-center-label {
                transition: font-size 0.3s ease, fill-opacity 0.3s ease;
              }
              .pie-center:hover .pie-center-glow {
                fill-opacity: 0.12;
              }
              .pie-center:hover .pie-center-ring {
                stroke-width: 0.7;
                stroke-opacity: 1;
              }
              .pie-center:hover .pie-center-hint {
                fill-opacity: 0.7;
                stroke-opacity: 0.7;
              }
            `}</style>
          </g>
        </>
      )}
    </svg>
  );

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        perspective: size * 2.6,
        perspectiveOrigin: '50% 28%',
        userSelect: 'none',
        cursor: drag ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* shadow oval */}
      <div
        style={{
          position: 'absolute',
          inset: '60% 10% -8% 10%',
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0.16) 0%, transparent 70%)',
          filter: 'blur(10px)',
        }}
      />

      {/* atmosphere ring */}
      <div
        style={{
          position: 'absolute',
          inset: '-4%',
          opacity: hoveredId ? 0.6 : 0.22,
          transition: 'opacity .5s var(--ease)',
          pointerEvents: 'none',
        }}
      >
        <svg
          viewBox="-50 -50 100 100"
          style={{
            width: '100%',
            height: '100%',
            animation: 'slow-rotate 60s linear infinite',
          }}
        >
          <circle
            r="49"
            fill="none"
            stroke={cardZone ? cardZone.main : 'var(--uep-gold)'}
            strokeWidth="0.18"
            strokeDasharray="0.4 1.2"
            strokeOpacity="0.7"
          />
          <circle
            r="51"
            fill="none"
            stroke={cardZone ? cardZone.main : 'var(--uep-gold)'}
            strokeWidth="0.12"
            strokeDasharray="0.2 2"
            strokeOpacity="0.5"
          />
        </svg>
      </div>

      {/* the 3D pie */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformStyle: 'preserve-3d',
          transform: `rotateX(${tilt}deg) rotateZ(${yaw}deg)`,
          transition: drag ? 'none' : 'transform 0.6s var(--ease)',
        }}
      >
        {/* side wall layers */}
        {[...Array(depth)].map((_, k) => {
          const zOff = -(k + 1) * 1.0;
          const fade = 0.55 - (k / depth) * 0.45;
          return (
            <div
              key={k}
              style={{
                position: 'absolute',
                inset: 0,
                transform: `translateZ(${zOff}px)`,
              }}
            >
              {renderDisc(fade, 'wall')}
            </div>
          );
        })}

        {/* bottom plate */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translateZ(${-depth - 1}px)`,
          }}
        >
          <svg
            viewBox="-50 -50 100 100"
            style={{ width: '100%', height: '100%' }}
          >
            <circle
              r="46"
              fill="none"
              stroke="var(--uep-gold)"
              strokeOpacity="0.32"
              strokeWidth="0.4"
            />
            <circle
              r="46"
              fill={baseTone === 'light' ? '#FFF6E0' : 'rgba(20,21,26,0.55)'}
              fillOpacity={baseTone === 'light' ? 0.9 : 1}
            />
          </svg>
        </div>

        {/* top face */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: 'translateZ(0.5px)',
          }}
        >
          {renderDisc(1, 'top')}
        </div>

        {/* drifting particles for hovered sector */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: 'translateZ(2px)',
            pointerEvents: 'none',
          }}
        >
          <svg
            viewBox="-50 -50 100 100"
            style={{ width: '100%', height: '100%', overflow: 'visible' }}
          >
            {slices.map(({ z, a0 }) => {
              if (z.id !== hoveredId) return null;
              return z.glyphs?.map((g, gi) => {
                const gr = 18 + (gi % 3) * 8;
                const ga = a0 + 12 + gi * 14;
                const gx = Math.cos((ga * Math.PI) / 180) * gr;
                const gy = Math.sin((ga * Math.PI) / 180) * gr;
                const delay = (gi * 0.4) % 4;
                return (
                  <text
                    key={`${z.id}-${gi}`}
                    x={gx}
                    y={gy}
                    fontSize="3"
                    fill={z.main}
                    fontFamily="var(--font-display)"
                    textAnchor="middle"
                    style={{
                      opacity: 0,
                      animation: `pie-drift 3.5s ${delay}s ease-out infinite`,
                    }}
                  >
                    {g}
                  </text>
                );
              });
            })}
          </svg>
        </div>
      </div>

      {/* hover atmosphere card */}
      {cardZone && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(${
              Math.cos(
                (((cardIndex / 5) * 360 - 90 + 36 + yaw) * Math.PI) / 180
              ) *
                size *
                0.46 -
              110
            }px, ${
              Math.sin(
                (((cardIndex / 5) * 360 - 90 + 36 + yaw) * Math.PI) / 180
              ) *
                size *
                0.46 *
                Math.cos((tilt * Math.PI) / 180) -
              70
            }px)`,
            width: 220,
            padding: '14px 16px',
            background: 'var(--bg-card)',
            border: `1px solid ${cardZone.main}`,
            borderRadius: 2,
            fontFamily: 'var(--font-sans)',
            pointerEvents: 'none',
            zIndex: 5,
            transition: 'transform 0.25s var(--ease)',
          }}
        >
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <span
              key={c}
              style={{
                position: 'absolute',
                width: 8,
                height: 8,
                borderColor: cardZone.main,
                borderStyle: 'solid',
                borderWidth: 0,
                ...(c[0] === 't'
                  ? { top: -1, borderTopWidth: 1 }
                  : { bottom: -1, borderBottomWidth: 1 }),
                ...(c[1] === 'l'
                  ? { left: -1, borderLeftWidth: 1 }
                  : { right: -1, borderRightWidth: 1 }),
              }}
            />
          ))}
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: zoneTextColor(cardZone.main, isDark),
              letterSpacing: '0.18em',
              textTransform: 'uppercase' as const,
            }}
          >
            {cardZone.kicker} · {cardZone.en}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              color: 'var(--ink-title)',
              fontWeight: 600,
              marginTop: 2,
            }}
          >
            {cardZone.label}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-soft)',
              marginTop: 6,
              lineHeight: 1.55,
              fontFamily: 'var(--font-serif-tc)',
            }}
          >
            {cardZone.blurb}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--ink-mute)',
              marginTop: 10,
              paddingTop: 8,
              borderTop: '1px solid var(--hairline)',
              letterSpacing: '0.06em',
            }}
          >
            {cardZone.atmos}
          </div>
        </div>
      )}

      {/* hint badges */}
      {showHints && !drag && (
        <>
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              left: 12,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--ink-mute)',
              letterSpacing: '0.16em',
              textTransform: 'uppercase' as const,
              pointerEvents: 'none',
            }}
          >
            ↻ 拖曳旋轉
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              right: 12,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--ink-mute)',
              letterSpacing: '0.16em',
              textTransform: 'uppercase' as const,
              pointerEvents: 'none',
            }}
          >
            ⇡ 上下傾斜
          </div>
        </>
      )}
    </div>
  );
}
