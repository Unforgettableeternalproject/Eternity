import React, { useState, useEffect } from 'react';
import type { ZoneData } from '../../data/zones';
import PieMap3D from '../map/PieMap3D';

interface BigMapModalProps {
  zones: ZoneData[];
  onClose: () => void;
  onPick?: (zone: ZoneData) => void;
  tone?: 'dark' | 'light';
}

export default function BigMapModal({ zones, onClose, onPick, tone = 'dark' }: BigMapModalProps) {
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isDark = tone === 'dark';

  return (
    <div
      onClick={onClose}
      data-theme={isDark ? 'dark' : 'light'}
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: isDark
          ? 'radial-gradient(ellipse at 50% 30%, #1a1822 0%, #0a0a10 70%)'
          : 'rgba(248,245,238,0.92)',
        backdropFilter: 'blur(12px)',
        display: 'grid', placeItems: 'center',
        animation: 'fadeIn 0.35s var(--ease)',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', textAlign: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--uep-gold)', letterSpacing: '0.32em',
          textTransform: 'uppercase' as const, marginBottom: 6,
        }}>· The Atlas ·</div>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontSize: 38, fontWeight: 500,
          color: isDark ? '#fff' : 'var(--ink-title)', margin: '0 0 28px', letterSpacing: '-0.01em',
        }}>選擇一個世界</h2>

        <PieMap3D
          zones={zones} size={520}
          hoveredId={hover}
          onHover={setHover}
          baseTone={tone}
          onPickIntro={(z) => onPick?.(z)}
          showHints={false}
        />

        <button onClick={onClose} className="btn-outline" style={{
          position: 'absolute', top: -10, right: -10,
          color: isDark ? '#fff' : 'var(--ink)', borderColor: isDark ? 'rgba(255,255,255,0.4)' : 'var(--hairline-strong)',
        }}>關閉 ✕</button>
      </div>
    </div>
  );
}
