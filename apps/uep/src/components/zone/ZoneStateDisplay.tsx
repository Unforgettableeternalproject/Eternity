import React from 'react';
import './ZoneStateDisplay.css';

type StateKind = 'loading' | 'error' | 'not-found' | 'empty';

interface ZoneStateDisplayProps {
  kind: StateKind;
  message?: string;
  onRetry?: () => void;
  large?: boolean;
  className?: string;
}

const DEFAULT_MESSAGES: Record<StateKind, string> = {
  loading: '正在載入...',
  error: '讀取失敗',
  'not-found': '找不到頁面',
  empty: '尚無內容',
};

export function ZoneStateDisplay({
  kind,
  message,
  onRetry,
  large = false,
  className = '',
}: ZoneStateDisplayProps) {
  const text = message || DEFAULT_MESSAGES[kind];

  return (
    <div
      className={[
        'zone-state',
        kind === 'error' && 'zone-state--error',
        large && 'zone-state--large',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span>{text}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          重試
        </button>
      )}
    </div>
  );
}
