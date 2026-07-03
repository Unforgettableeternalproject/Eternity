/**
 * UEP 進度系統 — 掃描線 React hook（S2）
 *
 * createScanline 的薄包裝，處理 React 生命週期：
 * - contentKey（如 articleHtml）變更時整組重建——observer 綁的是
 *   建立當下的 DOM 快照，內容重渲染後舊快照即失效
 * - History 的滾動容器是內層 div（非 window），root 必須用 rootRef
 * - unmount / 換頁時 destroy 會 flush 未寫入的閱讀位置
 */

import { useEffect, useRef, type RefObject } from 'react';

import { createScanline, type MarkerPassedInfo } from './scanline';

export interface UseScanlineOptions {
  /** 目前頁面 id（null 表示不在文章頁，掃描線停用） */
  pageId: string | null;
  /** 文章內容容器（收集標記點的範圍） */
  containerRef: RefObject<HTMLElement | null>;
  /** 文末哨兵元素——由呼叫端渲染在文章結尾，通過即完成 */
  sentinelRef: RefObject<HTMLElement | null>;
  /** 滾動容器（IntersectionObserver root）；不給則用 viewport */
  rootRef?: RefObject<HTMLElement | null>;
  /** 內容識別鍵——變更時重建 observer（如 articleHtml） */
  contentKey?: unknown;
  /** 是否啟用（內容載入中應為 false） */
  enabled?: boolean;
  /** 標記點通過時的回呼（FlagMarker 旗標授予、完成判定掛這裡） */
  onMarkerPassed?: (info: MarkerPassedInfo) => void;
}

/**
 * 掃描線閱讀進度追蹤。
 * 回傳值無——進度一律寫入全域 progress store，消費端用 useProgress 讀。
 */
export function useScanline({
  pageId,
  containerRef,
  sentinelRef,
  rootRef,
  contentKey,
  enabled = true,
  onMarkerPassed,
}: UseScanlineOptions): void {
  // 回呼放 ref，避免呼叫端每次 render 產生新函式導致 observer 重建
  const onPassedRef = useRef(onMarkerPassed);
  onPassedRef.current = onMarkerPassed;

  useEffect(() => {
    if (!enabled || !pageId) return;
    const container = containerRef.current;
    const sentinel = sentinelRef.current;
    if (!container || !sentinel) return;

    const handle = createScanline({
      pageId,
      container,
      sentinel,
      root: rootRef?.current ?? null,
      onMarkerPassed: (info) => onPassedRef.current?.(info),
    });

    return () => handle.destroy();
    // ref 物件的 identity 穩定，不列入 deps；內容變更由 contentKey 驅動
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, contentKey, enabled]);
}
