/**
 * HistoryFogOverlay — rush prevention 的視覺層（S10-2）
 *
 * 迷霧線以下的內容被遮住，讀者只看得到段落的輪廓、認不出是什麼字。
 * 遮罩掛在捲動容器內、**隨內容一起捲動**（不是釘在視窗上）——它遮的是
 * 「內容從某個位置開始還沒解鎖」，不是「畫面下半部」。
 *
 * 邊界與渲染是兩件事，分開追蹤：
 * - 迷霧「邊界」跟著迷霧線（fogRatio）走——它是進度語意
 * - 迷霧「視覺」跟著讀者視窗走——雲絮動畫帶只需要蓋住讀者看得到的那一段。
 *   讀者 rush 到迷霧深處時它要跟過去；若把它錨在迷霧線上，超過它高度的
 *   快速捲動就會讓讀者看見底下沒有霧體質感的純色遠場
 *
 * 三層結構，成本都與文章長度無關：
 * - 底幕：柔邊以下到文末的不透明色幕。**遮蔽的保證在這裡**，柔邊與雲絮
 *   只是妝面——無論捲多快、捲多深，領地內永遠不會露出內容
 * - 柔邊：迷霧線起算 60vh 的漸層 + backdrop-filter，只有邊界需要
 *   「看得到輪廓但認不出字」的過渡
 * - 雲絮帶：130vh 動畫帶，以 transform 追蹤讀者視窗。不進 React state——
 *   捲動每幀重渲染付不起，直接寫 DOM
 *
 * 捲動中由 body class 降級成靜態（見 HistoryReader 的捲動 effect）——
 * 快速捲動時有沒有動畫看不出差別，沒必要付那個代價。
 */

/* global ResizeObserver */
import { useEffect, useRef, useState } from 'react';
import { computeContentRatio } from '../../progress';

/** 捲動中降級的 body class（開關由 HistoryReader 的捲動 effect 負責） */
export const FOG_SCROLLING_CLASS = 'uep-fog-scrolling';

interface HistoryFogOverlayProps {
  /** 迷霧線位置（0~1）；>= 1 代表已散盡，呼叫端不該再渲染本元件 */
  ratio: number;
  /** 捲動容器——量 scrollHeight 用 */
  scrollRef: React.RefObject<HTMLElement | null>;
  /**
   * 常規流內容的包裹層——量測**觸發源**。
   *
   * ⚠️ 不能觀察捲動容器本身，因為本元件也是它的子元素：遮罩高度隨 ratio
   * 變動 → 觸發 measure → setState → 重新渲染 → 尺寸再變……每一幀都在
   * 跑回授迴圈。包裹層涵蓋文章、時間軸與導航（它們都會在載入後把容器
   * 撐高），又不包含本元件——觀察它才既完整又不迴圈。
   */
  flowRef: React.RefObject<HTMLElement | null>;
  /** 內容識別鍵，變更時重新量測（圖片載入撐高版面也要跟著修正） */
  contentKey?: unknown;
}

export default function HistoryFogOverlay({
  ratio,
  scrollRef,
  flowRef,
  contentKey,
}: HistoryFogOverlayProps) {
  const [metrics, setMetrics] = useState({ scrollHeight: 0, clientHeight: 0 });
  const wispsRef = useRef<HTMLDivElement>(null);

  // 版面高度會隨圖片非同步載入變動，ratio 對應的絕對位置要跟著修正。
  useEffect(() => {
    const el = scrollRef.current;
    const flow = flowRef.current;
    if (!el) return;
    const measure = () =>
      setMetrics((prev) =>
        prev.scrollHeight === el.scrollHeight &&
        prev.clientHeight === el.clientHeight
          ? prev
          : { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
      );
    measure();
    if (typeof ResizeObserver === 'undefined' || !flow) return;
    const observer = new ResizeObserver(measure);
    observer.observe(flow);
    return () => observer.disconnect();
  }, [contentKey, scrollRef, flowRef]);

  const { scrollHeight, clientHeight } = metrics;
  /**
   * 渲染位置的首屏線下限。
   *
   * 進頁第一拍 store 還沒有這頁的 fogRatio，`?? 0` 的預設值會讓遮罩從
   * 內容最頂端蓋下來，等首次取樣寫入後才退到首屏線——「蓋滿再退開」的
   * 閃爍就是這樣來的。第一屏依契約本來就可讀（見 sampleFog 首次取樣
   * 不限速的說明），首拍直接定位在首屏線；公式與取樣器同一套，首次
   * 取樣寫入的就是同一個值，不會產生視覺與閘門的落差。
   */
  const floorRatio =
    scrollHeight > 0 ? computeContentRatio(0, clientHeight, scrollHeight) : 0;
  const renderRatio = Math.max(Math.max(0, ratio), Math.min(floorRatio, 1));
  const overlayTop = renderRatio * scrollHeight;
  const overlayHeight = Math.max(0, (1 - renderRatio) * scrollHeight);

  // 雲絮帶追蹤讀者視窗：把帶子置中在視窗上，clamp 進迷霧領地。
  // 迷霧線推進（overlayTop 變動）時也要重算——帶子的座標系是領地內部，
  // 領地自己會動。
  useEffect(() => {
    const el = scrollRef.current;
    const band = wispsRef.current;
    if (!el || !band || overlayHeight <= 0) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      // 時間軸／導航等內容之後才載入時 scrollHeight 會過期，捲動當下
      // 順手校正——比對擋住無變化的 setState，不會形成迴圈
      setMetrics((prev) =>
        prev.scrollHeight === el.scrollHeight &&
        prev.clientHeight === el.clientHeight
          ? prev
          : { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
      );
      const bandHeight = band.offsetHeight;
      const margin = Math.max((bandHeight - el.clientHeight) / 2, 0);
      const local = el.scrollTop - margin - overlayTop;
      const maxLocal = Math.max(overlayHeight - bandHeight, 0);
      const clamped = Math.min(Math.max(local, 0), maxLocal);
      band.style.transform = `translate3d(0, ${clamped}px, 0)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, overlayTop, overlayHeight]);

  // 短文豁免的判準與 fogGate.isNonScrollable 一致——eligibility 只有
  // 一套，overlay 不能自己長一份寬鬆版
  if (scrollHeight <= 0 || ratio >= 1) return null;
  if (scrollHeight <= clientHeight + 1) return null;

  return (
    <div
      className="history-fog"
      style={{
        top: `${overlayTop}px`,
        height: `${overlayHeight}px`,
      }}
      aria-hidden="true"
    >
      <div className="history-fog__body" />
      <div className="history-fog__edge" />
      <div className="history-fog__wisps" ref={wispsRef} />
    </div>
  );
}
