import React from 'react';
import type { ZoneData } from '../../data/zones';

interface ZoneBadgeProps {
  zone: ZoneData;
  size?: number;
}

export default function ZoneBadge({ zone, size = 28 }: ZoneBadgeProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        background: zone.main,
        color: '#fff',
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: size * 0.5,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.18)',
      }}
    >
      {zone.icon}
    </div>
  );
}
