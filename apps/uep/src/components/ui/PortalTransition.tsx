import React, { useEffect } from 'react';
import type { ZoneData } from '../../data/zones';

interface PortalTransitionProps {
  zone: ZoneData | null;
  onDone: () => void;
  /** 回首頁模式 — 白色線條 + 白色霧化 */
  homeMode?: boolean;
}

export default function PortalTransition({
  zone,
  onDone,
  homeMode = false,
}: PortalTransitionProps) {
  const active = homeMode || !!zone;

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => onDone(), 1200);
    return () => clearTimeout(t);
  }, [active, onDone]);

  if (!active) return null;

  // 首頁模式：白色粗線 + 白霧；區域模式：區域色細線 + 黑霧
  const ringColor = homeMode
    ? 'rgba(255,255,255,0.85)'
    : zone?.main || '#d5b618';
  const ringWidth = homeMode ? '2.5px' : '1px';
  const streakColor = homeMode
    ? 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.7) 50%, transparent 100%)'
    : 'linear-gradient(180deg, transparent 0%, var(--uep-gold) 50%, transparent 100%)';
  const streakWidth = homeMode ? 1.5 : 0.8;
  const fogAnim = homeMode ? 'portal-fog-home' : 'portal-fog';
  const ringAnim = homeMode ? 'portal-ring-home' : 'portal-ring';

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
      {/* 背景霧化層 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          animation: `${fogAnim} 1.2s var(--ease-portal) forwards`,
        }}
      />

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
            border: `${ringWidth} solid ${ringColor}`,
            transform: 'translate(-50%,-50%)',
            animation: `${ringAnim} 1.2s ${i * 0.05}s var(--ease-portal) forwards`,
            opacity: 0,
          }}
        />
      ))}
      {/* streaks */}
      {[...Array(20)].map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: streakWidth,
            height: 220,
            background: streakColor,
            transformOrigin: 'top center',
            transform: `translate(-50%, -10%) rotate(${(i / 20) * 360}deg)`,
            animation: `portal-streak 1.2s ${i * 0.015}s var(--ease-portal) forwards`,
            opacity: 0,
          }}
        />
      ))}

      <style>{`
        @keyframes portal-fog {
          0%   { backdrop-filter: blur(0px); background: transparent; }
          40%  { backdrop-filter: blur(4px); background: rgba(10,10,14,0.15); }
          100% { backdrop-filter: blur(18px); background: rgba(10,10,14,0.55); }
        }
        @keyframes portal-fog-home {
          0%   { backdrop-filter: blur(0px); background: transparent; }
          40%  { backdrop-filter: blur(4px); background: rgba(255,255,255,0.2); }
          100% { backdrop-filter: blur(18px); background: rgba(255,255,255,0.7); }
        }
        @keyframes portal-ring {
          0%   { width: 30px; height: 30px; opacity: 0; border-width: 2px; }
          25%  { opacity: 0.9; }
          100% { width: 200vmax; height: 200vmax; opacity: 0; border-width: 0.4px; }
        }
        @keyframes portal-ring-home {
          0%   { width: 30px; height: 30px; opacity: 0; border-width: 3px; }
          25%  { opacity: 0.95; }
          100% { width: 200vmax; height: 200vmax; opacity: 0; border-width: 1px; }
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
