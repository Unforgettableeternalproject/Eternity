/**
 * UEP 浮島系統 — 當前位置感知（S9 便條島 + 釘選層共用）
 *
 * 便條島 header 要標「當前所在 zone + 頁面」；釘選層要依 pathname 過濾
 * 「該顯示在這頁」的釘選便條。兩者共用同一份感知：
 *  - `pathname` 當前 URL path
 *  - `zone` 從 pathname 第一段推斷（history/echoes/concepts/visuals/storage 或 null）
 *  - `pageLabel` 讀 document.title（各 Reader / astro layout 已負責更新）
 *
 * 訂閱來源：`popstate`（瀏覽器返回 / useZoneRouter pushState）
 * + 我們主動包一層 pushState/replaceState monkey patch 派事件——
 * pushState 本身不觸發 popstate，各 Reader 內部換頁我們也需要感知。
 * monkey patch 只掛一次（module-level flag），跨 island 共用單例。
 *
 * SSR 安全：所有 window 存取都有防禦；SSR 回傳空值，client 掛載後補齊。
 */

import { useEffect, useState } from 'react';

const ZONE_IDS = new Set([
  'history',
  'echoes',
  'concepts',
  'visuals',
  'storage',
]);

/** zone id → 人性化中文名（沿用各 astro 頁 DesignLayout 的 title 前綴） */
export const ZONE_LABELS: Record<string, string> = {
  history: '歷史典藏庫',
  echoes: '回音蒐藏間',
  concepts: '概念調整房',
  visuals: '幻影重現室',
  storage: '某人的置物空間',
};

const LOCATION_CHANGE_EVENT = 'uep:location-change';

/** 從 pathname 抽 zone（第一段落）；不是浮島 zone 回 null */
export function extractZone(pathname: string): string | null {
  if (!pathname) return null;
  const first = pathname.split('/').filter(Boolean)[0];
  return first && ZONE_IDS.has(first) ? first : null;
}

/** pushState / replaceState monkey patch：派 uep:location-change 事件 */
let patched = false;
function patchHistoryOnce() {
  if (patched || typeof window === 'undefined') return;
  patched = true;
  const dispatch = () =>
    window.dispatchEvent(new CustomEvent(LOCATION_CHANGE_EVENT));
  const origPush = window.history.pushState.bind(window.history);
  const origReplace = window.history.replaceState.bind(window.history);
  window.history.pushState = function (
    ...args: Parameters<typeof origPush>
  ): void {
    origPush(...args);
    dispatch();
  };
  window.history.replaceState = function (
    ...args: Parameters<typeof origReplace>
  ): void {
    origReplace(...args);
    dispatch();
  };
}

export interface CurrentLocation {
  /** location.pathname；SSR 期間為空字串 */
  pathname: string;
  /**
   * location.search（含前導 `?`；無 query 則 `''`）；SSR 期間為空字串。
   * S9-A Codex #1：各 Reader 用 query string 切子頁，pinned 過濾必須聯合比對。
   */
  search: string;
  /** 當前所在 zone（history/echoes/concepts/visuals/storage），不在浮島 zone 時 null */
  zone: string | null;
  /** document.title 當前值；SSR 期間為空字串 */
  pageLabel: string;
}

function snapshot(): CurrentLocation {
  if (typeof window === 'undefined') {
    return { pathname: '', search: '', zone: null, pageLabel: '' };
  }
  const pathname = window.location.pathname;
  return {
    pathname,
    search: window.location.search || '',
    zone: extractZone(pathname),
    pageLabel: document.title || '',
  };
}

/**
 * 訂閱當前位置——popstate + 本模組派的 uep:location-change 事件都會觸發重讀。
 * document.title 變更沒有標準事件，若各 Reader 邊看邊改 title 這裡不會即時更新
 * ——目前所有 Reader 換頁時 title 已由 astro layout / Reader 早期 effect 設定完成，
 * 之後不會再變，實務上夠用。真的需要細粒度可另建 MutationObserver 監聽 <title>。
 */
export function useCurrentLocation(): CurrentLocation {
  const [loc, setLoc] = useState<CurrentLocation>(() => snapshot());

  useEffect(() => {
    patchHistoryOnce();
    // mount 後補一次快照（SSR 初值可能不準）
    setLoc(snapshot());
    const onChange = () => setLoc(snapshot());
    window.addEventListener('popstate', onChange);
    window.addEventListener(LOCATION_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener(LOCATION_CHANGE_EVENT, onChange);
    };
  }, []);

  return loc;
}
