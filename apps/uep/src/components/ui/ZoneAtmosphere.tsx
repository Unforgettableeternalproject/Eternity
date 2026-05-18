import React from 'react';
import type { ZoneData } from '../../data/zones';
import './ZoneAtmosphere.css';

interface ZoneAtmosphereProps {
  zone: ZoneData;
  intensity?: 'subtle' | 'normal' | 'rich';
  /** 是否跳過中文字元粒子，只保留圓點粒子 */
  skipGlyphs?: boolean;
}

export default function ZoneAtmosphere({
  zone,
  intensity = 'normal',
  skipGlyphs = false,
}: ZoneAtmosphereProps) {
  const count = { subtle: 14, normal: 26, rich: 40 }[intensity] || 26;

  return (
    <div
      className="zone-atmosphere"
      aria-hidden="true"
      style={
        {
          '--zone-atmosphere-color': `var(--${zone.id}-atmo)`,
        } as React.CSSProperties
      }
    >
      {/* 外圈線條 */}
      <div className="zone-atmosphere__ring zone-atmosphere__ring--primary" />
      <div className="zone-atmosphere__ring zone-atmosphere__ring--secondary" />

      {/* 漂浮粒子與少量字元 */}
      {[...Array(count)].map((_, i) => {
        const isGlyph = !skipGlyphs && i % 5 === 0 && zone.glyphs;
        const dur = 20 + (i % 13);
        const delay = (i * 1.1) % 14;
        const left = (i * 53) % 100;
        const top = (i * 37) % 100;
        const dy = -(40 + (i % 4) * 30);
        // 每個粒子一個偽隨機 opacity 偏移量（-0.06 ~ +0.08）
        const opacityOffset = (((i * 7 + 3) % 15) - 6) / 100;
        return isGlyph ? (
          <span
            className="zone-atmosphere__glyph"
            key={i}
            style={
              {
                left: `${left}%`,
                top: `${top}%`,
                fontSize: 14 + (i % 4) * 6,
                animation: `drift ${dur}s ${delay}s linear infinite`,
                '--drift-x': '10px',
                '--drift-y': `${dy}px`,
                '--opacity-offset': opacityOffset,
              } as React.CSSProperties
            }
          >
            {zone.glyphs[i % zone.glyphs.length]}
          </span>
        ) : (
          <i
            className="zone-atmosphere__dot"
            key={i}
            style={
              {
                left: `${left}%`,
                top: `${top}%`,
                animation: `drift ${dur}s ${delay}s linear infinite`,
                '--drift-x': '6px',
                '--drift-y': `${dy}px`,
                '--opacity-offset': opacityOffset,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
