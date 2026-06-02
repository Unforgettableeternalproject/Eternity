/**
 * 最新動態 Widget — Quartz 風格
 */
import React from 'react';
import { getWidgetData } from './types';

export default function WidgetLatestUpdate() {
  const data = getWidgetData();
  const update = data.latestUpdate;
  const isZh = data.locale === 'zh-tw';

  if (!update) return null;

  const title = isZh
    ? update.titleZh || update.id
    : update.titleEn || update.id;

  const dateStr = new Date(update.date).toLocaleDateString(
    isZh ? 'zh-TW' : 'en-US',
    { year: 'numeric', month: 'short', day: 'numeric' }
  );

  const href = `/${data.locale}/updates/${update.id}`;

  return (
    <div className="q-widget-latest">
      <a href={href} className="q-widget-latest__link">
        <div className="q-widget-latest__title">{title}</div>
        <div className="q-widget-latest__date">{dateStr}</div>
      </a>
    </div>
  );
}
