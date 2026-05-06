import React from 'react';
import type { ZoneData } from '../../data/zones';
import UepDialogue from './UepDialogue';

interface IntroOverlayProps {
  zone: ZoneData | null;
  onClose: () => void;
  onEnter: () => void;
}

export default function IntroOverlay({ zone, onClose, onEnter }: IntroOverlayProps) {
  if (!zone) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(10,10,14,0.62)',
      backdropFilter: 'blur(10px)',
      display: 'grid', placeItems: 'center',
      animation: 'fadeIn 0.35s var(--ease)',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(640px, 86%)',
        background: 'var(--bg-card)',
        border: `1px solid ${zone.main}`,
        borderRadius: 2,
        position: 'relative',
        padding: '36px 36px 28px',
      }}>
        {/* corner accents */}
        {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
          <span key={c} style={{
            position: 'absolute', width: 14, height: 14,
            borderColor: zone.main, borderStyle: 'solid', borderWidth: 0,
            ...(c[0] === 't' ? { top: -1, borderTopWidth: 2 } : { bottom: -1, borderBottomWidth: 2 }),
            ...(c[1] === 'l' ? { left: -1, borderLeftWidth: 2 } : { right: -1, borderRightWidth: 2 }),
          }} />
        ))}

        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: zone.main, letterSpacing: '0.24em',
          textTransform: 'uppercase' as const, marginBottom: 6,
        }}>
          {zone.kicker} · {zone.en.toUpperCase()}
        </div>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 38, fontWeight: 600,
          lineHeight: 1.05, color: 'var(--ink-title)', letterSpacing: '-0.01em',
        }}>{zone.label}</div>
        <div style={{
          fontFamily: 'var(--font-serif-tc)', fontSize: 13, color: 'var(--ink-soft)',
          marginTop: 6, marginBottom: 22,
        }}>{zone.blurb}</div>

        <hr className="hairline" />

        <div style={{ paddingTop: 8 }}>
          <UepDialogue side="left" text={zone.uep[0]} effects={['shimmer', 'halo']} />
          <UepDialogue side="right" text={zone.uep[1]} effects={['shimmer']} />
          {zone.uep[2] && <UepDialogue side="left" text={zone.uep[2]} effects={['shimmer', 'glow']} />}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--hairline)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)',
            letterSpacing: '0.16em', textTransform: 'uppercase' as const,
          }}>{zone.atmos}</div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-outline" onClick={onClose}>返回地圖</button>
            <button className="btn-outline btn-outline--gold" style={{ borderColor: zone.main, color: zone.main }}
              onClick={onEnter}>進入 →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
