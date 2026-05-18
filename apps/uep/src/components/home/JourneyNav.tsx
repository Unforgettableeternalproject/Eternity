import React from 'react';
import type { ZoneData } from '../../data/zones';
import { zoneTextColor } from '../../data/zones';
import './JourneyNav.css';

interface JourneyNavProps {
  /** 所有場景的 zone（按順序） */
  zones: ZoneData[];
  /** 目前可見的場景 index（-1 = 過渡場景之前, 5 = verse） */
  activeIndex: number;
  /** 點擊導航點時捲動到對應場景 */
  onNavigate: (index: number) => void;
}

export default function JourneyNav({
  zones,
  activeIndex,
  onNavigate,
}: JourneyNavProps) {
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'dark';

  // 只在旅程進行中顯示（activeIndex >= -1 表示 hero 之後）
  const visible = activeIndex >= -1;

  return (
    <nav
      className={`journey-nav ${visible ? 'journey-nav--visible' : ''}`}
      aria-label="場景導航"
    >
      {/* 頂部：旅程入口 */}
      <button
        className={`journey-nav__dot ${activeIndex === -1 ? 'is-active' : ''}`}
        onClick={() => onNavigate(-1)}
        title="遊歷入口"
        type="button"
      >
        <span className="journey-nav__pip" />
      </button>

      <div className="journey-nav__line" />

      {/* 各 zone 導航點 */}
      {zones.map((z, i) => (
        <React.Fragment key={z.id}>
          <button
            className={`journey-nav__dot ${activeIndex === i ? 'is-active' : ''}`}
            onClick={() => onNavigate(i)}
            title={z.label}
            type="button"
            style={
              {
                '--dot-color': zoneTextColor(z.main, isDark),
              } as React.CSSProperties
            }
          >
            <span className="journey-nav__pip" />
            <span className="journey-nav__label">{z.en}</span>
          </button>
          {i < zones.length - 1 && <div className="journey-nav__line" />}
        </React.Fragment>
      ))}

      {/* Verse 導航點（離開 Storage 後出現，與其他點不連接） */}
      {activeIndex >= 5 && (
        <>
          <div className="journey-nav__gap" />
          <button
            className={`journey-nav__dot ${activeIndex === 5 ? 'is-active' : ''}`}
            onClick={() => onNavigate(5)}
            title="???"
            type="button"
            style={
              {
                '--dot-color': 'var(--uep-gold)',
              } as React.CSSProperties
            }
          >
            <span className="journey-nav__pip" />
            <span className="journey-nav__label">???</span>
          </button>
        </>
      )}
    </nav>
  );
}
