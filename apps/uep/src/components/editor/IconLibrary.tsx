import React, { useState } from 'react';

export interface IconDef {
  id: string;
  label: string;
  svg: string; // SVG path data (viewBox 0 0 24 24)
}

export const ICONS: IconDef[] = [
  // === 書籍與文字 ===
  {
    id: 'book',
    label: 'Book',
    svg: 'M4 4h2v16H4zm4 0h10a2 2 0 012 2v12a2 2 0 01-2 2H8V4z',
  },
  {
    id: 'scroll',
    label: 'Scroll',
    svg: 'M7 3a3 3 0 00-3 3v1h16V6a3 3 0 00-3-3H7zM4 9v9a3 3 0 003 3h10a3 3 0 003-3V9H4z',
  },
  {
    id: 'quill',
    label: 'Quill',
    svg: 'M20.7 3.3a1 1 0 00-1.4 0L8 14.6V17h2.4L21.7 5.7a1 1 0 000-1.4l-1-1zM4 20h16v2H4v-2z',
  },
  {
    id: 'feather',
    label: 'Feather',
    svg: 'M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5l6.74-6.76zM16 8L2 22m13-11l4-4',
  },
  {
    id: 'bookmark',
    label: 'Bookmark',
    svg: 'M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z',
  },

  // === 箭頭與方向 ===
  { id: 'arrow-up', label: 'Arrow Up', svg: 'M12 19V5M5 12l7-7 7 7' },
  { id: 'arrow-down', label: 'Arrow Down', svg: 'M12 5v14M5 12l7 7 7-7' },
  { id: 'arrow-left', label: 'Arrow Left', svg: 'M19 12H5M12 5l-7 7 7 7' },
  { id: 'arrow-right', label: 'Arrow Right', svg: 'M5 12h14M12 5l7 7-7 7' },
  { id: 'arrow-up-right', label: 'Arrow ↗', svg: 'M7 17L17 7M7 7h10v10' },
  { id: 'arrow-down-right', label: 'Arrow ↘', svg: 'M7 7l10 10M17 11v6h-6' },
  { id: 'chevron-right', label: 'Chevron ›', svg: 'M9 18l6-6-6-6' },
  { id: 'chevron-down', label: 'Chevron ˅', svg: 'M6 9l6 6 6-6' },
  {
    id: 'corner-down-right',
    label: 'Corner ↳',
    svg: 'M15 10l5 5-5 5M4 4v7a4 4 0 004 4h12',
  },
  {
    id: 'move',
    label: 'Move',
    svg: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  },

  // === 常用符號 ===
  { id: 'check', label: 'Check', svg: 'M20 6L9 17l-5-5' },
  { id: 'x-mark', label: 'X Mark', svg: 'M18 6L6 18M6 6l12 12' },
  { id: 'plus', label: 'Plus', svg: 'M12 5v14M5 12h14' },
  { id: 'minus', label: 'Minus', svg: 'M5 12h14' },
  {
    id: 'link',
    label: 'Link',
    svg: 'M15 7h3a5 5 0 015 5 5 5 0 01-5 5h-3m-6 0H6a5 5 0 01-5-5 5 5 0 015-5h3M8 12h8',
  },
  { id: 'zap', label: 'Zap', svg: 'M13 2L3 14h9l-1 8 10-12h-9l1-8' },

  // === 世界觀主題 ===
  {
    id: 'sparkle',
    label: 'Sparkle',
    svg: 'M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2zM18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z',
  },
  {
    id: 'sword',
    label: 'Sword',
    svg: 'M20 2l2 2-8 8-2-2 8-8zM12 12l-2-2-6 6v2h2l6-6zM4 20l2-2m0 0l-2-2',
  },
  {
    id: 'crown',
    label: 'Crown',
    svg: 'M2 20h20v2H2v-2zm1-2l3-10 4 4 2-8 2 8 4-4 3 10H3z',
  },
  {
    id: 'shield',
    label: 'Shield',
    svg: 'M12 2L4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3z',
  },
  {
    id: 'skull',
    label: 'Skull',
    svg: 'M12 2a8 8 0 00-8 8c0 3 1.5 5.5 4 7v3h8v-3c2.5-1.5 4-4 4-7a8 8 0 00-8-8zm-2 14v-2m4 2v-2',
  },
  {
    id: 'crystal',
    label: 'Crystal',
    svg: 'M12 2L6 8l6 14 6-14-6-6zM6 8l-4 4 10 10M18 8l4 4-10 10',
  },
  {
    id: 'flame',
    label: 'Flame',
    svg: 'M12 2c-2 4-6 6-6 11a6 6 0 1012 0c0-5-4-7-6-11zm0 18a3 3 0 01-3-3c0-2 3-4 3-4s3 2 3 4a3 3 0 01-3 3z',
  },
  { id: 'diamond', label: 'Diamond', svg: 'M12 2l10 10-10 10L2 12 12 2z' },

  // === 探索與導航 ===
  {
    id: 'compass',
    label: 'Compass',
    svg: 'M12 2a10 10 0 100 20 10 10 0 000-20zm3.5 6.5l-2 5-5 2 2-5 5-2z',
  },
  {
    id: 'map',
    label: 'Map',
    svg: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zm6-1v14m6-11v14',
  },
  { id: 'flag', label: 'Flag', svg: 'M5 2v20m0-18l7 3 7-3v10l-7 3-7-3' },
  {
    id: 'target',
    label: 'Target',
    svg: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 6a6 6 0 100 12 6 6 0 000-12zM12 10a2 2 0 100 4 2 2 0 000-4z',
  },
  { id: 'mountain', label: 'Mountain', svg: 'M8 3l4 8 5-5 4 14H3z' },

  // === 天象與自然 ===
  {
    id: 'star',
    label: 'Star',
    svg: 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z',
  },
  {
    id: 'moon',
    label: 'Moon',
    svg: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z',
  },
  {
    id: 'sun',
    label: 'Sun',
    svg: 'M12 7a5 5 0 100 10 5 5 0 000-10zM12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  },
  {
    id: 'cloud',
    label: 'Cloud',
    svg: 'M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z',
  },
  {
    id: 'globe',
    label: 'Globe',
    svg: 'M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15 15 0 014 10 15 15 0 01-4 10 15 15 0 01-4-10A15 15 0 0112 2z',
  },

  // === 物件與狀態 ===
  {
    id: 'heart',
    label: 'Heart',
    svg: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z',
  },
  {
    id: 'eye',
    label: 'Eye',
    svg: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zm11-3a3 3 0 100 6 3 3 0 000-6z',
  },
  {
    id: 'lock',
    label: 'Lock',
    svg: 'M5 11V7a7 7 0 1114 0v4M3 11h18v11H3V11zm9 4v3',
  },
  {
    id: 'key',
    label: 'Key',
    svg: 'M21 2l-2 2-3.5-0.5L13 6l2 2-1 1 2 2-3 3a5 5 0 11-4-4l8-8z',
  },
  {
    id: 'bell',
    label: 'Bell',
    svg: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0',
  },
  {
    id: 'music',
    label: 'Music',
    svg: 'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z',
  },
  {
    id: 'hourglass',
    label: 'Hourglass',
    svg: 'M5 2h14v4a7 7 0 01-3.5 6.06A7 7 0 0119 18v4H5v-4a7 7 0 013.5-6.06A7 7 0 015 6V2z',
  },
];

const ICON_MAP = new Map(ICONS.map((i) => [i.id, i]));

/** Render an icon by ID. Returns null if not found. */
export function renderIcon(
  iconId: string | undefined | null,
  size = 16,
  className?: string
): React.ReactElement | null {
  if (!iconId) return null;
  const icon = ICON_MAP.get(iconId);
  if (!icon) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0 }}
    >
      <path d={icon.svg} />
    </svg>
  );
}

/* === 近期使用：localStorage 讀寫 === */

const RECENT_ICONS_KEY = 'ned-recent-icons';
const MAX_RECENT = 8;

function getRecentIcons(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_ICONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentIcon(iconId: string): string[] {
  try {
    const recent = getRecentIcons().filter((id) => id !== iconId);
    recent.unshift(iconId);
    const updated = recent.slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_ICONS_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [iconId];
  }
}

/* === IconPicker 元件 === */

interface IconPickerProps {
  value: string;
  onChange: (iconId: string) => void;
  accent: string;
}

export default function IconPicker({
  value,
  onChange,
  accent,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>(getRecentIcons);

  const selected = ICON_MAP.get(value);

  const recentIcons = recentIds
    .map((id) => ICON_MAP.get(id))
    .filter((icon): icon is IconDef => !!icon);

  const handleSelect = (iconId: string) => {
    onChange(iconId);
    setOpen(false);
    if (iconId) {
      const updated = saveRecentIcon(iconId);
      setRecentIds(updated);
    }
  };

  return (
    <div className="ned-icon-picker">
      <button
        type="button"
        className="ned-icon-picker-trigger"
        onClick={() => setOpen(!open)}
      >
        {selected ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={selected.svg} />
          </svg>
        ) : (
          <span className="ned-icon-picker-empty">—</span>
        )}
        <span className="ned-icon-picker-label">
          {selected?.label || 'None'}
        </span>
        <span className="ned-icon-picker-caret">▾</span>
      </button>
      {open && (
        <div className="ned-icon-picker-dropdown">
          {/* 近期使用區塊 */}
          {recentIcons.length > 0 && (
            <>
              <div className="ned-icon-picker-section">近期使用</div>
              <div className="ned-icon-picker-recent">
                {recentIcons.map((icon) => (
                  <button
                    key={icon.id}
                    type="button"
                    className={`ned-icon-picker-recent-item ${value === icon.id ? 'is-active' : ''}`}
                    style={value === icon.id ? { color: accent } : undefined}
                    title={icon.label}
                    onClick={() => handleSelect(icon.id)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={icon.svg} />
                    </svg>
                  </button>
                ))}
              </div>
              <div className="ned-icon-picker-divider" />
            </>
          )}

          {/* 清除選擇 */}
          <button
            type="button"
            className={`ned-icon-picker-option ${!value ? 'is-active' : ''}`}
            onClick={() => handleSelect('')}
          >
            <span className="ned-icon-picker-empty">—</span>
            <span>None</span>
          </button>

          {/* 所有圖示 */}
          {ICONS.map((icon) => (
            <button
              key={icon.id}
              type="button"
              className={`ned-icon-picker-option ${value === icon.id ? 'is-active' : ''}`}
              style={value === icon.id ? { color: accent } : undefined}
              onClick={() => handleSelect(icon.id)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={icon.svg} />
              </svg>
              <span>{icon.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
