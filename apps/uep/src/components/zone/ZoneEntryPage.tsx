import React, { useState, useEffect } from 'react';
import { ZONES } from '../../data/zones';
import type { ZoneData } from '../../data/zones';
import TopBar from '../ui/TopBar';
import UepDialogue from '../ui/UepDialogue';
import ZoneAtmosphere from '../ui/ZoneAtmosphere';
import Minimap from '../ui/Minimap';
import BigMapModal from '../ui/BigMapModal';
import PortalTransition from '../ui/PortalTransition';
import IntroOverlay from '../ui/IntroOverlay';
import ZoneHomepageRenderer from './ZoneHomepageRenderer';
import type { HomepageBlock } from '../editor/homepage/types';
import { fromContentBlock } from '../editor/homepage/types';

// ─── Shared shell wrapper ──────────────────────────────────────────────────────

interface ZoneShellProps {
  zone: ZoneData;
  onOpenMap?: () => void;
  onGoHome?: () => void;
  children: React.ReactNode;
  /** 內容是否已準備好 — 控制入場霧化何時解除 */
  ready?: boolean;
}

function ZoneShell({
  zone,
  onOpenMap,
  onGoHome,
  children,
  ready = true,
}: ZoneShellProps) {
  const corners: Array<{
    pos: React.CSSProperties;
    borders: React.CSSProperties;
  }> = [
    {
      pos: { top: 14, left: 14 },
      borders: {
        borderTop: `2px solid ${zone.main}`,
        borderLeft: `2px solid ${zone.main}`,
      },
    },
    {
      pos: { top: 14, right: 14 },
      borders: {
        borderTop: `2px solid ${zone.main}`,
        borderRight: `2px solid ${zone.main}`,
      },
    },
    {
      pos: { bottom: 14, left: 14 },
      borders: {
        borderBottom: `2px solid ${zone.main}`,
        borderLeft: `2px solid ${zone.main}`,
      },
    },
    {
      pos: { bottom: 14, right: 14 },
      borders: {
        borderBottom: `2px solid ${zone.main}`,
        borderRight: `2px solid ${zone.main}`,
      },
    },
  ];

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        background: 'var(--bg)',
        backgroundImage: `radial-gradient(circle at 30% 20%, ${zone.main}10 0%, transparent 50%)`,
        overflow: 'hidden',
      }}
    >
      {/* outline frame */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 14,
          border: `1px solid ${zone.main}40`,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* corner brackets */}
      {corners.map((c, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            position: 'absolute',
            width: 18,
            height: 18,
            pointerEvents: 'none',
            zIndex: 2,
            ...c.pos,
            ...c.borders,
          }}
        />
      ))}

      {/* 入場反向霧化 — ready 時才播放動畫，否則保持模糊 */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          pointerEvents: 'none',
          ...(ready
            ? { animation: 'zone-arrival 0.8s var(--ease-out) forwards' }
            : {
                backdropFilter: 'blur(18px)',
                background: 'rgba(10,10,14,0.5)',
              }),
        }}
      />
      <style>{`
        @keyframes zone-arrival {
          0%   { backdrop-filter: blur(18px); background: rgba(10,10,14,0.5); }
          60%  { backdrop-filter: blur(4px); background: rgba(10,10,14,0.12); }
          100% { backdrop-filter: blur(0px); background: transparent; }
        }
        .zone-entry-h1 { font-size: 88px; }
        .zone-entry-content { padding: 60px 40px 80px; }
        @media (max-width: 760px) {
          .zone-entry-h1 { font-size: 44px !important; }
          .zone-entry-content { padding: 32px 20px 56px !important; }
          .zone-arch-grid { grid-template-columns: 1fr !important; }
          .zone-arch-card { min-height: 200px !important; }
          .zone-cluster-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .zone-storage-grid { grid-template-columns: 1fr !important; }
          .zone-module-row { grid-template-columns: 36px 1fr 56px !important; gap: 8px !important; }
          .zone-module-en { display: none !important; }
        }
      `}</style>

      {/* TopBar */}
      <div style={{ position: 'relative', zIndex: 10 }}>
        <TopBar onOpenMap={onOpenMap} onGoHome={onGoHome} />
      </div>

      {/* main content */}
      <div
        style={{ flex: 1, overflowY: 'auto', position: 'relative', zIndex: 1 }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── ZoneKicker breadcrumb ─────────────────────────────────────────────────────

interface ZoneKickerProps {
  zone: ZoneData;
}

function ZoneKicker({ zone }: ZoneKickerProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.28em',
        textTransform: 'uppercase',
        color: 'var(--ink-mute)',
        marginBottom: 20,
      }}
    >
      <div
        style={{ width: 36, height: 1, background: zone.main, flexShrink: 0 }}
      />
      <span>
        {zone.kicker} · {zone.en.toUpperCase()}
      </span>
    </div>
  );
}

// ─── Shared prop types for zone entry renderers ────────────────────────────────

interface ZoneEntryProps {
  zone: ZoneData;
  onPickZone: (id: string) => void;
  onOpenMap: () => void;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. HISTORY ENTRY — 三向通道
// ══════════════════════════════════════════════════════════════════════════════

const HISTORY_CHARS = '史傳誌卷章序錄書頁遺憶典言述';

function HistoryEntry({ zone }: ZoneEntryProps) {
  const charParticles = Array.from({ length: 14 }, (_, i) => {
    const char = HISTORY_CHARS[i % HISTORY_CHARS.length];
    const left = (i * 53 + 7) % 100;
    const top = (i * 37 + 5) % 100;
    const dur = 14 + (i % 7) * 2;
    const delay = (i * 1.1) % 12;
    const dy = -(60 + (i % 4) * 40);
    return { char, left, top, dur, delay, dy, size: 12 + (i % 3) * 5 };
  });

  const arches = [
    {
      tag: '【U】',
      name: '未被記載的傳說',
      state: 'open' as const,
      color: zone.main,
      stateLabel: 'OPEN',
      grayscale: false,
      opacity: 1,
    },
    {
      tag: '【E】',
      name: '*@*?*元',
      state: 'corrupted' as const,
      color: zone.main,
      stateLabel: 'CORRUPTED',
      grayscale: true,
      opacity: 0.55,
    },
    {
      tag: '【P】',
      name: '*無法解讀的文字*',
      state: 'sealed' as const,
      color: zone.main,
      stateLabel: 'SEALED',
      grayscale: true,
      opacity: 0.55,
    },
  ];

  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      <ZoneAtmosphere zone={zone} intensity="subtle" />

      {/* drifting character particles */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {charParticles.map((p, i) => (
          <span
            key={i}
            style={
              {
                position: 'absolute',
                left: `${p.left}%`,
                top: `${p.top}%`,
                fontFamily: 'var(--font-display)',
                fontSize: p.size,
                color: zone.main,
                opacity: 0,
                animation: `drift ${p.dur}s ${p.delay}s linear infinite`,
                '--drift-x': '8px',
                '--drift-y': `${p.dy}px`,
                '--drift-opacity': '0.22',
              } as React.CSSProperties
            }
          >
            {p.char}
          </span>
        ))}
      </div>

      <div
        className="zone-entry-content"
        style={{
          maxWidth: 900,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Header */}
        <ZoneKicker zone={zone} />
        <h1
          className="zone-entry-h1"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            color: 'var(--ink-title)',
            lineHeight: 1,
            margin: '0 0 20px',
            letterSpacing: '-0.02em',
          }}
        >
          三向通道
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-serif-tc)',
            fontSize: 16,
            color: 'var(--ink-soft)',
            fontStyle: 'italic',
            lineHeight: 1.8,
            marginBottom: 36,
            maxWidth: 560,
          }}
        >
          眼前的景色讓你嘆為觀止。這裡儼然是一座大型圖書館，無數書頁正有條理地在天空中飛舞著。
        </p>

        {/* UEP dialogue */}
        <div style={{ marginBottom: 48 }}>
          <UepDialogue text={zone.uep[0]} />
          <UepDialogue side="right" text={zone.uep[1]} effects={['glow']} />
        </div>

        {/* Three archway cards */}
        <div
          className="zone-arch-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 20,
            marginBottom: 36,
          }}
        >
          {arches.map((arch) => (
            <div
              key={arch.tag}
              style={{
                height: 360,
                borderRadius: '160px 160px 4px 4px',
                border: `1px solid ${arch.color}${arch.grayscale ? '40' : '80'}`,
                background: arch.grayscale
                  ? 'var(--bg-soft)'
                  : `linear-gradient(180deg, ${arch.color}18 0%, ${arch.color}06 100%)`,
                filter: arch.grayscale ? 'grayscale(0.8)' : 'none',
                opacity: arch.opacity,
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 28,
                cursor: arch.state === 'open' ? 'pointer' : 'default',
              }}
            >
              {/* keystone line */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 2,
                  height: 28,
                  background: arch.color,
                  opacity: 0.7,
                }}
              />
              {/* tag */}
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.18em',
                  color: arch.color,
                  marginBottom: 16,
                  marginTop: 8,
                }}
              >
                {arch.tag}
              </div>

              {/* open arch: drifting chars inside */}
              {arch.state === 'open' && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                  }}
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <span
                      key={i}
                      style={
                        {
                          position: 'absolute',
                          left: `${15 + i * 16}%`,
                          top: `${40 + (i % 3) * 15}%`,
                          fontFamily: 'var(--font-display)',
                          fontSize: 11 + (i % 2) * 4,
                          color: zone.main,
                          opacity: 0,
                          animation: `drift ${10 + i * 2}s ${i * 0.8}s linear infinite`,
                          '--drift-x': '4px',
                          '--drift-y': '-50px',
                          '--drift-opacity': '0.3',
                        } as React.CSSProperties
                      }
                    >
                      {HISTORY_CHARS[(i * 3) % HISTORY_CHARS.length]}
                    </span>
                  ))}
                </div>
              )}

              {/* arch name */}
              <div
                style={{
                  fontFamily: 'var(--font-serif-tc)',
                  fontSize: 18,
                  color: 'var(--ink-title)',
                  fontWeight: 500,
                  textAlign: 'center',
                  padding: '0 20px',
                  marginTop: 'auto',
                  marginBottom: 20,
                }}
              >
                {arch.name}
              </div>

              {/* state label */}
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.22em',
                  color: arch.grayscale ? 'var(--ink-mute)' : arch.color,
                  marginBottom: 20,
                  textTransform: 'uppercase',
                }}
              >
                {arch.stateLabel}
              </div>
            </div>
          ))}
        </div>

        {/* Hint box */}
        <div
          style={{
            fontFamily: 'var(--font-serif-tc)',
            fontSize: 13,
            color: 'var(--ink-mute)',
            padding: '14px 20px',
            border: `1px solid var(--hairline)`,
            borderLeft: `3px solid ${zone.main}60`,
            background: 'var(--bg-soft)',
            lineHeight: 1.7,
          }}
        >
          看來就算是小 U 也沒有辦法完美地維護每一段歷史...
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. ECHOES ENTRY — 空白廣場
// ══════════════════════════════════════════════════════════════════════════════

const MUSIC_NOTES = ['♪', '♫', '♩', '♬', '♮', '♭'];

function EchoesEntry({ zone }: ZoneEntryProps) {
  const pearlStrings = Array.from({ length: 7 }, (_, col) => {
    const x = 8 + col * 14;
    const dotsPerString = Math.floor(100 / 28) + 1;
    return { x, dots: Array.from({ length: dotsPerString }, (_, j) => j * 28) };
  });

  const noteParticles = Array.from({ length: 18 }, (_, i) => ({
    note: MUSIC_NOTES[i % MUSIC_NOTES.length],
    left: (i * 53 + 3) % 100,
    top: (i * 41 + 10) % 100,
    dur: 11 + (i % 7),
    delay: (i * 0.9) % 14,
    dy: -(50 + (i % 4) * 30),
    size: 11 + (i % 3) * 4,
  }));

  const clusters = [
    { color: '#5B7FB3', label: '場景回聲', orbCount: 9 },
    { color: '#B86060', label: '人物回聲', orbCount: 5 },
    { color: '#5B9C7A', label: '情節回聲', orbCount: 9 },
    { color: '#8E6CB6', label: '特殊回聲', orbCount: 3 },
  ];

  const orbPulseStyle = `
    @keyframes orb-pulse {
      0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.85; }
      50% { transform: translate(-50%, -50%) scale(1.12); opacity: 1; }
    }
    @keyframes orb-pulse-sm {
      0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.7; }
      50% { transform: translate(-50%, -50%) scale(1.08); opacity: 0.9; }
    }
  `;

  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      <ZoneAtmosphere zone={zone} intensity="subtle" />
      <style>{orbPulseStyle}</style>

      {/* pearl strings */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {pearlStrings.map((s, si) => (
          <div
            key={si}
            style={{ position: 'absolute', left: `${s.x}%`, top: 0, bottom: 0 }}
          >
            {s.dots.map((dotY, di) => (
              <div
                key={di}
                style={{
                  position: 'absolute',
                  top: dotY,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 3,
                  height: 3,
                  borderRadius: '50%',
                  background: zone.main,
                  opacity: 0.12 + (di % 3) * 0.04,
                }}
              />
            ))}
          </div>
        ))}

        {/* music note particles */}
        {noteParticles.map((p, i) => (
          <span
            key={i}
            style={
              {
                position: 'absolute',
                left: `${p.left}%`,
                top: `${p.top}%`,
                fontFamily: 'var(--font-sans)',
                fontSize: p.size,
                color: zone.main,
                opacity: 0,
                animation: `drift ${p.dur}s ${p.delay}s linear infinite`,
                '--drift-x': '6px',
                '--drift-y': `${p.dy}px`,
                '--drift-opacity': '0.2',
              } as React.CSSProperties
            }
          >
            {p.note}
          </span>
        ))}
      </div>

      <div
        className="zone-entry-content"
        style={{
          maxWidth: 960,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Header */}
        <ZoneKicker zone={zone} />
        <h1
          className="zone-entry-h1"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            color: 'var(--ink-title)',
            lineHeight: 1,
            margin: '0 0 20px',
            letterSpacing: '-0.02em',
          }}
        >
          空白廣場
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-serif-tc)',
            fontSize: 16,
            color: 'var(--ink-soft)',
            fontStyle: 'italic',
            lineHeight: 1.8,
            marginBottom: 36,
            maxWidth: 560,
          }}
        >
          音樂、OST、聲音作品。可被捧起的回憶之球，在廣場上靜靜地漂浮著。
        </p>

        {/* UEP dialogues */}
        <div style={{ marginBottom: 48 }}>
          <UepDialogue text={zone.uep[0]} />
          <UepDialogue side="right" text={zone.uep[2]} effects={['shimmer']} />
        </div>

        {/* Orb cluster cards */}
        <div
          className="zone-cluster-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 16,
          }}
        >
          {clusters.map((cluster) => {
            const r = 36;
            const orbs = Array.from({ length: cluster.orbCount }, (_, i) => {
              const angle = (i / cluster.orbCount) * Math.PI * 2 - Math.PI / 2;
              const offset = (i % 2) * 10;
              return {
                x: Math.cos(angle) * (r + offset),
                y: Math.sin(angle) * (r + offset),
                size: 7 + (i % 3) * 3,
                orbIndex: i,
              };
            });

            return (
              <div
                key={cluster.label}
                style={{
                  padding: '24px 20px',
                  background: 'var(--bg-card)',
                  border: `1px solid var(--hairline)`,
                  borderTop: `2px solid ${cluster.color}`,
                  borderRadius: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 16,
                }}
              >
                {/* orb cluster */}
                <div
                  style={{
                    position: 'relative',
                    width: 110,
                    height: 110,
                    flexShrink: 0,
                  }}
                >
                  {/* center large orb */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: cluster.color,
                      boxShadow: `0 0 14px 4px ${cluster.color}55`,
                      animation: 'orb-pulse 3s ease-in-out infinite',
                    }}
                  />
                  {/* surrounding orbs */}
                  {orbs.map((orb) => (
                    <div
                      key={orb.orbIndex}
                      style={{
                        position: 'absolute',
                        top: `calc(50% + ${orb.y}px)`,
                        left: `calc(50% + ${orb.x}px)`,
                        width: orb.size,
                        height: orb.size,
                        borderRadius: '50%',
                        background: cluster.color,
                        opacity: 0.55 + (orb.orbIndex % 3) * 0.15,
                        animation: `orb-pulse-sm ${2.5 + orb.orbIndex * 0.3}s ${orb.orbIndex * 0.2}s ease-in-out infinite`,
                      }}
                    />
                  ))}
                </div>

                {/* label */}
                <div
                  style={{
                    fontFamily: 'var(--font-serif-tc)',
                    fontSize: 15,
                    color: 'var(--ink-title)',
                    fontWeight: 500,
                    textAlign: 'center',
                  }}
                >
                  {cluster.label}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: cluster.color,
                    letterSpacing: '0.14em',
                  }}
                >
                  {cluster.orbCount} echoes
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. VISUALS ENTRY — 鏡向十字路口
// ══════════════════════════════════════════════════════════════════════════════

function VisualsEntry({ zone }: ZoneEntryProps) {
  const diamondParticles = Array.from({ length: 20 }, (_, i) => ({
    left: (i * 47 + 5) % 100,
    top: (i * 39 + 8) % 100,
    dur: 10 + (i % 8) * 2,
    delay: (i * 0.7) % 12,
    dy: -(40 + (i % 5) * 25),
    size: 5 + (i % 3) * 3,
  }));

  const roads = [
    {
      area: 'fwd',
      dir: '前方',
      name: '陳列走廊',
      hint: '看起來有很多像鏡子一樣的物件?',
      href: '/visuals/gallery',
    },
    {
      area: 'lft',
      dir: '左側',
      name: '插畫長廊',
      hint: '這裡相對而言非常空曠',
      href: '/visuals/illustrations',
    },
    {
      area: 'rgt',
      dir: '右側',
      name: '草稿置放間',
      hint: '你可以看到一些人為修改過的痕跡',
      href: '/visuals/drafts',
    },
    {
      area: 'bck',
      dir: '後方',
      name: 'AI 萃取區',
      hint: '直覺告訴你有甚麼地方很詭異',
      href: '/visuals/ai',
    },
  ];

  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      <ZoneAtmosphere zone={zone} intensity="subtle" />

      {/* diamond particles */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {diamondParticles.map((p, i) => (
          <div
            key={i}
            style={
              {
                position: 'absolute',
                left: `${p.left}%`,
                top: `${p.top}%`,
                width: p.size,
                height: p.size,
                background: zone.main,
                transform: 'rotate(45deg)',
                opacity: 0,
                animation: `drift ${p.dur}s ${p.delay}s linear infinite`,
                '--drift-x': '5px',
                '--drift-y': `${p.dy}px`,
                '--drift-opacity': '0.18',
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div
        className="zone-entry-content"
        style={{
          maxWidth: 900,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Header */}
        <ZoneKicker zone={zone} />
        <h1
          className="zone-entry-h1"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            color: 'var(--ink-title)',
            lineHeight: 1,
            margin: '0 0 20px',
            letterSpacing: '-0.02em',
          }}
        >
          鏡向十字路口
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-serif-tc)',
            fontSize: 16,
            color: 'var(--ink-soft)',
            fontStyle: 'italic',
            lineHeight: 1.8,
            marginBottom: 36,
            maxWidth: 560,
          }}
        >
          畫作、插圖、視覺作品。半透明的人物像在水面盪漾，鏡中的倒影引導著方向。
        </p>

        {/* UEP dialogues */}
        <div style={{ marginBottom: 48 }}>
          <UepDialogue text={zone.uep[0]} />
          <UepDialogue side="right" text={zone.uep[1]} effects={['glow']} />
        </div>

        {/* Cross layout grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gridTemplateRows: '1fr 1fr 1fr',
            gridTemplateAreas: '". fwd ." "lft ctr rgt" ". bck ."',
            gap: 16,
            maxWidth: 680,
            margin: '0 auto',
          }}
        >
          {/* Center compass */}
          <div
            style={{
              gridArea: 'ctr',
              display: 'grid',
              placeItems: 'center',
              padding: 16,
            }}
          >
            <svg width={110} height={110} viewBox="0 0 110 110">
              <circle
                cx={55}
                cy={55}
                r={48}
                fill="none"
                stroke={zone.main}
                strokeOpacity={0.3}
                strokeWidth={1}
              />
              <circle
                cx={55}
                cy={55}
                r={36}
                fill="none"
                stroke={zone.main}
                strokeOpacity={0.15}
                strokeWidth={0.5}
                strokeDasharray="3 4"
              />
              {/* crosshair lines */}
              <line
                x1={55}
                y1={7}
                x2={55}
                y2={103}
                stroke={zone.main}
                strokeOpacity={0.4}
                strokeWidth={0.8}
              />
              <line
                x1={7}
                y1={55}
                x2={103}
                y2={55}
                stroke={zone.main}
                strokeOpacity={0.4}
                strokeWidth={0.8}
              />
              {/* ✦ center symbol */}
              <text
                x={55}
                y={60}
                textAnchor="middle"
                fontFamily="var(--font-display)"
                fontSize={20}
                fill={zone.main}
                fillOpacity={0.85}
              >
                ✦
              </text>
            </svg>
          </div>

          {/* Road cards */}
          {roads.map((road) => (
            <a
              key={road.area}
              href={road.href}
              style={{
                gridArea: road.area,
                textDecoration: 'none',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems:
                  road.area === 'lft'
                    ? 'flex-end'
                    : road.area === 'rgt'
                      ? 'flex-start'
                      : 'center',
                padding: '18px 16px',
                border: `1px solid ${zone.main}30`,
                borderRadius: 4,
                background: `${zone.main}06`,
                textAlign:
                  road.area === 'lft'
                    ? 'right'
                    : road.area === 'rgt'
                      ? 'left'
                      : 'center',
                transition:
                  'background 0.2s var(--ease), border-color 0.2s var(--ease)',
                gap: 6,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: zone.main,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                }}
              >
                {road.dir}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-serif-tc)',
                  fontSize: 16,
                  fontWeight: 500,
                  color: 'var(--ink-title)',
                }}
              >
                {road.name}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-serif-tc)',
                  fontSize: 12,
                  color: 'var(--ink-mute)',
                  fontStyle: 'italic',
                }}
              >
                {road.hint}
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. CONCEPTS ENTRY — 概念調整房
// ══════════════════════════════════════════════════════════════════════════════

const ESSENCE_SYMBOLS = 'Σ∑∮∇∂ΦΨΩλδεθ';

function ConceptsEntry({ zone }: ZoneEntryProps) {
  const symbolParticles = Array.from({ length: 22 }, (_, i) => ({
    symbol: ESSENCE_SYMBOLS[i % ESSENCE_SYMBOLS.length],
    left: (i * 53 + 9) % 100,
    top: (i * 37 + 5) % 100,
    dur: 13 + (i % 7) * 1.5,
    delay: (i * 0.85) % 11,
    dy: -(45 + (i % 5) * 20),
    size: 10 + (i % 4) * 4,
  }));

  const modules = [
    {
      id: '01',
      name: '永續紀錄主機',
      en: 'persistent_log_server',
      state: 'sync' as const,
      records: 124,
    },
    {
      id: '02',
      name: '個性瀏覽器',
      en: 'identity_browser',
      state: 'sync' as const,
      records: 38,
    },
    {
      id: '03',
      name: '原質震盪時鐘',
      en: 'essence_oscillator',
      state: 'sync' as const,
      records: 9,
    },
    {
      id: '04',
      name: '認知對照平台',
      en: 'cognition_compare',
      state: 'idle' as const,
      records: 14,
    },
  ];

  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      <ZoneAtmosphere zone={zone} intensity="subtle" />

      {/* essence symbol particles + faint grid */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {/* faint grid background */}
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
          }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id="concepts-grid"
              width={48}
              height={48}
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 48 0 L 0 0 0 48"
                fill="none"
                stroke={zone.main}
                strokeOpacity={0.06}
                strokeWidth={0.5}
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#concepts-grid)" />
        </svg>

        {symbolParticles.map((p, i) => (
          <span
            key={i}
            style={
              {
                position: 'absolute',
                left: `${p.left}%`,
                top: `${p.top}%`,
                fontFamily: 'var(--font-mono)',
                fontSize: p.size,
                color: zone.main,
                opacity: 0,
                animation: `drift ${p.dur}s ${p.delay}s linear infinite`,
                '--drift-x': '7px',
                '--drift-y': `${p.dy}px`,
                '--drift-opacity': '0.2',
              } as React.CSSProperties
            }
          >
            {p.symbol}
          </span>
        ))}
      </div>

      <div
        className="zone-entry-content"
        style={{
          maxWidth: 900,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Header */}
        <ZoneKicker zone={zone} />
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 20,
            flexWrap: 'wrap',
            marginBottom: 10,
          }}
        >
          <h1
            className="zone-entry-h1"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 500,
              color: 'var(--ink-title)',
              lineHeight: 1,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            概念調整房
          </h1>
          {/* terminal badge */}
          <div
            style={{
              alignSelf: 'flex-end',
              marginBottom: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: zone.soft,
              border: `1px solid ${zone.main}60`,
              borderRadius: 3,
              padding: '5px 12px',
              background: `${zone.main}10`,
              letterSpacing: '0.1em',
              whiteSpace: 'nowrap',
            }}
          >
            $ root@uep:~ · CONNECTED
          </div>
        </div>
        <p
          style={{
            fontFamily: 'var(--font-serif-tc)',
            fontSize: 16,
            color: 'var(--ink-soft)',
            fontStyle: 'italic',
            lineHeight: 1.8,
            marginBottom: 36,
            maxWidth: 560,
          }}
        >
          世界觀、設定文件。原質、概念、伺服器內部，所有的規則都在這裡自我修復。
        </p>

        {/* UEP dialogues */}
        <div style={{ marginBottom: 48 }}>
          <UepDialogue text={zone.uep[0]} />
          <UepDialogue side="right" text={zone.uep[2]} effects={['shimmer']} />
        </div>

        {/* Terminal-style module listing */}
        <div
          style={{
            border: `1px solid ${zone.main}50`,
            borderRadius: 4,
            overflow: 'hidden',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {/* header row */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 20px',
              background: `${zone.main}12`,
              borderBottom: `1px solid ${zone.main}30`,
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: zone.soft,
                letterSpacing: '0.08em',
              }}
            >
              // concepts.modules — listing
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
              4 units
            </span>
          </div>

          {/* module rows */}
          {modules.map((mod, i) => (
            <div
              key={mod.id}
              className="zone-module-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '36px 1fr 1fr 80px 64px 24px',
                alignItems: 'center',
                gap: 12,
                padding: '14px 20px',
                borderBottom:
                  i < modules.length - 1 ? `1px solid ${zone.main}18` : 'none',
                background: i % 2 === 0 ? `${zone.main}04` : 'transparent',
              }}
            >
              {/* id */}
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--ink-mute)',
                  letterSpacing: '0.1em',
                }}
              >
                {mod.id}
              </span>
              {/* name */}
              <span
                style={{
                  fontFamily: 'var(--font-serif-tc)',
                  fontSize: 15,
                  color: 'var(--ink-title)',
                  fontWeight: 500,
                }}
              >
                {mod.name}
              </span>
              {/* en */}
              <span
                className="zone-module-en"
                style={{
                  fontSize: 11,
                  color: 'var(--ink-mute)',
                  letterSpacing: '0.04em',
                }}
              >
                {mod.en}
              </span>
              {/* state dot + label */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background:
                      mod.state === 'sync' ? '#4ade80' : 'var(--ink-mute)',
                    boxShadow:
                      mod.state === 'sync' ? '0 0 6px 2px #4ade8060' : 'none',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: mod.state === 'sync' ? '#4ade80' : 'var(--ink-mute)',
                  }}
                >
                  {mod.state}
                </span>
              </div>
              {/* records */}
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--ink-mute)',
                  textAlign: 'right',
                }}
              >
                {mod.records} rec
              </span>
              {/* arrow */}
              <span style={{ fontSize: 12, color: zone.main, opacity: 0.6 }}>
                ›
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. STORAGE ENTRY — 雜亂的書桌
// ══════════════════════════════════════════════════════════════════════════════

function StorageEntry({ zone }: ZoneEntryProps) {
  const dustParticles = Array.from({ length: 28 }, (_, i) => ({
    left: (i * 53 + 3) % 100,
    top: (i * 41 + 7) % 100,
    dur: 18 + (i % 9) * 2,
    delay: (i * 1.3) % 16,
    dy: -(30 + (i % 6) * 15),
  }));

  const links = [
    {
      num: '01',
      title: '箱子堆成的遊樂場',
      file: 'boxes.md',
      hint: '好像被紙箱堆滿的倉庫',
      href: '/storage/boxes',
    },
    {
      num: '02',
      title: '更新公告',
      file: 'desk/changelog/',
      hint: '有幾張新貼上去的紙條',
      href: '/storage/changelog',
    },
    {
      num: '03',
      title: '雜物與草稿',
      file: 'desk/extras/',
      hint: '各種說不清楚用途的東西',
      href: '/storage/extras',
    },
  ];

  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      <ZoneAtmosphere zone={zone} intensity="subtle" />

      {/* warm desk lamp light */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 60% 50% at 20% 10%, rgba(213,182,24,0.07) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      {/* floating dust */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {dustParticles.map((p, i) => (
          <div
            key={i}
            style={
              {
                position: 'absolute',
                left: `${p.left}%`,
                top: `${p.top}%`,
                width: 1.5,
                height: 1.5,
                borderRadius: '50%',
                background: 'var(--ink-mute)',
                opacity: 0,
                animation: `drift ${p.dur}s ${p.delay}s linear infinite`,
                '--drift-x': '4px',
                '--drift-y': `${p.dy}px`,
                '--drift-opacity': '0.18',
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div
        className="zone-entry-content"
        style={{
          maxWidth: 900,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Header */}
        <ZoneKicker zone={zone} />
        <h1
          className="zone-entry-h1"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            color: 'var(--ink-title)',
            lineHeight: 1,
            margin: '0 0 20px',
            letterSpacing: '-0.02em',
          }}
        >
          雜亂的書桌
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-serif-tc)',
            fontSize: 16,
            color: 'var(--ink-soft)',
            fontStyle: 'italic',
            lineHeight: 1.8,
            marginBottom: 36,
            maxWidth: 560,
          }}
        >
          公告、Meta、雜項。一片散亂卻自有秩序的房間，好像某個人留下的痕跡。
        </p>

        {/* UEP dialogue */}
        <div style={{ marginBottom: 48 }}>
          <UepDialogue text={zone.uep[0]} />
        </div>

        {/* Two-column grid */}
        <div
          className="zone-storage-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 36,
            alignItems: 'start',
          }}
        >
          {/* LEFT: yellow sticky note */}
          <div style={{ position: 'relative' }}>
            <div
              style={{
                position: 'relative',
                background: 'linear-gradient(180deg, #FBE782 0%, #F5D960 100%)',
                color: '#3a2f08',
                padding: '28px 28px 24px',
                borderRadius: 2,
                transform: 'rotate(-1.5deg)',
                boxShadow: '2px 4px 18px rgba(0,0,0,0.15)',
                overflow: 'hidden',
              }}
            >
              {/* dog-ear triangle */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  width: 0,
                  height: 0,
                  borderTop: '28px solid #d4b94a',
                  borderLeft: '28px solid transparent',
                }}
              />
              {/* note text */}
              <div
                style={{
                  fontFamily: 'var(--font-serif-tc)',
                  fontSize: 14,
                  lineHeight: 2,
                  color: '#3a2f08',
                  marginBottom: 20,
                }}
              >
                喂! 你來到這裡了嗎? 這個地方有點奇怪呢...
                <br />
                不過既然你來了，就好好看看吧! (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧
                <br />
                也許這裡有一些有趣的東西喔~
              </div>
              {/* attribution */}
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: '#5a4a18',
                  letterSpacing: '0.1em',
                  textAlign: 'right',
                }}
              >
                — u.e.p
              </div>
            </div>
            {/* quote below note */}
            <p
              style={{
                fontFamily: 'var(--font-serif-tc)',
                fontSize: 13,
                color: 'var(--ink-mute)',
                fontStyle: 'italic',
                marginTop: 16,
                marginLeft: 8,
                lineHeight: 1.7,
              }}
            >
              嗯，是 U.E.P 留的，絕對是的。
            </p>
          </div>

          {/* RIGHT: links list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {links.map((link) => (
              <a
                key={link.num}
                href={link.href}
                style={{
                  textDecoration: 'none',
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr 20px',
                  alignItems: 'center',
                  gap: 12,
                  padding: '16px 18px',
                  border: `1px solid var(--hairline)`,
                  borderRadius: 3,
                  background: 'var(--bg-card)',
                  transition:
                    'border-color 0.18s var(--ease), background 0.18s var(--ease)',
                }}
              >
                {/* number */}
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 22,
                    color: 'var(--ink-mute)',
                    fontStyle: 'italic',
                    lineHeight: 1,
                    opacity: 0.6,
                  }}
                >
                  {link.num}
                </span>
                {/* title + file + hint */}
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--font-serif-tc)',
                      fontSize: 15,
                      color: 'var(--ink-title)',
                      fontWeight: 500,
                      marginBottom: 3,
                    }}
                  >
                    {link.title}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: zone.soft,
                      letterSpacing: '0.08em',
                      marginBottom: 3,
                    }}
                  >
                    {link.file}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-serif-tc)',
                      fontSize: 12,
                      color: 'var(--ink-mute)',
                      fontStyle: 'italic',
                    }}
                  >
                    {link.hint}
                  </div>
                </div>
                {/* arrow */}
                <span
                  style={{
                    fontSize: 16,
                    color: 'var(--ink-mute)',
                    opacity: 0.5,
                  }}
                >
                  ›
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ZONE ENTRY PAGE — main dispatcher
// ══════════════════════════════════════════════════════════════════════════════

interface ZoneEntryPageProps {
  zoneId: string;
}

// D1 API 的 area slug 映射（zoneId → API area）
const ZONE_TO_AREA: Record<string, string> = {
  history: 'history',
  echoes: 'echoes',
  visuals: 'visuals',
  concepts: 'concepts',
  storage: 'storage',
};

export default function ZoneEntryPage({ zoneId }: ZoneEntryPageProps) {
  const zone = ZONES.find((z) => z.id === zoneId);
  const [showMap, setShowMap] = useState(false);
  const [portalZone, setPortalZone] = useState<ZoneData | null>(null);
  const [introZone, setIntroZone] = useState<ZoneData | null>(null);
  const [homePortal, setHomePortal] = useState(false);

  // D1 首頁資料
  const [homepageBlocks, setHomepageBlocks] = useState<HomepageBlock[] | null>(
    null
  );
  const [homepageLoaded, setHomepageLoaded] = useState(false);

  // 安全逾時：2 秒後無論如何都解除霧化
  useEffect(() => {
    const t = setTimeout(() => setHomepageLoaded(true), 2000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!zone) return;
    const area = ZONE_TO_AREA[zoneId] || zoneId;
    const apiBase =
      (import.meta as unknown as { env?: Record<string, string> }).env
        ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

    fetch(`${apiBase}/api/content/${area}/homepage`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((json: any) => {
        if (json?.ok && json.data?.content) {
          const raw =
            typeof json.data.content === 'string'
              ? JSON.parse(json.data.content)
              : json.data.content;
          if (Array.isArray(raw) && raw.length > 0) {
            setHomepageBlocks(raw.map(fromContentBlock));
          }
        }
      })
      .catch(() => {
        // API 失敗 — 使用硬編碼 fallback
      })
      .finally(() => setHomepageLoaded(true));
  }, [zoneId]);

  if (!zone) {
    return (
      <div
        style={{
          padding: 60,
          fontFamily: 'var(--font-mono)',
          color: 'var(--ink-mute)',
        }}
      >
        Zone not found: {zoneId}
      </div>
    );
  }

  const sharedRest: ZoneEntryProps = {
    zone,
    onPickZone: (id: string) => {
      const target = ZONES.find((z) => z.id === id);
      if (!target) return;
      setShowMap(false);
      if (target.id === zoneId) return;

      setPortalZone(target);
      window.setTimeout(() => {
        window.location.href = `/${target.slug}`;
      }, 1100);
    },
    onOpenMap: () => setShowMap(true),
  };

  function renderEntry() {
    // 有 D1 首頁資料時，使用資料驅動渲染器
    if (homepageBlocks && homepageBlocks.length > 0) {
      return <ZoneHomepageRenderer blocks={homepageBlocks} zone={zone!} />;
    }

    // Fallback：硬編碼的入口頁面
    switch (zoneId) {
      case 'history':
        return <HistoryEntry {...sharedRest} />;
      case 'echoes':
        return <EchoesEntry {...sharedRest} />;
      case 'visuals':
        return <VisualsEntry {...sharedRest} />;
      case 'concepts':
        return <ConceptsEntry {...sharedRest} />;
      case 'storage':
        return <StorageEntry {...sharedRest} />;
      default:
        return (
          <div
            style={{
              padding: 60,
              fontFamily: 'var(--font-serif-tc)',
              color: 'var(--ink-soft)',
            }}
          >
            暫無此區域的入口頁面。
          </div>
        );
    }
  }

  return (
    <>
      <ZoneShell
        zone={zone}
        onOpenMap={() => setShowMap(true)}
        ready={homepageLoaded}
        onGoHome={() => {
          setHomePortal(true);
          setTimeout(() => {
            window.location.href = '/';
          }, 1100);
        }}
      >
        {renderEntry()}
      </ZoneShell>

      {/* Minimap — bottom-left */}
      <Minimap
        zones={ZONES}
        currentId={zoneId}
        onExpand={() => setShowMap(true)}
        onPickZone={sharedRest.onPickZone}
        position="bottom-left"
      />

      {/* BigMap modal */}
      {showMap && (
        <BigMapModal
          zones={ZONES}
          onClose={() => setShowMap(false)}
          onPick={(z) => {
            setShowMap(false);
            setIntroZone(z);
          }}
          onCenterClick={() => {
            setShowMap(false);
            setHomePortal(true);
            setTimeout(() => {
              window.location.href = '/';
            }, 1100);
          }}
        />
      )}

      <IntroOverlay
        zone={introZone}
        onClose={() => setIntroZone(null)}
        onEnter={() => {
          if (!introZone) return;
          sharedRest.onPickZone(introZone.id);
          setIntroZone(null);
        }}
      />
      <PortalTransition zone={portalZone} onDone={() => setPortalZone(null)} />
      <PortalTransition
        zone={null}
        homeMode={homePortal}
        onDone={() => setHomePortal(false)}
      />
    </>
  );
}
