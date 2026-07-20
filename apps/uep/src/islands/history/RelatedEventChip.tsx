/**
 * RelatedEventChip — 跨島關聯事件的最小消費端（S8 下半場 V-C）
 *
 * S6 預留的 ISLAND_RELATED_EVENT 合約至此有第一組真實生產者
 * （浮動幻影展示 gallery 時廣播）／消費者（本 chip）。基礎版刻意
 * 極簡：顯示來源島與展示對象、有關聯 History 頁時提供跳轉——
 * 艾斯維爾預告後續會用更多篇幅處理此島事件，本場先讓合約跑起來，
 * 不過度設計。
 *
 * 已知限制（基礎版）：只在旅程之書展開（本元件 mount）期間聽得到
 * 事件；島收合時的廣播不補收。
 */
import React, { useEffect, useState } from 'react';

import { ISLAND_RELATED_EVENT, ISLAND_DEFINITIONS } from '../types';
import type { IslandRelatedDetail } from '../types';

import { navigateToHistoryPage } from './historyIslandData';

export default function RelatedEventChip() {
  const [related, setRelated] = useState<IslandRelatedDetail | null>(null);

  useEffect(() => {
    const onRelated = (event: Event) => {
      const detail = (event as CustomEvent<IslandRelatedDetail>).detail;
      if (!detail?.sourceZone) return;
      setRelated(detail);
    };
    window.addEventListener(ISLAND_RELATED_EVENT, onRelated);
    return () => window.removeEventListener(ISLAND_RELATED_EVENT, onRelated);
  }, []);

  if (!related) return null;

  const sourceTitle =
    ISLAND_DEFINITIONS[related.sourceZone]?.title ?? related.sourceZone;

  return (
    <div className="uep-hisland__related">
      <div className="uep-hisland__related-copy">
        <small>{sourceTitle}的迴響</small>
        <strong title={related.label}>{related.label || '未知的展示'}</strong>
      </div>
      {related.historyPageIds.map((pageId) => (
        <button
          key={pageId}
          type="button"
          className="uep-hisland__related-jump"
          onClick={() => navigateToHistoryPage(pageId)}
          title={`前往 ${pageId}`}
        >
          翻至 ›
        </button>
      ))}
      <button
        type="button"
        className="uep-hisland__related-x"
        onClick={() => setRelated(null)}
        aria-label="關閉關聯提示"
      >
        ×
      </button>
    </div>
  );
}
