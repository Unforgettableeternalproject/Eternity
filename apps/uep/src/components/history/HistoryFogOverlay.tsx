/**
 * HistoryFogOverlay — rush prevention 的視覺層（S10-2）
 *
 * 迷霧線以下的內容被遮住，讀者只看得到段落的輪廓、認不出是什麼字。
 * 遮罩掛在捲動容器內、**隨內容一起捲動**（不是釘在視窗上）——它遮的是
 * 「內容從某個位置開始還沒解鎖」，不是「畫面下半部」。
 *
 * 分兩層是效能考量：
 * - 活躍帶：迷霧線起算約 1.5 個視窗高，套 backdrop-filter + 動畫
 * - 遠場：活躍帶以下到文末，純色塊，無濾鏡無動畫。文章再長，這一層
 *   的渲染成本都是固定的
 *
 * 捲動中由 body class 降級成靜態（見 HistoryReader 的捲動 effect）——
 * 快速捲動時有沒有動畫看不出差別，沒必要付那個代價。
 */

/* global ResizeObserver */
import { useEffect, useState } from 'react';

/** 捲動中降級的 body class（開關由 HistoryReader 的捲動 effect 負責） */
export const FOG_SCROLLING_CLASS = 'uep-fog-scrolling';

interface HistoryFogOverlayProps {
  /** 迷霧線位置（0~1）；>= 1 代表已散盡，呼叫端不該再渲染本元件 */
  ratio: number;
  /** 捲動容器——量 scrollHeight 用 */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** 內容識別鍵，變更時重新量測（圖片載入撐高版面也要跟著修正） */
  contentKey?: unknown;
}

export default function HistoryFogOverlay({
  ratio,
  scrollRef,
  contentKey,
}: HistoryFogOverlayProps) {
  const [scrollHeight, setScrollHeight] = useState(0);

  // 版面高度會隨圖片非同步載入變動，ratio 對應的絕對位置要跟著修正。
  // ResizeObserver 觀察捲動容器的內容尺寸變化即可，不必輪詢。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setScrollHeight(el.scrollHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [contentKey, scrollRef]);

  if (scrollHeight <= 0 || ratio >= 1) return null;

  return (
    <div
      className="history-fog"
      style={{
        top: `${Math.max(0, ratio) * scrollHeight}px`,
        height: `${Math.max(0, (1 - ratio) * scrollHeight)}px`,
      }}
      aria-hidden="true"
    >
      <div className="history-fog__active" />
      <div className="history-fog__far" />
    </div>
  );
}
