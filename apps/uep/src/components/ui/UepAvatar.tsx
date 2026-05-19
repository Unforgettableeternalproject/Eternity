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
      {/* 頭像圖片：使用 WebP 格式，尺寸 240×240（4x 顯示解析度）以降低傳輸量 */}
      <img
        src={src}
        alt="U.E.P"
        width={240}
        height={240}
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
