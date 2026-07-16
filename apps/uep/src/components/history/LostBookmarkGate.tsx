/**
 * 「一張遺落的書籤」儀式頁（S6-2）
 *
 * 從導航樹的書籤條目點入，佔據 Reader 內容區的間隙頁：
 * 破舊書籤 + 羊皮紙語彙，按「翻開它」播放甦醒動畫後解鎖旅程之書。
 * 導頁去向由呼叫端（HistoryReader）決定——按下後 onOpen 只負責解鎖。
 */

import React, { useEffect, useRef, useState } from 'react';

import './LostBookmarkGate.css';

interface LostBookmarkGateProps {
  /** 甦醒動畫播完後呼叫（解鎖 + 導回上次閱讀頁由呼叫端執行） */
  onOpen: () => void;
}

/** 甦醒動畫時長（ms），與 CSS keyframes 對齊 */
const AWAKEN_MS = 1400;

export default function LostBookmarkGate({ onOpen }: LostBookmarkGateProps) {
  const [awakening, setAwakening] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleOpen = () => {
    if (awakening) return;
    setAwakening(true);
    timerRef.current = window.setTimeout(() => {
      onOpen();
    }, AWAKEN_MS);
  };

  return (
    <section
      className={`lost-bookmark-gate${awakening ? ' is-awakening' : ''}`}
      aria-live="polite"
    >
      <div className="lost-bookmark-gate__inner">
        <div className="lost-bookmark-gate__ribbon" aria-hidden />
        <div className="lost-bookmark-gate__kicker">─ 書架的縫隙 ─</div>
        <h2 className="lost-bookmark-gate__title">一張遺落的書籤</h2>
        <p className="lost-bookmark-gate__desc">
          書架的縫隙裡，你發現了一張被遺忘的書籤——
          某位讀者曾在此駐足，如今換你翻開下一頁。
        </p>
        <button
          type="button"
          className="lost-bookmark-gate__open"
          onClick={handleOpen}
          disabled={awakening}
        >
          {awakening ? '書頁甦醒中……' : '翻開它 ▸'}
        </button>
      </div>
    </section>
  );
}
