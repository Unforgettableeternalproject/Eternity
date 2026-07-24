/**
 * UEP 浮島系統 — 當前位置感知（S9 便條島 + 釘選層共用）
 *
 * 便條島 header 要標「當前所在 zone + 頁面」；釘選層要依 pathname 過濾
 * 「該顯示在這頁」的釘選便條。兩者共用同一份感知：
 *  - `pathname` 當前 URL path
 *  - `zone` 從 pathname 第一段推斷（history/echoes/concepts/visuals/storage 或 null）
 *  - `pageLabel` / `pageTrail` 讀 pageContext（Reader 路由解析後發佈；
 *    艾斯維爾 07/24 定案：不可從 document.title 倒推——各 zone layout 只
 *    給主層 title，倒推永遠指不出實際文章）。無 Reader 發佈時退
 *    document.title（admin / 非 Reader 頁）。
 *
 * 訂閱來源：`popstate`（瀏覽器返回 / useZoneRouter pushState）
 * + 我們主動包一層 pushState/replaceState monkey patch 派事件
 * + `uep:page-context-change`（Reader fetch 完成後才知道子頁標題，
 *   沒有伴隨任何導航事件）。
 * monkey patch 只掛一次（module-level flag），跨 island 共用單例。
 *
 * SSR 安全：所有 window 存取都有防禦；SSR 回傳空值，client 掛載後補齊。
 */

import { useEffect, useState } from 'react';

import {
  PAGE_CONTEXT_CHANGE_EVENT,
  getPageContext,
} from '../utils/pageContext';

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
  /**
   * 當前子頁標籤——pageContext（Reader 路由解析發佈）優先，
   * 無發佈時退 document.title（zone 主層 / 非 Reader 頁）；SSR 期間空字串
   */
  pageLabel: string;
  /** 祖先鏈標題（history 的 chapter/arc 等）；無發佈時空陣列 */
  pageTrail: string[];
}

function snapshot(): CurrentLocation {
  if (typeof window === 'undefined') {
    return { pathname: '', search: '', zone: null, pageLabel: '', pageTrail: [] };
  }
  const pathname = window.location.pathname;
  const ctx = getPageContext();
  return {
    pathname,
    search: window.location.search || '',
    zone: extractZone(pathname),
    pageLabel: ctx.label ?? document.title ?? '',
    pageTrail: ctx.trail,
  };
}

/**
 * 訂閱當前位置——popstate、本模組派的 uep:location-change、以及
 * uep:page-context-change（Reader fetch 完成後發佈子頁標題）都觸發重讀。
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
    window.addEventListener(PAGE_CONTEXT_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener(LOCATION_CHANGE_EVENT, onChange);
      window.removeEventListener(PAGE_CONTEXT_CHANGE_EVENT, onChange);
    };
  }, []);

  return loc;
}
