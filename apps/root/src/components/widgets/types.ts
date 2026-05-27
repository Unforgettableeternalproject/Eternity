/**
 * Widget 系統的共用型別定義
 */

/** SSR 端注入到 window 的 widget 資料 */
export interface WidgetData {
  /** 訪客計數器 API URL */
  visitorApiUrl: string;
  /** 今日名言 */
  quote: { text: string; author: string } | null;
  /** 快速統計 */
  stats: {
    projects: number;
    updates: number;
    active: number;
    completed: number;
  } | null;
  /** 最新更新 */
  latestUpdate: {
    id: string;
    titleZh: string;
    titleEn: string;
    date: string;
  } | null;
  /** 各 widget 的啟用狀態（來自 D1 cards） */
  cardEnabled: {
    music: boolean;
    visitor: boolean;
    quote: boolean;
    stats: boolean;
    latest: boolean;
    toc: boolean;
  };
  /** 目前語系 */
  locale: 'zh-tw' | 'en';
  /** 音樂播放器的音軌列表（如果有的話） */
  musicTracks?: { name: string; src: string }[];
}

/** 擴充 window 型別 */
declare global {
  interface Window {
    __widgetData?: WidgetData;
  }
}

/** 取得 widget 資料（SSR 端注入的） */
export function getWidgetData(): WidgetData {
  if (typeof window !== 'undefined' && window.__widgetData) {
    return window.__widgetData;
  }
  // Fallback 預設值
  return {
    visitorApiUrl: 'https://eternity-visitor-counter.ptyc4076.workers.dev',
    quote: null,
    stats: null,
    latestUpdate: null,
    cardEnabled: {
      music: true,
      visitor: true,
      quote: true,
      stats: true,
      latest: true,
      toc: true,
    },
    locale: 'zh-tw',
  };
}
