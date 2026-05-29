/**
 * 快速統計 Widget — Quartz 風格
 */
import React from 'react';
import { getWidgetData } from './types';

export default function WidgetQuickStats() {
  const data = getWidgetData();
  const stats = data.stats;
  const isZh = data.locale === 'zh-tw';

  if (!stats) return null;

  const entries = [
    { value: stats.projects, label: isZh ? '專案' : 'PROJECTS' },
    { value: stats.updates, label: isZh ? '更新' : 'UPDATES' },
    { value: stats.active, label: isZh ? '進行中' : 'ACTIVE' },
    { value: stats.completed, label: isZh ? '已完成' : 'DONE' },
  ];

  return (
    <div className="q-widget-stats">
      {entries.map((e) => (
        <div key={e.label} className="q-widget-stats__item">
          <span className="q-widget-stats__num">{e.value}</span>
          <span className="q-widget-stats__label">{e.label}</span>
        </div>
      ))}
    </div>
  );
}
