/**
 * UEP 進度系統 — 掃描線診斷通道（框架無關）
 *
 * 只為了回答一個問題：**掃描線在某台裝置上為什麼不動**。
 *
 * 掃描線不動有四條互斥的可能路徑，而它們的症狀在畫面上完全一樣
 * （進度不推進、旗標不授予、讀到底也不完成），無法靠肉眼分辨：
 *
 *   1. IntersectionObserver 根本沒回呼（root 尺寸／rootMargin 落點問題）
 *   2. 有回呼但被慣性捲動的節流吃掉
 *   3. 標記元素零面積，引擎不回報 isIntersecting
 *   4. 回呼正常、標記也命中，但被迷霧位置閘門 passesFogGate 全數擋下
 *
 * 這個模組把四條路徑各自的中間值暴露出來，交給畫面上的 HUD 呈現。
 *
 * ⚠️ **預設完全關閉，且關閉時必須是零成本。** 發布端一律先問
 * `isDiagEnabled()` 再組資料——快照裡有 getBoundingClientRect 這種
 * 會觸發 layout 的呼叫，掛在 IntersectionObserver 回呼裡無條件跑
 * 等於自己製造一個效能問題來觀測效能問題。
 */

/** 啟用旗標：網址參數（手機上最好開）或 localStorage（跨頁保留） */
const HUD_QUERY_KEY = 'scanline-hud';
const HUD_STORAGE_KEY = 'uep-scanline-hud';

/** 單一標記點的即時狀態 */
export interface ScanlineDiagMarker {
  index: number;
  role: string;
  /** 相對於滾動容器可視區頂端的位置（px） */
  top: number;
  /** 元素高度——零面積策略是否成立看這裡 */
  height: number;
  /** 最近一次 IntersectionObserver 回報的交集狀態 */
  intersecting: boolean;
  /** 是否曾經被回報過（從未回報 = 假設 1／3 的證據） */
  everReported: boolean;
  /** 最近一次是否通過迷霧位置閘門（假設 4 的證據） */
  passedFogGate: boolean | null;
}

export interface ScanlineDiagSnapshot {
  pageId: string | null;
  /** 內容標記總數（不含哨兵） */
  totalMarkers: number;
  maxIdx: number;
  lastIdx: number;
  /** 掃描線是否認定這頁適用迷霧 */
  fogEnabled: boolean;
  /** 滾動容器量測 */
  root: {
    clientHeight: number;
    scrollHeight: number;
    scrollTop: number;
  } | null;
  /** IntersectionObserver 自己回報的 root 高度——與上面對不上即為假設 1 */
  rootBoundsHeight: number | null;
  /** 最近一次 IO 回呼的時間戳（performance.now） */
  lastCallbackAt: number | null;
  /** 相鄰兩次 IO 回呼的間隔（ms）——慣性期間的空窗看這裡（假設 2） */
  lastCallbackGap: number | null;
  /** IO 回呼累計次數 */
  callbackCount: number;
  markers: ScanlineDiagMarker[];
  /** 哨兵狀態 */
  sentinel: { intersecting: boolean; everReported: boolean };
  /** 迷霧取樣的中間值（由 Reader 端發布，掃描線自己看不到這些） */
  fog: {
    applies: boolean;
    /** 已寫入紀錄的迷霧線 */
    ratio: number;
    /** 本頁的積分累計值 */
    accum: number;
    /** 讀者目前捲動位置換算的比例 */
    scrollRatio: number;
    /** 最近一次取樣是否過得了跳躍門檻——false 代表迷霧卡住（假設 4） */
    withinReach: boolean | null;
    /** 速率上限套用後的目標值；null = 被完全擋下 */
    limited: number | null;
    /** 取樣累計次數 */
    sampleCount: number;
  };
}

function emptySnapshot(): ScanlineDiagSnapshot {
  return {
    pageId: null,
    totalMarkers: 0,
    maxIdx: -1,
    lastIdx: -1,
    fogEnabled: false,
    root: null,
    rootBoundsHeight: null,
    lastCallbackAt: null,
    lastCallbackGap: null,
    callbackCount: 0,
    markers: [],
    sentinel: { intersecting: false, everReported: false },
    fog: {
      applies: false,
      ratio: 0,
      accum: 0,
      scrollRatio: 0,
      withinReach: null,
      limited: null,
      sampleCount: 0,
    },
  };
}

let snapshot: ScanlineDiagSnapshot = emptySnapshot();
const listeners = new Set<() => void>();

/**
 * 啟用狀態只在第一次查詢時解析一次。
 *
 * 不做成每次讀取都查 URL／localStorage：發布端會在 IntersectionObserver
 * 回呼與捲動 rAF 裡呼叫它，那是每秒數十次的路徑。
 */
let enabledCache: boolean | null = null;

export function isDiagEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  if (typeof window === 'undefined') {
    enabledCache = false;
    return false;
  }
  let on = false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(HUD_QUERY_KEY) === '1') {
      on = true;
      /* 網址開一次就記住，之後在站內導航（History 是 client-side 換頁，
         query 會被 Reader 自己的 ?page= 覆寫）不必重新帶參數 */
      try {
        window.localStorage.setItem(HUD_STORAGE_KEY, 'true');
      } catch {
        /* 無痕模式寫不進去；本次載入仍然有效 */
      }
    } else if (params.get(HUD_QUERY_KEY) === '0') {
      on = false;
      try {
        window.localStorage.removeItem(HUD_STORAGE_KEY);
      } catch {
        /* 同上 */
      }
      enabledCache = false;
      return false;
    } else {
      on = window.localStorage.getItem(HUD_STORAGE_KEY) === 'true';
    }
  } catch {
    on = false;
  }
  enabledCache = on;
  return on;
}

/** 測試與 DevTools 用：重新解析啟用狀態 */
export function resetDiagEnabledCache(): void {
  enabledCache = null;
}

export function getDiagSnapshot(): ScanlineDiagSnapshot {
  return snapshot;
}

export function subscribeDiag(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 發布局部更新。呼叫端必須自己先過 `isDiagEnabled()`——
 * 這裡再擋一次只是防呆，擋不掉呼叫端組資料的成本。
 */
export function publishDiag(patch: Partial<ScanlineDiagSnapshot>): void {
  if (!isDiagEnabled()) return;
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((fn) => fn());
}

/** 發布迷霧欄位（巢狀欄位單獨開一支，避免呼叫端每次都要展開整包） */
export function publishFogDiag(
  patch: Partial<ScanlineDiagSnapshot['fog']>
): void {
  if (!isDiagEnabled()) return;
  snapshot = { ...snapshot, fog: { ...snapshot.fog, ...patch } };
  listeners.forEach((fn) => fn());
}

/** 換頁時清空，避免上一頁的數值被誤讀成新頁的證據 */
export function resetDiag(pageId: string | null): void {
  if (!isDiagEnabled()) return;
  snapshot = { ...emptySnapshot(), pageId };
  listeners.forEach((fn) => fn());
}
