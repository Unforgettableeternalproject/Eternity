/**
 * 每日名言 Widget — Quartz 風格
 */
import React from 'react';
import { getWidgetData } from './types';

export default function WidgetDailyQuote() {
  const data = getWidgetData();
  const quote = data.quote;

  if (!quote) {
    return (
      <div className="q-widget-quote">
        <div className="q-widget-quote__text">—</div>
      </div>
    );
  }

  return (
    <div className="q-widget-quote">
      <div className="q-widget-quote__text">"{quote.text}"</div>
      {quote.author && (
        <div className="q-widget-quote__author">— {quote.author}</div>
      )}
    </div>
  );
}
