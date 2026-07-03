/**
 * UEP 進度系統 — 掃描線核心（框架無關）
 *
 * 用 IntersectionObserver 觀察文章內的標記點（hr 自動標記 +
 * ProgressMarkerNode 手動標記 + 文末哨兵），追蹤閱讀進度：
 *
 * - maxMarkerIdx：曾到達的最遠標記點（單調遞增，進度判定）
 * - lastMarkerIdx：最近通過的標記點（「回到上次位置」）
 * - 文末哨兵永遠是最後一個索引，通過 = 頁面完成
 *
 * 掃描線位置：視窗高度 80% 處（rootMargin bottom -20%）——
 * 標記點頂端越過該線即視為「通過」。
 *
 * React 端請用 useScanline（本模組的薄包裝）；
 * 非 React 的 Astro script 可直接 createScanline / destroy。
 */

import { collectMarkers } from './markers';
import { getProgressManager } from './progressStore';

/** lastMarkerIdx 的寫入節流間隔（ms）——max 進度前進不受此限 */
const LAST_IDX_WRITE_DEBOUNCE = 800;

/** 標記點通過事件 */
export interface MarkerPassedInfo {
  /** 標記點索引（含哨兵，0-based） */
  index: number;
  /** 該標記授予的旗標（hr 與哨兵為空陣列） */
  grantsFlags: string[];
  /** 是否為文末哨兵（= 頁面完成點） */
  isSentinel: boolean;
  /** 標記點總數（含哨兵） */
  totalMarkers: number;
}

export interface ScanlineOptions {
  /** 目前頁面 id */
  pageId: string;
  /** 文章內容容器（收集標記點的範圍） */
  container: HTMLElement;
  /** 文末哨兵元素——渲染在文章結尾，通過即完成 */
  sentinel: HTMLElement;
  /** 滾動容器（IntersectionObserver root）；null 用 viewport */
  root?: HTMLElement | null;
  /** 標記點通過時的回呼（FlagMarker 旗標授予、完成判定掛這裡） */
  onMarkerPassed?: (info: MarkerPassedInfo) => void;
}

export interface ScanlineHandle {
  /** 停止觀察並 flush 未寫入的進度 */
  destroy(): void;
}

/**
 * 建立掃描線。內容重渲染後必須 destroy 舊實例並重建
 * （observer 綁的是建立當下的 DOM 快照）。
 */
export function createScanline(options: ScanlineOptions): ScanlineHandle {
  const { pageId, container, sentinel, root = null, onMarkerPassed } = options;

  if (typeof IntersectionObserver === 'undefined') {
    return { destroy() {} };
  }

  const store = getProgressManager();
  const markers = collectMarkers(container);
  // 標記點 + 文末哨兵，哨兵永遠是最後一個索引
  const totalMarkers = markers.length + 1;
  const sentinelIdx = totalMarkers - 1;

  const indexOf = new Map<Element, number>(markers.map((m) => [m.el, m.index]));
  indexOf.set(sentinel, sentinelIdx);

  // 以既有進度為基準（跨 session 續讀時不倒退）
  let maxIdx = store.getState().pageMarkers[pageId]?.maxMarkerIdx ?? -1;
  let lastIdx = -1;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  const write = () => {
    writeTimer = null;
    store.updatePageMarker(
      pageId,
      Math.max(maxIdx, 0),
      Math.max(lastIdx, 0),
      totalMarkers
    );
  };

  const scheduleWrite = (immediate: boolean) => {
    if (immediate) {
      if (writeTimer) clearTimeout(writeTimer);
      write();
      return;
    }
    if (writeTimer) return;
    writeTimer = setTimeout(write, LAST_IDX_WRITE_DEBOUNCE);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      let maxAdvanced = false;
      let anyPassed = false;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const idx = indexOf.get(entry.target);
        if (idx === undefined) continue;

        anyPassed = true;
        lastIdx = idx;
        if (idx > maxIdx) {
          maxIdx = idx;
          maxAdvanced = true;
        }

        onMarkerPassed?.({
          index: idx,
          grantsFlags: idx === sentinelIdx ? [] : markers[idx].grantsFlags,
          isSentinel: idx === sentinelIdx,
          totalMarkers,
        });
      }
      // max 進度前進立即寫入；單純位置變更節流寫入
      if (anyPassed) scheduleWrite(maxAdvanced);
    },
    {
      root,
      // 掃描線在視窗高度 80% 處
      rootMargin: '0px 0px -20% 0px',
      threshold: 0,
    }
  );

  markers.forEach((m) => observer.observe(m.el));
  observer.observe(sentinel);

  return {
    destroy() {
      observer.disconnect();
      // 離頁前 flush 未寫入的位置，避免掉最後的閱讀進度
      if (writeTimer) {
        clearTimeout(writeTimer);
        if (lastIdx >= 0) write();
      }
    },
  };
}
