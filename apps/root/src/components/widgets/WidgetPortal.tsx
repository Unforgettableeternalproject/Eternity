/**
 * 隨機探索 Portal Widget — 連到文件站
 * Epic 2 前為建設中狀態
 */
import React from 'react';

const UEP_URL = 'https://uep.unforgettableeternalproject.com';

export default function WidgetPortal() {
  const zones = [
    { id: 'history', label: '歷史典藏庫', color: '#8B6914' },
    { id: 'echoes', label: '回音蒐藏間', color: '#5B7DB1' },
    { id: 'visuals', label: '幻象展示廳', color: '#7B5EA7' },
    { id: 'concepts', label: '概念調整房', color: '#2D6A4F' },
    { id: 'storage', label: '某人的置物空間', color: '#D5B618' },
  ];

  const handleExplore = () => {
    // 隨機選一個 zone
    const zone = zones[Math.floor(Math.random() * zones.length)];
    window.open(`${UEP_URL}/${zone.id}`, '_blank');
  };

  return (
    <div className="q-widget-portal">
      <button
        onClick={handleExplore}
        style={{
          width: '100%',
          padding: '12px',
          border: '1px dashed var(--q-line-hard)',
          borderRadius: 8,
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--q-navy)';
          e.currentTarget.style.background = 'rgba(39,57,108,0.04)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--q-line-hard)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span style={{ fontSize: 20 }}>🌀</span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase' as const,
            color: 'var(--q-navy)',
          }}
        >
          探索邊際世界
        </span>
        <span style={{ fontSize: 10, color: 'var(--q-ink-mute)' }}>
          隨機前往一個區域
        </span>
      </button>
    </div>
  );
}
