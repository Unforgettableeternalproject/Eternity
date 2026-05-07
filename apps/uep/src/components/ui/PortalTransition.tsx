import React, { useEffect } from 'react';
import type { ZoneData } from '../../data/zones';

interface PortalTransitionProps {
  zone: ZoneData | null;
  onDone: () => void;
}

export default function PortalTransition({
  zone,
  onDone,
}: PortalTransitionProps) {
  useEffect(() => {
    if (!zone) return;
    const t = setTimeout(() => onDone(), 1200);
    return () => clearTimeout(t);
  }, [zone, onDone]);

  if (!zone) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 600,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {/* expanding outline rings */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: `1px solid ${zone.main}`,
            transform: 'translate(-50%,-50%)',
            animation: `portal-ring 1.2s ${i * 0.05}s var(--ease-portal) forwards`,
            opacity: 0,
          }}
        />
      ))}
      {/* gold streaks */}
      {[...Array(20)].map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 0.8,
            height: 220,
            background:
              'linear-gradient(180deg, transparent 0%, var(--uep-gold) 50%, transparent 100%)',
            transformOrigin: 'top center',
            transform: `translate(-50%, -10%) rotate(${(i / 20) * 360}deg)`,
            animation: `portal-streak 1.2s ${i * 0.015}s var(--ease-portal) forwards`,
            opacity: 0,
          }}
        />
      ))}

      <style>{`
        @keyframes portal-ring {
          0%   { width: 30px; height: 30px; opacity: 0; border-width: 2px; }
          25%  { opacity: 0.9; }
          100% { width: 200vmax; height: 200vmax; opacity: 0; border-width: 0.4px; }
        }
        @keyframes portal-streak {
          0% { opacity: 0; }
          50% { opacity: 0.8; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
