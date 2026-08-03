/**
 * 使用者活動時間軸（S10-4 A 段）
 *
 * 全站唯一的「使用者有沒有在動」事實來源。兩個消費端：AFK 提示卡與
 * 閱讀時數統計（未來還有休息提醒），它們**必須共用同一條時間軸**——
 * 各自開一份計時器重算的話，同一段掛機時間會被兩套判定算出不同答案。
 *
 * ## 與內容保護的分工
 *
 * `scripts/content-protection.ts` 的 `setupVisibilityProtection()` 回答的是
 * 「這個頁面還在不在前景」；這裡回答的是它的補集——**頁面在前景、focus
 * 沒掉，但人沒有動作**。兩者定義域不重疊，所以不共用判定；但共用時間軸：
 * hidden／blur 時這裡必須一起停下（見 suspend()）。
 *
 * 兩邊不互相 import，各自對同一組瀏覽器事實反應即可。
 *
 * ## ⚠️ 高頻事件只寫模組變數
 *
 * `pointermove` 一秒可觸發數十次。每次 setState 等於把整棵 Reader 重渲染
 * 幾十次，所以事件 handler 只更新 `lastActivityAt`。真正的判定由 1 秒一次的
 * tick 做，且**只有跨越閾值的那一刻**才通知訂閱者。
 *
 * 唯一的例外是「從 idle 恢復」——那要即時，否則等下一個 tick 最多慢 1 秒，
 * 期間的活動會被算成掛機。但那是狀態轉換的單次事件，不是每次 pointermove，
 * 恢復之後後續事件一樣只寫變數。
 *
 * 📌 `idle` 只描述時間軸的事實。AFK 卡什麼時候收起來是 `ReaderNudge` 的
 * 閂鎖決定的（要按確認），這裡不管——離開 idle 不等於卡片消失。
 *
 * ## O(1) 的活躍時長
 *
 * 不保存活躍區間陣列——長時間開著的頁面會讓它無上限成長。改為維護已封存的
 * 累計值加上目前這一段的起點；消費端取兩次 `getActiveTotalMs()` 相減即可，
 * 不需要用 timestamp 反查歷史清單。
 */

import { getSetting, initUepSettings } from './uepSettings';

export interface ActivityState {
  /** 是否已超過閾值沒有任何動作 */
  idle: boolean;
  /** 進入 idle 的時刻；idle 為 false 時是 null */
  idleSince: number | null;
}

type Listener = (state: ActivityState) => void;

/** 判定週期。閾值最小值是 30 秒，1 秒的解析度綽綽有餘 */
const TICK_MS = 1000;

/** 設定未載入時的程式碼預設，與 worker 的 SETTING_DEFAULTS 對齊 */
const DEFAULT_IDLE_THRESHOLD_SEC = 180;

/**
 * 高頻活動事件。全部 passive——這些 handler 只寫一個數字，
 * 沒有任何 preventDefault 的需求，宣告 passive 讓瀏覽器不必等我們。
 */
const ACTIVITY_EVENTS = [
  'pointermove',
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
] as const;

const listeners = new Set<Listener>();

let started = false;
let startPromise: Promise<void> | null = null;

let thresholdMs = DEFAULT_IDLE_THRESHOLD_SEC * 1000;
let nudgeEnabled = true;

let lastActivityAt = 0;
let idle = false;
let idleSince: number | null = null;

/**
 * 對外的狀態快照。只在狀態真的改變時重建——`useSyncExternalStore` 用
 * `Object.is` 比對，每次呼叫都回新物件會讓它判定「一直在變」而無限重渲染。
 */
let snapshot: ActivityState = { idle: false, idleSince: null };

/** 已封存區間的累計毫秒 */
let sealedActiveMs = 0;
/** 目前活躍區間的起點；idle／hidden／blur 期間為 null */
let activeStartedAt: number | null = null;

let tickTimer: ReturnType<typeof setInterval> | null = null;

function notify(): void {
  snapshot = { idle, idleSince };
  for (const fn of listeners) fn(snapshot);
}

/**
 * 把目前這一段活躍時間結算進累計值。已封存時是 no-op（冪等）。
 *
 * ⚠️ `Math.max(0, ...)` 不是防禦性贅碼：tick 封存的是**最後一次活動的時刻**
 * 而不是現在，那個時刻可能早於這一段區間的起點（剛開始活躍就被判定閒置，
 * 例如 DevTools 的強制閒置）。少了這道 clamp，累計值會變成負數，接著
 * HistoryReader 算出的閱讀時數差值是負的，被 `addReadingTime` 的 `ms <= 0`
 * 靜默丟掉——症狀是閱讀時數莫名其妙不再累加。
 */
function sealInterval(now: number): void {
  if (activeStartedAt === null) return;
  sealedActiveMs += Math.max(0, now - activeStartedAt);
  activeStartedAt = null;
}

function startTick(): void {
  if (tickTimer !== null) return;
  tickTimer = setInterval(tick, TICK_MS);
}

function stopTick(): void {
  if (tickTimer === null) return;
  clearInterval(tickTimer);
  tickTimer = null;
}

function tick(): void {
  if (idle) return;
  const now = Date.now();
  if (now - lastActivityAt < thresholdMs) return;

  // 封存到「最後一次活動」而不是「現在」——閾值這段時間本來就是沒動作的，
  // 算進活躍時長等於每次掛機都白送使用者一個閾值的閱讀時數
  sealInterval(lastActivityAt);
  idle = true;
  idleSince = now;
  notify();
}

/**
 * 頁面離開前景：封存、停表、收掉 AFK 卡。
 *
 * 不做這件事的後果很具體：切出去十分鐘 → 內容保護遮罩接手 → 回來時遮罩
 * 正在跑還原動畫 → AFK 判定發現十分鐘沒動作 → 提示直接疊在還原動畫上。
 * 兩層遮罩打架，而且都是我們自己叫出來的。
 */
function suspend(): void {
  sealInterval(Date.now());
  stopTick();
  if (idle) {
    idle = false;
    idleSince = null;
    notify();
  }
}

/** 回到前景：時間軸從當下重新起算，不追認離開期間的「沒動作」 */
function resume(): void {
  const now = Date.now();
  lastActivityAt = now;
  if (activeStartedAt === null) activeStartedAt = now;
  if (idle) {
    idle = false;
    idleSince = null;
    notify();
  }
  startTick();
}

function onActivity(): void {
  lastActivityAt = Date.now();
  // 從 idle 恢復是狀態轉換，要即時通知；非 idle 時這裡就只是寫一個數字
  if (idle) resume();
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    suspend();
  } else if (document.hasFocus()) {
    resume();
  }
  // visible 但視窗沒 focus（切到別的應用程式）維持暫停，等 focus 事件
}

function onWindowBlur(): void {
  suspend();
}

function onWindowFocus(): void {
  // focus 事件先於 visibilitychange 抵達的情況存在——document 還是 hidden
  // 時恢復，等於在背景頁開始累計活躍時間
  if (document.visibilityState === 'hidden') return;
  resume();
}

function bindEvents(): void {
  for (const type of ACTIVITY_EVENTS) {
    window.addEventListener(type, onActivity, { passive: true });
  }
  // scroll 走 capture：捲動多半發生在 Reader 內層的可捲動容器上，
  // 不冒泡到 window
  window.addEventListener('scroll', onActivity, {
    passive: true,
    capture: true,
  });
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('focus', onWindowFocus);
}

function unbindEvents(): void {
  for (const type of ACTIVITY_EVENTS) {
    window.removeEventListener(type, onActivity);
  }
  window.removeEventListener('scroll', onActivity, { capture: true });
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('blur', onWindowBlur);
  window.removeEventListener('focus', onWindowFocus);
}

/**
 * 啟動監看。可重入——重複呼叫回同一個 Promise，不會重複掛 listener。
 *
 * 會先等 `initUepSettings()`（它自己是去重的）再鎖定本頁參數：設定首訪是
 * 非同步 fetch，mount 當下只讀一次的話第一頁永遠吃到 fallback。設定 fetch
 * 失敗時仍照常啟動，只是用程式碼預設值——AFK 探測不該因為設定 API 掛掉
 * 而整個不運作。
 */
export function startActivityWatch(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (startPromise) return startPromise;

  startPromise = (async () => {
    await initUepSettings();
    if (!startPromise) return; // 等待期間被 stop 了

    const sec = getSetting('reader.activityIdleThresholdSec', 180);
    thresholdMs = sec * 1000;
    // 顯式標註 string，否則泛型從 fallback 推成字面量 'enabled'，
    // 與 'disabled' 比較會被判為永遠不成立
    nudgeEnabled =
      getSetting<string>('reader.idleNudgeMode', 'enabled') !== 'disabled';

    started = true;
    lastActivityAt = Date.now();
    bindEvents();

    // 分頁在背景時開的頁面不該從一開始就累計活躍時間
    if (document.visibilityState !== 'hidden' && document.hasFocus()) {
      activeStartedAt = lastActivityAt;
      startTick();
    }
  })();

  return startPromise;
}

/** 停止監看並歸零所有狀態。訂閱者不清——訂閱與生命週期是兩件事 */
export function stopActivityWatch(): void {
  if (typeof window === 'undefined') return;
  if (started) unbindEvents();
  stopTick();
  started = false;
  startPromise = null;
  idle = false;
  idleSince = null;
  snapshot = { idle: false, idleSince: null };
  sealedActiveMs = 0;
  activeStartedAt = null;
  lastActivityAt = 0;
  thresholdMs = DEFAULT_IDLE_THRESHOLD_SEC * 1000;
  nudgeEnabled = true;
}

export function subscribeActivity(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getActivityState(): ActivityState {
  return snapshot;
}

/**
 * 累計活躍毫秒（單調遞增）。消費端在開始時取一個快照，結束時用新值相減
 * 即得「這段期間真正有在動的時間」。
 */
export function getActiveTotalMs(): number {
  if (activeStartedAt === null) return sealedActiveMs;
  return sealedActiveMs + (Date.now() - activeStartedAt);
}

/**
 * 手動登記一次活動。給「使用者明確表態自己還在」的 UI 用——AFK 卡的
 * 確認鈕若是用鍵盤按下的，window 上不會有任何 pointer 事件，時間軸不知道
 * 剛才發生過什麼，下一個 tick 就會把卡片再叫回來。
 *
 * 走與真實事件完全相同的路徑（`onActivity`），沒有旁路。
 */
export function noteActivity(): void {
  if (!started) return;
  onActivity();
}

/**
 * AFK 提示是否要顯示。刻意與閾值分離——關掉提示不該關掉量測，
 * 否則閱讀時數與休息提醒會一起失去排除掛機的依據。
 */
export function isIdleNudgeEnabled(): boolean {
  return nudgeEnabled;
}

/**
 * 立刻判定為閒置（DevTools 手動驗收用）。
 *
 * 預設閾值是 180 秒，真的坐著等三分鐘才能看到 AFK 卡出現一次，而這個提示
 * 需要驗的是視覺與確認流程，不是計時準不準。
 *
 * 走的是正規路徑——把最後活動時間推到閾值之外再跑一次判定，所以封存、
 * 通知、恢復條件全部與真實閒置一致，不是直接把旗標設成 true。
 */
export function forceIdleNow(): void {
  if (!started) return;
  lastActivityAt = Date.now() - thresholdMs - 1;
  tick();
}

/** DevTools 面板顯示用的即時狀態 */
export function getActivityDebug(): {
  started: boolean;
  idle: boolean;
  thresholdSec: number;
  nudgeEnabled: boolean;
  activeTotalMs: number;
  msSinceActivity: number;
  suspended: boolean;
} {
  return {
    started,
    idle,
    thresholdSec: Math.round(thresholdMs / 1000),
    nudgeEnabled,
    activeTotalMs: getActiveTotalMs(),
    msSinceActivity: lastActivityAt ? Date.now() - lastActivityAt : 0,
    // 區間沒開著又不是 idle = 被 hidden／blur 暫停了
    suspended: started && activeStartedAt === null && !idle,
  };
}
