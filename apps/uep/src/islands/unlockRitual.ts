/**
 * UEP 浮島系統 — 解鎖儀式的共通兩端（S9-B）
 *
 * 各 zone 的解鎖儀式視覺完全不同（history 的遺落書籤、concepts 的斷線終端、
 * echoes 的迷失灰球、visuals 的特別畫廊、storage 的孤零零紙條），但拆開來看
 * 都是同一條鏈：
 *
 *     資格 → 發現 → 儀式 → 收束
 *
 * 其中**資格**與**收束**四 zone 完全相同，差異全在中間兩段。所以這裡不做成
 * 一個包山包海的 `UnlockRitualGate` 元件（那會退化成一堆 props 開關——
 * storage 的「點十下漸變」與 echoes 的「機率常駐球」形狀差太多），而是只抽
 * 兩端：`useUnlockEligibility` 判資格、`completeUnlockRitual` 收束。
 * 中間的發現與儀式由各 zone 自己寫，只要求最後打進 `completeUnlockRitual`。
 */

import { useReaderAuth } from '../auth';
import { getProgressManager, useProgress } from '../progress';

import {
  canUseIslands,
  getIslandRuntime,
  hasVisitedZone,
  isIslandUnlocked,
  unlockIsland,
} from './islandRuntime';
import { ISLAND_DEFINITIONS } from './types';
import type { IslandId } from './types';
import { useDesktopIslandViewport } from './useIslands';

/** 甦醒動畫時長（ms）——與 CSS `uep-unlock-awaken` 等各 zone 儀式動畫對齊 */
export const AWAKEN_MS = 1400;

/** 解鎖資格的分解結果。消費端多半只用 `eligible`，但需要三態呈現的 zone
 *  （如 concepts 的 chip：已連線／已斷線／連字樣都不顯示）要拆開來看。 */
export interface UnlockEligibility {
  /** 浮島系統整體是否可用：桌面 + 已登入探索者 */
  canUse: boolean;
  /** 是否到訪過該 zone 的 Reader（`zone:visited:*`） */
  visited: boolean;
  /** 該島是否已解鎖 */
  unlocked: boolean;
  /** 儀式該不該出現 = 可用 + 已到訪 + 尚未解鎖 */
  eligible: boolean;
}

const NOT_AN_ISLAND: UnlockEligibility = {
  canUse: false,
  visited: false,
  unlocked: false,
  eligible: false,
};

/**
 * 解鎖儀式的資格判定。
 *
 * 封住兩個既有踩坑，消費端不必再各自記得：
 * 1. **auth 變化不保證觸發 progress notify**（logout 時 localStorage 鏡像為空
 *    就不 notify），所以要另外 `useReaderAuth()` 訂閱——見 islandRuntime.ts
 *    `canUseIslands` 的註解。
 * 2. **resize／裝置旋轉不會自己重渲染**，桌面判定會停在舊值，所以疊
 *    `useDesktopIslandViewport()`——見 useIslands.ts 的註解。
 *
 * ⚠️ 註記：`visited` 這關實質恆真——`zone:visited:*` 在 ReaderShell mount 時
 * 就授予，而 S9-B 的四條儀式全發生在 Reader 內部（concepts chip 在 landing、
 * echoes 在播放中、visuals 在 subcat、storage 在 boxes），使用者看得到儀式的
 * 那一刻旗必然已插上。保留它是為了語意清楚，以及 fallback 的
 * `IslandUnlockObject` 仍以它為浮現條件。
 */
export function useUnlockEligibility(zoneId: string): UnlockEligibility {
  const progress = useProgress();
  // 訂閱 auth 變化（回傳值不用，要的是變化時重渲染）
  useReaderAuth();
  const desktopViewport = useDesktopIslandViewport();

  const def = ISLAND_DEFINITIONS[zoneId as IslandId];
  if (!def) return NOT_AN_ISLAND;

  const canUse = desktopViewport && canUseIslands(progress);
  const visited = hasVisitedZone(progress, def.id);
  const unlocked = isIslandUnlocked(progress, def.id);

  return {
    canUse,
    visited,
    unlocked,
    eligible: canUse && visited && !unlocked,
  };
}

export interface UnlockRitualOptions {
  /**
   * 覆寫解鎖 toast 文案。傳 `null` 表示不顯示 toast——儀式自己已經有
   * 足夠的視覺回饋時（例如 concepts 的終端重新連線）可以關掉，免得重複報喜。
   */
  toast?: string | null;
  /** 解鎖後是否自動展開該浮島（預設 true） */
  open?: boolean;
}

/**
 * 儀式收束：解鎖 + 展開 + 報喜。回傳是否真的解鎖了。
 *
 * 四 zone 的儀式無論長什麼樣，最後都打進這裡。呼叫端負責在此之前播完
 * 自己的甦醒動畫（時長可用 `AWAKEN_MS`）。
 *
 * ⚠️ **完成時會重驗一次資格**（Codex 2026-07-25 review）。`useUnlockEligibility`
 * 只在渲染發現 UI 的那一刻判過，而發現與收束之間隔著對話框與 1.4 秒動畫——
 * 這段時間足夠使用者登出、切成觀測者、或把視窗縮到手機寬度（resize 甚至
 * 不會 unmount Reader，計時器照樣走完）。少了這道檢查，儀式會在已經沒有
 * 資格的情況下照樣寫進 progress 並彈出浮島。
 *
 * 呼叫端拿到 `false` 時該把 pending 的儀式 UI 收掉（該亮的狀態早已因
 * `eligible` 轉 false 而改變，不收就會留下一張點了沒反應的卡）。
 *
 * 重複呼叫是安全的（`unlockIsland` 走 progress store 的冪等寫入），但已解鎖
 * 時仍會再次展開視窗與報喜，所以儀式端該自己守門（多半靠 `eligible`）。
 */
export function completeUnlockRitual(
  zoneId: IslandId,
  opts: UnlockRitualOptions = {}
): boolean {
  const def = ISLAND_DEFINITIONS[zoneId];
  if (!def) return false;

  const progress = getProgressManager().getState();
  // canUseIslands 本身已含桌面視窗判定 + explorer + 已登入
  if (!canUseIslands(progress) || !hasVisitedZone(progress, def.id)) {
    return false;
  }

  unlockIsland(zoneId);
  if (opts.open !== false) {
    getIslandRuntime().open(zoneId);
  }

  const message =
    opts.toast === undefined
      ? `${def.title}甦醒了，加入了你的浮島。`
      : opts.toast;
  if (message) {
    window.__uepToastManager?.info(message);
  }
  return true;
}
