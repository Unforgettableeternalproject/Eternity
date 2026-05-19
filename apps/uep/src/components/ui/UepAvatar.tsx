import React from 'react';

interface UepAvatarProps {
  size?: number;
  src?: string;
  halo?: boolean;
  style?: React.CSSProperties;
}

export default function UepAvatar({
  size = 56,
  src = '/uep/Lil.webp',
  halo = true,
  style,
}: UepAvatarProps) {
  return (
    <div
      className={halo ? 'uep-halo' : ''}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background:
          'radial-gradient(circle at 50% 40%, #fff7d8 0%, #f3e6c8 70%, #e8d8a4 100%)',
        border: '2px solid var(--uep-gold)',
        boxShadow: '0 0 0 3px rgba(213,182,24,0.18)',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'end center',
        ...style,
      }}
    >
      <img
        src={src}
        alt="U.E.P"
        draggable={false}
        style={{
          width: '120%',
          objectFit: 'cover',
          objectPosition: 'top center',
          marginBottom: '-6%',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
