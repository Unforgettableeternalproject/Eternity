/**
 * Visuals 解鎖儀式 — 不在目錄中的畫廊（S9-B）
 *
 * subcat 頁切換分類標籤時，有機率在卡片網格末尾浮現的一張「不該存在的」
 * 畫廊卡。點下去播一段幻影浮現動畫後解鎖浮動幻影。
 *
 * 刻意**不**混進 `currentGalleries` 那個由伺服器 tree 驅動的清單：
 * 那條路徑上每張卡都會先過 `isGalleryUnlockedInZone` 閘（鎖定就渲染成
 * disabled 死卡），點擊又會 `navigateToGallery` 打真 API（假 id 必 404）。
 * 獨立渲染在網格末尾，兩個坑都不用繞。
 *
 * 未來擴充（艾斯維爾 2026-07-25：先做 A，之後想做 C）——若要改成「點進去
 * 是一個真的能看的畫廊，看完才解鎖」，只需把 `onOpen` 換成導向那個畫廊，
 * 解鎖時機移到該畫廊看完為止；本元件的浮現條件與視覺都不用動。
 */

import React, { useEffect, useRef, useState } from 'react';

import './VisualsPhantomCard.css';

/** 浮現動畫時長（ms），與 CSS vis-phantom-open 對齊 */
const OPEN_MS = 1400;

interface Props {
  /** 動畫播完後呼叫（解鎖由呼叫端執行） */
  onOpen: () => void;
}

export default function VisualsPhantomCard({ onOpen }: Props) {
  const [opening, setOpening] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function handleClick() {
    if (opening) return;
    setOpening(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onOpen();
    }, OPEN_MS);
  }

  return (
    <button
      type="button"
      className={`visuals-gallery-card vis-phantom-card${opening ? ' is-opening' : ''}`}
      onClick={handleClick}
      disabled={opening}
      aria-label="未知幻影。一個不在目錄中的畫廊，點擊以窺看。"
      title="這個分組裡多了一張你沒見過的卡……"
    >
      <div className="vis-phantom-card__art" aria-hidden>
        <span className="vis-phantom-card__glow" />
        <span className="vis-phantom-card__scan" />
        <span className="vis-phantom-card__mark">?</span>
      </div>
      <div className="visuals-gallery-card-body vis-phantom-card__body">
        <div className="visuals-gallery-card-title vis-phantom-card__title">
          {opening ? '正在顯影……' : '未知幻影'}
        </div>
        <div className="visuals-gallery-card-meta vis-phantom-card__meta">
          — 不在目錄中 —
        </div>
      </div>
    </button>
  );
}
