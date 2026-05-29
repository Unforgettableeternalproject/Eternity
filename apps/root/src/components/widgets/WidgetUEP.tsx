/**
 * U.E.P 角色 Widget — 顯示角色圖片 + squint 互動 + 隨機音效
 */
import React, { useState, useRef, useCallback } from 'react';
import { getWidgetData } from './types';

const PINCH_SOUNDS = [
  '/se/pinch/pinch1.wav',
  '/se/pinch/pinch2.wav',
  '/se/pinch/pinch3.wav',
  '/se/pinch/pinch4.wav',
  '/se/pinch/pinch5.wav',
  '/se/pinch/pinch6.wav',
];

const DEFAULT_IMAGE = '/uep/Show.webp';

export default function WidgetUEP() {
  const data = getWidgetData();
  const imageSrc = data.uepImage || DEFAULT_IMAGE;
  const [squinting, setSquinting] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleClick = useCallback(() => {
    // squint 效果
    setSquinting(true);
    setTimeout(() => setSquinting(false), 600);

    // 隨機播放 pinch 音效
    const src = PINCH_SOUNDS[Math.floor(Math.random() * PINCH_SOUNDS.length)];
    if (audioRef.current) {
      audioRef.current.src = src;
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } else {
      const audio = new Audio(src);
      audio.volume = 0.5;
      audio.play().catch(() => {});
      audioRef.current = audio;
    }
  }, []);

  return (
    <div className="q-widget-uep">
      <div
        onClick={handleClick}
        style={{
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          padding: '8px 0',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            overflow: 'hidden',
            border: '2px solid var(--q-line)',
            transition: 'all 0.2s ease',
            transform: squinting ? 'scale(0.92)' : 'scale(1)',
          }}
        >
          <img
            src={imageSrc}
            alt="U.E.P"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transition: 'transform 0.15s ease',
              transform: squinting ? 'scaleY(0.7) translateY(8%)' : 'scaleY(1)',
            }}
          />
        </div>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            letterSpacing: '0.14em',
            color: squinting ? 'var(--q-navy)' : 'var(--q-ink-mute)',
            transition: 'color 0.15s ease',
          }}
        >
          {squinting ? '(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)' : 'CLICK ME'}
        </span>
      </div>
    </div>
  );
}
