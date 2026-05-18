import React from 'react';
import type { ZoneData } from '../../data/zones';
import { zoneTextColor } from '../../data/zones';
import './JourneyNav.css';

interface JourneyNavProps {
  /** 所有場景的 zone（按順序） */
  zones: ZoneData[];
  /** 目前可見的場景 index（-1 = 過渡場景之前） */
  activeIndex: number;
  /** 點擊導航點時捲動到對應場景 */
  onNavigate: (index: number) => void;
}

const LABELS = ['開場', '遊歷'];

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
      {/* 頂部：Hero + Transition */}
      <button
        className={`journey-nav__dot ${activeIndex <= 0 ? 'is-active' : ''}`}
        onClick={() => onNavigate(-1)}
        title="開場"
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
    </nav>
  );
}
