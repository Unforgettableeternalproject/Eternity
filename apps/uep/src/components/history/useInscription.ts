/**
 * useInscription — rush prevention 的視覺層 v2（S10-2）：刻印顯影
 *
 * 「霧遮住字」改為「字尚未寫上」：刻印線（fogRatio）以下的內容區塊以
 * 淡墨痕呈現——認得出有內容、讀不出字；刻印線掃過時區塊播「顯影＋
 * 琥珀微光」動畫，如同正被書寫進卷軸。切合 History 的書卷主題。
 *
 * 邊界邏輯完全不動——fogRatio 的推進、防 rush 閘門、完成判定都在原處，
 * 這裡只消費 ratio 做視覺。事件遮蔽也不歸這裡管（HistoryFogOverlay 的
 * 透明事件盾 + HistoryReader 的 focusin 攔截），墨痕上的
 * pointer-events:none 只是多一層保險。
 *
 * 直接操作 DOM class 而非 React state：
 * - 內容主體是 dangerouslySetInnerHTML 產出的非受控 DOM，React 不會碰
 *   它們的 className
 * - 穿插的 React 元件（UepDialogue、音訊播放器等）className prop 恆定，
 *   reconciliation 不重寫，手動加的 class 同樣安全
 * - 顯影一次可能掃過多個區塊，走 React state 會整棵重渲染
 *
 * ⚠️ decorateInteractiveHtml 的輸出隨 progress 變動（entity 啟用屬性），
 * __html 字串一變 React 就重設 innerHTML，掛在區塊上的 class 全部蒸發，
 * 而且不一定伴隨 fogRatio 變化。所以掛 MutationObserver 盯 childList，
 * DOM 被換掉就重套狀態（只認 prose 容器層級的變動——音訊播放器等元件
 * 內部的頻繁更新不觸發重套）。
 */

/* global ResizeObserver */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { computeContentRatio, computeElementRatio } from '../../progress';

/** 未刻印區塊的淡墨痕樣式 */
export const UNWRITTEN_CLASS = 'history-unwritten';
/** 顯影動畫進行中 */
export const INSCRIBING_CLASS = 'history-inscribing';
/** 已顯影標記——顯影是單向的，版面位移不會把讀者看過的內容再藏回去 */
const INSCRIBED_ATTR = 'data-inscribed';

/** 一次顯影多個區塊時的接續間隔（ms）——依序浮現才有書寫的節奏 */
const INSCRIBE_STAGGER_MS = 90;
const INSCRIBE_STAGGER_MAX_MS = 450;

/**
 * 這些是容器不是區塊本體，往內收集子元素。
 *
 * ⚠️ 漏列容器的症狀是「整段內容瞬間全顯影」：walker 會把它當單一區塊，
 * 而它的頂端在刻印線之上，一比對就整包放行。文章外層的
 * `section.history-reading` 就踩過這個坑，所以 section 一律視為容器
 * （TipTap 內容不會產出 section，不會誤穿透真正的內容區塊）。
 */
const CONTAINER_SELECTOR = 'section, .history-article, .history-prose';
/** 不參與顯影的元素（哨兵無形體；事件盾自己管自己） */
const SKIP_SELECTOR = '.history-scan-sentinel, .history-fog';

interface UseInscriptionOptions {
  /** false = 這頁不適用（非進度頁／儀式頁／內容未就緒），清掉所有狀態 */
  enabled: boolean;
  /** 刻印線位置（0~1）；1 = 全部顯影 */
  fogRatio: number;
  /** 捲動容器——位置換算的座標系 */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** 常規流內容的包裹層（.history-page-transition）——收集區塊的根 */
  flowRef: React.RefObject<HTMLElement | null>;
  /** 文章內容容器（無 class 的 contentRef div），walker 需要指名穿透 */
  contentRef: React.RefObject<HTMLElement | null>;
  /** 內容識別鍵，變更時重建狀態 */
  contentKey?: unknown;
}

/** 收集顯影區塊：容器往內走，其餘元素即為一個顯影單位 */
function collectBlocks(
  root: HTMLElement,
  contentEl: HTMLElement | null
): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (el: HTMLElement) => {
    for (const child of Array.from(el.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.matches(SKIP_SELECTOR)) continue;
      if (child === contentEl || child.matches(CONTAINER_SELECTOR)) {
        walk(child);
        continue;
      }
      out.push(child);
    }
  };
  walk(root);
  return out;
}

export function useInscription({
  enabled,
  fogRatio,
  scrollRef,
  flowRef,
  contentRef,
  contentKey,
}: UseInscriptionOptions): void {
  const fogRatioRef = useRef(fogRatio);
  fogRatioRef.current = fogRatio;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const applyRef = useRef<(animate: boolean) => void>(() => {});
  applyRef.current = (animate: boolean) => {
    const scroller = scrollRef.current;
    const flow = flowRef.current;
    if (!scroller || !flow) return;
    const blocks = collectBlocks(flow, contentRef.current);
    if (!enabledRef.current) {
      // 不適用：把殘留狀態清乾淨（例如從進度頁導航到非進度頁時，
      // React 重用了部分 DOM）
      for (const el of blocks) {
        el.classList.remove(UNWRITTEN_CLASS, INSCRIBING_CLASS);
        el.removeAttribute(INSCRIBED_ATTR);
      }
      return;
    }
    // 首拍下限與 HistoryFogOverlay 同一套：store 尚無這頁的值時，
    // 以首屏線為準——第一屏依契約本來就可讀
    const floor = computeContentRatio(
      0,
      scroller.clientHeight,
      scroller.scrollHeight
    );
    const effective = Math.max(
      Math.max(0, fogRatioRef.current),
      Math.min(floor, 1)
    );
    let staggerIndex = 0;
    for (const el of blocks) {
      if (el.hasAttribute(INSCRIBED_ATTR)) continue;
      // 比區塊「底緣」不比頂端：頂端過線就顯影會讓身體仍壓在刻印線
      // 之下的段落提前現形，完全越線才算寫完
      const topRatio = computeElementRatio(el, scroller);
      const bottomRatio =
        scroller.scrollHeight > 0
          ? topRatio + el.getBoundingClientRect().height / scroller.scrollHeight
          : topRatio;
      if (bottomRatio <= effective) {
        el.setAttribute(INSCRIBED_ATTR, '1');
        const wasHidden = el.classList.contains(UNWRITTEN_CLASS);
        el.classList.remove(UNWRITTEN_CLASS);
        // 只有「墨痕 → 顯影」的轉換播動畫；初始套用（進頁時刻印線
        // 已在此區塊之下）直接可讀，避免每次進頁整篇閃一輪光
        if (animate && wasHidden) {
          el.style.animationDelay = `${Math.min(
            staggerIndex * INSCRIBE_STAGGER_MS,
            INSCRIBE_STAGGER_MAX_MS
          )}ms`;
          staggerIndex += 1;
          el.classList.add(INSCRIBING_CLASS);
          el.addEventListener(
            'animationend',
            () => {
              el.classList.remove(INSCRIBING_CLASS);
              el.style.animationDelay = '';
            },
            { once: true }
          );
        }
      } else {
        el.classList.add(UNWRITTEN_CLASS);
      }
    }
  };

  // 初始套用走 layout effect：要在首次繪製前把未達進度的區塊藏好，
  // 否則會先閃一幀完整內容
  useLayoutEffect(() => {
    applyRef.current(false);
  }, [contentKey, enabled]);

  // 刻印線推進 → 顯影新掃過的區塊
  useEffect(() => {
    applyRef.current(true);
  }, [fogRatio]);

  // 版面高度變動（圖片載入、時間軸掛載）→ 區塊 ratio 位移，重新評估。
  // DOM 被 React 重設（見檔頭說明）→ 重套狀態，不播動畫
  useEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyRef.current(false);
      });
    };
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(schedule)
        : null;
    resizeObserver?.observe(flow);
    const mutationObserver =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              const target = mutation.target;
              if (!(target instanceof HTMLElement)) continue;
              // 只認 prose 容器／內容容器層級的抽換——元件內部
              // （音訊播放器進度條等）的高頻更新不觸發重套
              if (
                target === contentRef.current ||
                target === flow ||
                target.matches(CONTAINER_SELECTOR)
              ) {
                schedule();
                return;
              }
            }
          })
        : null;
    mutationObserver?.observe(flow, { childList: true, subtree: true });
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [contentKey, flowRef, contentRef]);
}
