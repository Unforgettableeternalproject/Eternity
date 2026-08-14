/**
 * 訪客計數器 Widget — Quartz 風格
 */
import React, { useEffect, useState, useRef } from 'react';
import { getWidgetData } from './types';

export default function WidgetVisitorCounter() {
  const [count, setCount] = useState<number | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const data = getWidgetData();
    const apiUrl = data.visitorApiUrl;
    if (!apiUrl) return; // 未設定 visitor API URL

    (async () => {
      try {
        // 取得計數（明確帶 site=root；未帶參數 Worker 端也視為 root，此處顯式化以利偵錯）
        const res = await fetch(`${apiUrl}/api/visitor/count?site=root`);
        const json = (await res.json()) as { totalVisitors?: number };
        let total = json.totalVisitors || 0;

        // 主頁追蹤
        const path = window.location.pathname;
        const isHome =
          path === '/' ||
          path === '/zh-tw' ||
          path === '/zh-tw/' ||
          path === '/en' ||
          path === '/en/';

        if (isHome && !sessionStorage.getItem('visitor-tracked')) {
          const trackRes = await fetch(
            `${apiUrl}/api/visitor/track?site=root`,
            {
              method: 'POST',
            }
          );
          const trackJson = (await trackRes.json()) as {
            totalVisitors?: number;
          };
          total = trackJson.totalVisitors || total;
          sessionStorage.setItem('visitor-tracked', 'true');
        }

        setCount(total);
      } catch {
        setCount(null);
      }
    })();
  }, []);

  return (
    <div className="q-widget-visitor">
      <div className="q-widget__value">
        {count !== null ? count.toLocaleString() : '---'}
      </div>
      <div className="q-widget__sub">
        {getWidgetData().locale === 'zh-tw' ? '位訪客' : 'visitors'}
      </div>
    </div>
  );
}
