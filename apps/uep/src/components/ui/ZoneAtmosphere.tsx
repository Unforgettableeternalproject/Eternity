import React from 'react';
import type { ZoneData } from '../../data/zones';

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
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        color: zone.main,
      }}
    >
      {/* outline rings */}
      <div
        style={{
          position: 'absolute',
          left: '-20%',
          top: '-30%',
          width: '120%',
          aspectRatio: '1',
          borderRadius: '50%',
          border: `1px solid ${zone.main}`,
          opacity: 0.06,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: '-30%',
          bottom: '-40%',
          width: '90%',
          aspectRatio: '1',
          borderRadius: '50%',
          border: `1px dashed ${zone.main}`,
          opacity: 0.08,
        }}
      />

      {/* drift particles + occasional glyphs */}
      {[...Array(count)].map((_, i) => {
        const isGlyph = !skipGlyphs && i % 5 === 0 && zone.glyphs;
        const dur = 12 + (i % 9);
        const delay = (i * 0.7) % 10;
        const left = (i * 53) % 100;
        const top = (i * 37) % 100;
        const dy = -(40 + (i % 4) * 30);
        return isGlyph ? (
          <span
            key={i}
            style={
              {
                position: 'absolute',
                left: `${left}%`,
                top: `${top}%`,
                fontFamily: 'var(--font-display)',
                fontSize: 14 + (i % 4) * 6,
                color: zone.main,
                opacity: 0,
                animation: `drift ${dur}s ${delay}s linear infinite`,
                '--drift-x': '10px',
                '--drift-y': `${dy}px`,
                '--drift-opacity': '0.25',
              } as React.CSSProperties
            }
          >
            {zone.glyphs[i % zone.glyphs.length]}
          </span>
        ) : (
          <i
            key={i}
            style={
              {
                position: 'absolute',
                width: 2,
                height: 2,
                background: 'currentColor',
                borderRadius: '50%',
                left: `${left}%`,
                top: `${top}%`,
                opacity: 0,
                animation: `drift ${dur}s ${delay}s linear infinite`,
                '--drift-x': '6px',
                '--drift-y': `${dy}px`,
                '--drift-opacity': '0.5',
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
