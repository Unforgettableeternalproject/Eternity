import React from 'react';
import './ZonePrevNext.css';

interface PrevNextItem {
  title: React.ReactNode;
  onClick: () => void;
}

interface ZonePrevNextProps {
  prev: PrevNextItem | null;
  next: PrevNextItem | null;
  prevLabel?: string;
  nextLabel?: string;
  prevEmpty?: string;
  nextEmpty?: string;
  accentColor?: string;
  className?: string;
}

export function ZonePrevNext({
  prev,
  next,
  prevLabel = 'PREV',
  nextLabel = 'NEXT',
  prevEmpty = '沒有上一篇',
  nextEmpty = '沒有下一篇',
  accentColor,
  className = '',
}: ZonePrevNextProps) {
  return (
    <div
      className={`zone-prev-next ${className}`}
      style={
        accentColor
          ? ({ '--zpn-accent': accentColor } as React.CSSProperties)
          : undefined
      }
    >
      <button type="button" disabled={!prev} onClick={() => prev?.onClick()}>
        <span>{prevLabel}</span>
        <strong>{prev ? prev.title : prevEmpty}</strong>
      </button>
      <button type="button" disabled={!next} onClick={() => next?.onClick()}>
        <span>{nextLabel}</span>
        <strong>{next ? next.title : nextEmpty}</strong>
      </button>
    </div>
  );
}
