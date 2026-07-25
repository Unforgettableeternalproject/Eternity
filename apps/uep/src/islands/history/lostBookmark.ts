/**
 * 「遺落的書籤」— History 浮島的解鎖儀式（S6-2，艾斯維爾 07/06 定案）
 *
 * 取代 S6 的通用解鎖小物件：書籤以「導航樹特殊條目」的形式
 * 出現在最後閱讀頁所在章節的縫隙，點擊進入儀式頁、翻開後解鎖旅程之書。
 *
 * 機率規則：
 * - 每次「首次讀完一篇」（page-completed 信號）roll 一次
 * - 初始 20%，每次沒中 +20%，直到 100% 必定出現
 * - 出現後若被忽視（導航到其他頁面），條目消失且機率重置回 20%
 * - 解鎖後永遠不再出現（條件掛在 islandsUnlocked，不需獨立旗標）
 *
 * 底線條件：探索者視角 + 到過 History Reader + 旅程之書未解鎖。
 */

import { isTestMode } from '../../lib/apiBase';
import type { ProgressState } from '../../progress';
import { LOST_BOOKMARK_BASE_PCT, getProgressManager } from '../../progress';

import { canUseIslands, isIslandUnlocked } from '../islandRuntime';

/** 每次沒中的機率遞增步長（%） */
export const LOST_BOOKMARK_STEP_PCT = 20;

/**
 * 底線條件：探索者 + 島未解鎖。
 *
 * 2026-07-26 移除「到過 History」這一關——roll 的觸發信號是
 * page-completed，只有在 History Reader 裡讀完一篇才會發生，人必然
 * 已經在 zone 內，條件恆真。詳見 `unlockRitual.ts` 的說明。
 */
export function isLostBookmarkEligible(state: ProgressState): boolean {
  return canUseIslands(state) && !isIslandUnlocked(state, 'history');
}

/** 條目是否應該渲染在導航樹（底線條件 + 已 roll 中） */
export function isLostBookmarkVisible(state: ProgressState): boolean {
  return isLostBookmarkEligible(state) && state.lostBookmark.visible;
}

/**
 * 讀完一篇時 roll 一次（page-completed 信號的消費端呼叫）。
 * - 不符底線條件或條目已浮現：不動作
 * - 中了：visible=true（條目浮現）
 * - 沒中：chancePct 遞增
 * @param random 注入亂數供測試（預設 Math.random）
 */
export function rollLostBookmark(
  state: ProgressState,
  random: () => number = Math.random
): 'shown' | 'missed' | 'skipped' {
  if (!isLostBookmarkEligible(state) || state.lostBookmark.visible) {
    return 'skipped';
  }
  if (random() * 100 < state.lostBookmark.chancePct) {
    getProgressManager().updateLostBookmark({ visible: true });
    return 'shown';
  }
  getProgressManager().updateLostBookmark({
    chancePct: Math.min(
      100,
      state.lostBookmark.chancePct + LOST_BOOKMARK_STEP_PCT
    ),
  });
  return 'missed';
}

/**
 * 忽視懲罰：條目浮現時導航到其他頁面 → 條目消失、機率重置。
 * 條目未浮現時為 no-op（不會誤重置遞增中的機率）。
 */
export function dismissLostBookmark(state: ProgressState): void {
  if (!state.lostBookmark.visible) return;
  getProgressManager().updateLostBookmark({
    visible: false,
    chancePct: LOST_BOOKMARK_BASE_PCT,
  });
}

/** 解鎖完成：條目永久消失（visible 落回 false，島解鎖由呼叫端執行） */
export function settleLostBookmark(): void {
  getProgressManager().updateLostBookmark({ visible: false });
}

/* ── 測試 hook（S6-3，dev only）──
 * 機率制很難手動驗收（20% 起跳、忽視重置），沿用 OnboardingGate 的
 * window bridge 前例，在 dev 提供 console 直接操作的入口。 */

/** 儀式頁開啟事件：bridge 的 openGate 廣播，HistoryReader 監聽切狀態 */
export const LOST_BOOKMARK_OPEN_GATE_EVENT = 'uep:lost-bookmark:open-gate';

interface LostBookmarkTestBridge {
  /** 直接讓書籤條目浮現（不經 roll；底線條件仍需成立才會渲染） */
  force(): void;
  /** 重置回初始狀態（條目消失、機率回 20%） */
  reset(): void;
  /** 機率拉滿 100%——下次 page-completed 必中 */
  guarantee(): void;
  /** 立刻 roll 一次（等同讀完一篇的信號），回傳結果 */
  roll(): 'shown' | 'missed' | 'skipped';
  /** 直接開啟儀式頁（需在 /history Reader 內才有人消費事件） */
  openGate(): void;
  /** 查看目前狀態 */
  status(): {
    chancePct: number;
    visible: boolean;
    eligible: boolean;
  };
}

declare global {
  interface Window {
    __uepLostBookmarkTest?: LostBookmarkTestBridge;
  }
}

/**
 * 掛上 dev 測試 bridge，回傳 cleanup。
 *
 * 掛載條件（Issue #41 起放寬）：DEV 或 isTestMode() 兩者其一。
 * production + prod worker 下 no-op（tree-shake）。
 */
export function mountLostBookmarkTestBridge(): () => void {
  if (!import.meta.env.DEV && !isTestMode()) return () => {};
  const bridge: LostBookmarkTestBridge = {
    force() {
      getProgressManager().updateLostBookmark({ visible: true });
    },
    reset() {
      getProgressManager().updateLostBookmark({
        visible: false,
        chancePct: LOST_BOOKMARK_BASE_PCT,
      });
    },
    guarantee() {
      getProgressManager().updateLostBookmark({ chancePct: 100 });
    },
    roll() {
      return rollLostBookmark(getProgressManager().getState());
    },
    openGate() {
      window.dispatchEvent(new CustomEvent(LOST_BOOKMARK_OPEN_GATE_EVENT));
    },
    status() {
      const state = getProgressManager().getState();
      return {
        chancePct: state.lostBookmark.chancePct,
        visible: state.lostBookmark.visible,
        eligible: isLostBookmarkEligible(state),
      };
    },
  };
  window.__uepLostBookmarkTest = bridge;
  return () => {
    if (window.__uepLostBookmarkTest === bridge) {
      delete window.__uepLostBookmarkTest;
    }
  };
}
