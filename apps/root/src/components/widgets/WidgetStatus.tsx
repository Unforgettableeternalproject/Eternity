/**
 * 網站狀態面板 Widget — 顯示 System Status
 * 編輯器可自訂要顯示的狀態項目
 */
import React from 'react';
import { APP_VERSION } from '../../lib/version';
import { getWidgetData } from './types';

interface StatusItem {
  key: string;
  value: string;
  color?: string;
}

const COLOR_MAP: Record<string, string> = {
  green: '#22c55e',
  yellow: '#eab308',
  red: 'var(--q-coral)',
  navy: 'var(--q-navy)',
};

export default function WidgetStatus() {
  const data = getWidgetData();
  const statusData = data.statusItems || [];

  // Fallback 預設狀態
  const items: StatusItem[] =
    statusData.length > 0
      ? statusData
      : [
          { key: 'STATUS', value: 'Online', color: 'green' },
          { key: 'VERSION', value: APP_VERSION, color: 'navy' },
        ];

  return (
    <div className="q-widget-status">
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '5px 0',
            borderBottom:
              i < items.length - 1 ? '1px solid var(--q-line-soft)' : 'none',
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9.5,
              letterSpacing: '0.12em',
              textTransform: 'uppercase' as const,
              color: 'var(--q-ink-mute)',
            }}
          >
            {item.key}
          </span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              fontWeight: 600,
              color: item.color
                ? COLOR_MAP[item.color] || 'var(--q-ink)'
                : 'var(--q-ink)',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {item.color === 'green' && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: COLOR_MAP.green,
                  display: 'inline-block',
                }}
              />
            )}
            {item.color === 'red' && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: COLOR_MAP.red,
                  display: 'inline-block',
                }}
              />
            )}
            {item.color === 'yellow' && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: COLOR_MAP.yellow,
                  display: 'inline-block',
                }}
              />
            )}
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
