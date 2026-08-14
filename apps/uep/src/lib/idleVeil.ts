/**
 * 閒置帷幕（S10-4 A 段，2026-08-04 取代 AFK 提示卡）
 *
 * 掛機時從畫面四周漫入帶靜電的霧，越久越濃；要驅散它得**真的動**——
 * 而且拖得越久要動得越多。全遮時中央浮現「空曠~」。
 *
 * ## 為什麼不是一張提示卡
 *
 * 這裡的前身是一張置中的 modal（`ReaderNudge` 的 AFK 卡，08/03 才從
 * 「動一下就消失」改成「按確認才消失」）。艾斯維爾與測試者的判斷是：
 * 掛機這件事不需要一個要人按掉的視窗，讓畫面自己被空曠佔滿、再由使用者
 * 動手撥開，比按一顆按鈕更貼近那個狀態本身。
 *
 * 於是回到最初「動一下就是答案」的精神，但補上它當初真正缺的東西——
 * **回饋**：舊設計的問題不是要求的動作太少，而是使用者完全看不出自己
 * 做了什麼、還差多少。
 *
 * ## 三個階段（艾斯維爾定，2026-08-04）
 *
 * 從 activityWatch 判定閒置那一刻起算：
 *
 * | 進入 | 帷幕 | 驅散所需的活動量 |
 * | --- | --- | --- |
 * | 20s  | 邊緣起霧 | 80px（動一下就好） |
 * | 60s  | 逼近中央 | 400px（要劃一段） |
 * | 120s | 全遮 + 「空曠~」 | 1200px（要繞幾圈） |
 *
 * ⚠️ 這是**接在 `reader.activityIdleThresholdSec`（預設 180 秒）之後**
 * 的計時，不是取代它。所以預設情境下全遮發生在停手 5 分鐘。
 *
 * ## 帷幕的生命週期與 activityWatch 的 idle 是兩件事
 *
 * `activityWatch` 的 `idle` 只描述時間軸事實，使用者動一下就會變 false。
 * 帷幕**自己閂住**：一旦升起，就只有累積夠活動量才會散——這正是
 * 「拖越久越難散」能成立的前提（半調子的動作累積 dispel 但不重置 stage，
 * 於是霧繼續變濃、門檻繼續變高）。
 *
 * 驅散完成時呼叫 `noteActivity()` 把時間軸一併重設，兩邊回到同一個起點。
 *
 * ## 高頻事件只寫模組變數
 *
 * 與 `activityWatch` 同一個理由：`pointermove` 一秒數十次，每次 setState
 * 等於把整棵 Reader 重渲染幾十次。移動距離只累加到模組變數，統一由 250ms
 * 的 tick 通知訂閱者；視覺的平滑由 CSS transition 負責，不靠更新頻率。
 */

import { noteActivity, subscribeActivity } from './activityWatch';
import { getSetting } from './uepSettings';

export type VeilStage = 0 | 1 | 2 | 3;

export interface VeilState {
  /** 0 = 沒有帷幕；1／2／3 見檔頭的階段表 */
  stage: VeilStage;
  /** 帷幕濃度 0..1（已扣除驅散進度），渲染端直接拿來當強度用 */
  coverage: number;
  /** 本階段的驅散進度 0..1，達 1 即散去 */
  dispel: number;
}

type Listener = (state: VeilState) => void;

/** 各階段的進入時刻（秒，從判定閒置起算） */
const STAGE_AT_SEC = [20, 60, 120] as const;

/**
 * 各階段的帷幕濃度上限。刻意不是線性到 1——階段一、二要看得出「有東西
 * 在漫過來」但仍讀得到字，全遮是階段三專屬的狀態。
 */
const STAGE_COVERAGE = [0, 0.34, 0.7, 1] as const;

/** 各階段要驅散所需的等效移動距離（px） */
const STAGE_DISPEL_PX = [0, 80, 400, 1200] as const;

/**
 * 非指標類活動的等效距離。只用鍵盤或滾輪的人也要驅散得掉——
 * 沒有這一條，把滑鼠放在一邊用鍵盤閱讀的使用者會被永遠關在霧裡。
 */
const KEY_EQUIV_PX = 40;

/** 判定週期。CSS transition 會把 250ms 的階梯補成連續變化 */
const TICK_MS = 250;

/**
 * 擦開的軌跡要留幾個點。
 *
 * 原本只有「指標當下的位置」一個洞，於是移開之後霧就在原地補回來——
 * 使用者划了一大圈，看到的卻是一顆洞跟著滑鼠跑，撥開的地方沒有留下痕跡。
 * 記住最近幾個取樣點，讓走過的路一起被扣掉。
 *
 * ⚠️ 這個數字直接決定 CSS 那邊的 mask 層數（`--ivl-hole` 展開成
 * 1 + TRAIL_MAX 個 radial-gradient，再乘上四個套用它的圖層），加大要連
 * `IdleVeil.css` 的清單一起改，而且要留意合成成本。
 */
export const TRAIL_MAX = 8;

/**
 * 取樣間距（px）。比洞的基礎半徑（90px）小一些，相鄰兩個洞才會咬合成
 * 一條通道而不是一串分開的圓點。
 */
const TRAIL_GAP_PX = 56;

const listeners = new Set<Listener>();

const IDLE: VeilState = { stage: 0, coverage: 0, dispel: 0 };

let snapshot: VeilState = IDLE;
let started = false;

/** 帷幕升起的時刻；0 代表目前沒有帷幕 */
let raisedAt = 0;
/** 時間軸凍結的起點（頁面離開前景）；0 代表沒在凍結 */
let frozenAt = 0;
/** 本次帷幕累積的等效移動距離 */
let movedPx = 0;
let lastPointer: { x: number; y: number } | null = null;
/** 已擦開的軌跡取樣點（最舊在前），本次帷幕內累積 */
let trail: { x: number; y: number }[] = [];

let tickTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeActivity: (() => void) | null = null;

/**
 * 驅散累積是否暫停。
 *
 * DevTools 面板開著時為 true：驗收帷幕必須用滑鼠去按面板上的按鈕，那些
 * 位移會被算成驅散——等於一叫出來就被自己的操作撥掉，根本看不到效果。
 *
 * **只停驅散，不停階段推進**：時間照走，才能觀察霧自然變濃。
 */
let dispelPaused = false;

function notify(next: VeilState): void {
  // useSyncExternalStore 用 Object.is 比對，值沒變就不要換物件，
  // 否則它會判定「一直在變」而無限重渲染
  if (
    next.stage === snapshot.stage &&
    next.coverage === snapshot.coverage &&
    next.dispel === snapshot.dispel
  ) {
    return;
  }
  snapshot = next;
  for (const fn of listeners) fn(snapshot);
}

function stageFor(elapsedSec: number): VeilStage {
  if (elapsedSec >= STAGE_AT_SEC[2]) return 3;
  if (elapsedSec >= STAGE_AT_SEC[1]) return 2;
  if (elapsedSec >= STAGE_AT_SEC[0]) return 1;
  return 0;
}

/**
 * 階段之間線性補間，讓霧是「漫過來」而不是每 40 秒跳一格。
 * 階段一之前（剛判定閒置的前 20 秒）維持 0——那段時間畫面要乾淨。
 */
function coverageFor(elapsedSec: number): number {
  const stage = stageFor(elapsedSec);
  if (stage === 0) return 0;
  if (stage === 3) return STAGE_COVERAGE[3];
  const from = STAGE_AT_SEC[stage - 1];
  const to = STAGE_AT_SEC[stage];
  const t = (elapsedSec - from) / (to - from);
  return (
    STAGE_COVERAGE[stage] +
    (STAGE_COVERAGE[stage + 1] - STAGE_COVERAGE[stage]) * t
  );
}

/**
 * 頁面離開前景：凍結帷幕的時間軸。
 *
 * 階段是用 `Date.now() - raisedAt` 推的，那是牆鐘——切出去一小時再回來，
 * 第一次 tick 就會算出 3600 秒而直接跳到全遮，還得劃 1200px 才撥得開。
 * 契約是背景不計掛機（S10-4 §2-3），所以停表，回來時把這段還回去。
 *
 * 帷幕還沒升起時不必凍：背景期間 activityWatch 停表、不會判定閒置，
 * 也就不會有人叫 raise()。
 */
function freezeVeil(): void {
  if (raisedAt === 0 || frozenAt !== 0) return;
  frozenAt = Date.now();
  stopTick();
}

/** 回到前景：把背景停留的時間補回起點，帷幕從離開時的濃度接著長 */
function thawVeil(): void {
  if (frozenAt === 0) return;
  raisedAt += Date.now() - frozenAt;
  frozenAt = 0;
  // 回來時指標多半已經在別的位置，留著舊座標會讓第一次 pointermove
  // 算出一整段沒有發生過的位移（同 setDispelPaused 的理由）
  lastPointer = null;
  if (raisedAt !== 0) startTick();
}

/** 收掉帷幕並把時間軸一併重設 */
function clearVeil(): void {
  raisedAt = 0;
  frozenAt = 0;
  movedPx = 0;
  lastPointer = null;
  trail = [];
  unbindDispelEvents();
  stopTick();
  notify(IDLE);
  noteActivity();
}

function tick(): void {
  if (raisedAt === 0) return;
  const elapsedSec = (Date.now() - raisedAt) / 1000;
  const stage = stageFor(elapsedSec);
  const need = STAGE_DISPEL_PX[stage];
  const dispel = need > 0 ? Math.min(1, movedPx / need) : 0;

  if (dispel >= 1) {
    clearVeil();
    return;
  }

  notify({
    stage,
    // 驅散進度直接扣在濃度上——使用者要能看到自己撥開了多少，
    // 這正是舊版「動一下就消失」缺的那個回饋
    coverage: coverageFor(elapsedSec) * (1 - dispel),
    dispel,
  });
}

function onPointerMove(event: PointerEvent): void {
  if (dispelPaused) return;
  const prev = lastPointer;
  lastPointer = { x: event.clientX, y: event.clientY };

  /*
   * 依「距離」取樣而不是每次 pointermove 都記：一秒數十次的事件在慢速移動
   * 時會擠出一整排幾乎重疊的點，額度瞬間用完，反而讓軌跡變短。
   */
  const tail = trail[trail.length - 1];
  if (
    !tail ||
    Math.hypot(event.clientX - tail.x, event.clientY - tail.y) >= TRAIL_GAP_PX
  ) {
    trail.push({ x: event.clientX, y: event.clientY });
    if (trail.length > TRAIL_MAX) trail.shift();
  }

  if (!prev) return;
  movedPx += Math.hypot(event.clientX - prev.x, event.clientY - prev.y);
}

function onDiscreteActivity(): void {
  if (dispelPaused) return;
  movedPx += KEY_EQUIV_PX;
}

function bindDispelEvents(): void {
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('keydown', onDiscreteActivity, { passive: true });
  window.addEventListener('wheel', onDiscreteActivity, { passive: true });
  window.addEventListener('pointerdown', onDiscreteActivity, { passive: true });
  window.addEventListener('touchmove', onDiscreteActivity, { passive: true });
}

function unbindDispelEvents(): void {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('keydown', onDiscreteActivity);
  window.removeEventListener('wheel', onDiscreteActivity);
  window.removeEventListener('pointerdown', onDiscreteActivity);
  window.removeEventListener('touchmove', onDiscreteActivity);
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

/** 升起帷幕。已經升起時是 no-op——重複進 idle 不會重置階段 */
function raise(): void {
  if (raisedAt !== 0) return;
  raisedAt = Date.now();
  movedPx = 0;
  lastPointer = null;
  // 新的一次帷幕從全遮開始，上一次擦開的痕跡不留到這一次
  trail = [];
  bindDispelEvents();
  startTick();
}

/**
 * 啟動監看。可重入。
 *
 * 只訂閱 `activityWatch` 的 idle 轉換，不自己判定閒置——閒置的定義只能有
 * 一份，兩套判定會在同一段掛機時間上得出不同答案。
 */
export function startIdleVeil(): void {
  if (typeof window === 'undefined' || started) return;
  started = true;
  unsubscribeActivity = subscribeActivity((activity) => {
    // `reader.idleNudgeMode = disabled` 只關 UI，不關量測——所以是在這裡
    // 擋，不是在 activityWatch 擋
    if (getSetting<string>('reader.idleNudgeMode', 'enabled') === 'disabled') {
      return;
    }
    if (activity.suspended) {
      freezeVeil();
      return;
    }
    thawVeil();
    if (activity.idle) raise();
    // 離開 idle 不收帷幕：那是使用者「動了一下」，收不收由累積的活動量決定
  });
}

/** 停止並歸零。訂閱者不清——訂閱與生命週期是兩件事 */
export function stopIdleVeil(): void {
  if (typeof window === 'undefined') return;
  unsubscribeActivity?.();
  unsubscribeActivity = null;
  unbindDispelEvents();
  stopTick();
  started = false;
  raisedAt = 0;
  frozenAt = 0;
  movedPx = 0;
  lastPointer = null;
  trail = [];
  dispelPaused = false;
  snapshot = IDLE;
}

export function subscribeVeil(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getVeilState(): VeilState {
  return snapshot;
}

/**
 * 即時的驅散比例，不等 tick。
 *
 * 訂閱者拿到的 `dispel` 是 250ms 更新一次的——對「跟著指標擦開霧」這種要貼著
 * 手感的效果太慢。渲染端用 rAF 直接拉這個值，不經過 React state。
 */
export function getLiveDispel(): number {
  if (raisedAt === 0) return 0;
  const need = STAGE_DISPEL_PX[snapshot.stage];
  return need > 0 ? Math.min(1, movedPx / need) : 0;
}

/**
 * 最後一次記錄到的指標位置（viewport 座標），沒有就回 null。
 *
 * 給「以指標為中心擦開一個洞」用。暫停期間不更新——面板開著時本來就不該
 * 有擦拭效果。
 */
export function getDispelPointer(): { x: number; y: number } | null {
  return lastPointer;
}

/**
 * 已擦開的軌跡取樣點（最舊在前，最多 `TRAIL_MAX` 個）。
 *
 * ⚠️ 刻意不在頁面回到前景（`thawVeil`）或面板關閉時清空——那些情境下
 * 使用者先前確實把那幾塊擦開過了，清掉等於霧在他沒看的時候長回來。
 * 只有「帷幕整個收掉」與「新的一次升起」才重來。
 */
export function getDispelTrail(): { x: number; y: number }[] {
  return trail;
}

/** SSR 快照：伺服器端沒有掛機可言 */
export function getVeilServerState(): VeilState {
  return IDLE;
}

/**
 * 暫停／恢復驅散累積（DevTools 面板開關時呼叫）。
 *
 * 恢復時清掉 `lastPointer`：暫停期間指標多半已經移到面板上，留著那個舊座標
 * 會讓恢復後的第一次 pointermove 算出一整段「從面板回到內容」的距離，
 * 使用者什麼都還沒做就先被記了一筆。
 */
export function setDispelPaused(paused: boolean): void {
  dispelPaused = paused;
  if (!paused) lastPointer = null;
}

/**
 * 直接跳到指定階段（DevTools 手動驗收用）。
 *
 * 走的是正規路徑——把帷幕的起始時刻往回推到該階段的門檻，之後的生長、
 * 驅散門檻、tick 判定全部與真實掛機一致，不是把 stage 設成某個數字。
 */
export function forceVeilStage(stage: 1 | 2 | 3): void {
  if (typeof window === 'undefined') return;
  raise();
  raisedAt = Date.now() - STAGE_AT_SEC[stage - 1] * 1000 - 100;
  movedPx = 0;
  tick();
}

/** DevTools 面板顯示用 */
export function getVeilDebug(): VeilState & {
  started: boolean;
  elapsedSec: number;
  movedPx: number;
  needPx: number;
  dispelPaused: boolean;
  frozen: boolean;
} {
  // 凍結期間時間軸停在離開前景那一刻，顯示的經過秒數也該停住
  const now = frozenAt !== 0 ? frozenAt : Date.now();
  const elapsedSec = raisedAt === 0 ? 0 : (now - raisedAt) / 1000;
  return {
    ...snapshot,
    started,
    elapsedSec: Math.round(elapsedSec),
    movedPx: Math.round(movedPx),
    needPx: STAGE_DISPEL_PX[snapshot.stage],
    dispelPaused,
    frozen: frozenAt !== 0,
  };
}
