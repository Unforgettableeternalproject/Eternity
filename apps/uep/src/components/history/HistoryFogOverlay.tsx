/**
 * HistoryFogOverlay — rush prevention 的事件盾（S10-2）
 *
 * 視覺 v2（刻印顯影）之後，遮蔽的呈現交給 useInscription 的淡墨痕——
 * 本元件不再畫霧，只負責兩件事：
 *
 * 1. **事件盾**：刻印線以下吃掉指標事件。視覺遮蔽（認不出字）不等於
 *    「事件視為不存在」，entity 嵌入與內部連結若還能點，防護就只是
 *    裝飾。鍵盤焦點另由 HistoryReader 的 focusin 攔截處理。
 * 2. **刻印線**：邊界上唯一的可見元素——一條琥珀色的微光細線，標出
 *    「顯影到這裡」。推進時隨補間滑動（量化級距的離散跳步不能直接
 *    瞬移，見 CSS transition 的說明）。
 *
 * 遮罩掛在捲動容器內、隨內容一起捲動——它遮的是「內容從某個位置開始
 * 還沒解鎖」，不是「畫面下半部」。
 */

/* global ResizeObserver */
import { useCallback, useEffect, useState } from 'react';
import { computeContentRatio } from '../../progress';

/** 捲動中的 body class（開關由 HistoryReader 的捲動 effect 負責）。
 *  視覺 v2 之後暫無 CSS 消費端，保留機制供之後的降級需求。 */
export const FOG_SCROLLING_CLASS = 'uep-fog-scrolling';

interface HistoryFogOverlayProps {
  /** 刻印線位置（0~1）；>= 1 代表全部顯影，呼叫端不該再渲染本元件 */
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

  /**
   * 內容高度一律量 flow，**不讀捲動容器的 scrollHeight**。
   *
   * 本元件是捲動容器的 absolute 子元素，而 absolute 後代會計入容器的
   * scrollable overflow——`el.scrollHeight` 因此包含遮罩自己。遮罩底邊
   * 又剛好等於量到的 scrollHeight（top + height 的定義），於是只要有一次
   * 擾動讓底邊超過內容底邊（700ms 補間的中間幀、或補間期間內容被時間軸／
   * 導航／圖片撐高），下一次量測就會讀到被自己撐大的值，據此算出更長的
   * 遮罩，再撐大一點——正回饋，追不回來。
   *
   * 症狀有三：文末出現捲不完的空白、迷霧線永遠追不到底、
   * 以及 ratio 分母持續變大導致掃描線的位置閘門擋掉所有標記。
   * ratio 到 1 時本元件 return null，空白才會突然消失（「過一陣子就好」）。
   *
   * flow 涵蓋文章、時間軸、導航與文末哨兵，又不含本元件——量它既完整
   * 又不會量到自己。ResizeObserver 早就是觀察 flow（原意即為避開迴圈），
   * 這裡把同一個道理補到取值端。
   */
  const readMetrics = useCallback(() => {
    const el = scrollRef.current;
    const flow = flowRef.current;
    if (!el) return;
    const contentHeight = flow ? flow.scrollHeight : el.scrollHeight;
    setMetrics((prev) =>
      prev.scrollHeight === contentHeight &&
      prev.clientHeight === el.clientHeight
        ? prev
        : { scrollHeight: contentHeight, clientHeight: el.clientHeight }
    );
  }, [scrollRef, flowRef]);

  // 版面高度會隨圖片非同步載入變動，ratio 對應的絕對位置要跟著修正。
  useEffect(() => {
    const flow = flowRef.current;
    readMetrics();
    if (typeof ResizeObserver === 'undefined' || !flow) return;
    const observer = new ResizeObserver(readMetrics);
    observer.observe(flow);
    return () => observer.disconnect();
  }, [contentKey, flowRef, readMetrics]);

  // 時間軸／導航等內容之後才載入時量到的高度會過期，事件盾就會短一截
  // 讓文末互動漏出來——捲動當下順手校正，比對擋住無變化的 setState
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        readMetrics();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, readMetrics]);

  const { scrollHeight, clientHeight } = metrics;
  /**
   * 渲染位置的首屏線下限。
   *
   * 進頁第一拍 store 還沒有這頁的 fogRatio，`?? 0` 的預設值會讓刻印線
   * 出現在內容最頂端，等首次取樣寫入後才滑到首屏線。第一屏依契約本來
   * 就可讀（見 sampleFog 首次取樣不限速的說明），首拍直接定位在首屏線；
   * 公式與取樣器同一套，首次取樣寫入的就是同一個值。
   */
  const floorRatio =
    scrollHeight > 0 ? computeContentRatio(0, clientHeight, scrollHeight) : 0;
  const renderRatio = Math.max(Math.max(0, ratio), Math.min(floorRatio, 1));
  const overlayTop = renderRatio * scrollHeight;
  const overlayHeight = Math.max(0, (1 - renderRatio) * scrollHeight);

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
    />
  );
}
