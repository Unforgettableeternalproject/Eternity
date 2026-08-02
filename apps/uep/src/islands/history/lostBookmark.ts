/**
 * 「遺落的書籤」— History 浮島的解鎖儀式（S6-2，艾斯維爾 07/06 定案）
 *
 * 取代 S6 的通用解鎖小物件：書籤以「導航樹特殊條目」的形式
 * 出現在最後閱讀頁所在章節的縫隙，點擊進入儀式頁、翻開後解鎖旅程之書。
 *
 * 機率規則：
 * - 每次「首次讀完一篇」（page-completed 信號）roll 一次
 * - 基礎機率由站台設定 `bookmark.baseChancePct` 決定（預設 20%），每次沒中
 *   加碼 `bookmark.stepChancePct`（預設 +20%），直到 100% 必定出現
 * - 出現後若被忽視（導航到其他頁面），條目消失且遞增歸零
 * - 解鎖後永遠不再出現（條件掛在 islandsUnlocked，不需獨立旗標）
 *
 * 底線條件：探索者視角 + 到過 History Reader + 旅程之書未解鎖。
 */

import { isTestMode } from '../../lib/apiBase';
import type { ProgressState } from '../../progress';
import {
  LOST_BOOKMARK_BASE_PCT,
  LOST_BOOKMARK_MISS_HARD_MAX,
  LOST_BOOKMARK_STEP_PCT,
  getProgressManager,
} from '../../progress';
import { getSetting } from '../../lib/uepSettings';

import { canUseIslands, isIslandUnlocked } from '../islandRuntime';

export { LOST_BOOKMARK_STEP_PCT };

/** 每次沒中的加碼幅度（%）——站台設定優先，未載入時退回常數 */
export function lostBookmarkStepPct(): number {
  return Math.max(
    0,
    getSetting('bookmark.stepChancePct', LOST_BOOKMARK_STEP_PCT)
  );
}

/**
 * 這一輪的實際出現機率（%）。
 *
 * 基礎值與加碼幅度每次都現讀站台設定——持久狀態只記「沒中幾次」，所以
 * 調整設定對所有讀者的下一次 roll 立即生效（含從沒 roll 過的新讀者）。
 */
export function lostBookmarkChancePct(state: ProgressState): number {
  const base = getSetting('bookmark.baseChancePct', LOST_BOOKMARK_BASE_PCT);
  return Math.min(
    100,
    Math.max(0, base) + state.lostBookmark.missCount * lostBookmarkStepPct()
  );
}

/**
 * 在現行設定下，累到必中所需的沒中次數。
 *
 * 加碼幅度為 0 時 pity 不存在（機率恆為基礎值），此時回硬上限——DevTools
 * 的 `guarantee()` 至少不會因為除以 0 而算出 Infinity。
 */
export function lostBookmarkMaxMiss(): number {
  const base = getSetting('bookmark.baseChancePct', LOST_BOOKMARK_BASE_PCT);
  const step = lostBookmarkStepPct();
  if (step <= 0) return LOST_BOOKMARK_MISS_HARD_MAX;
  return Math.min(
    LOST_BOOKMARK_MISS_HARD_MAX,
    Math.ceil((100 - Math.max(0, base)) / step)
  );
}

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
 * - 沒中：missCount 遞增（下一輪機率跟著往上）
 * @param random 注入亂數供測試（預設 Math.random）
 */
export function rollLostBookmark(
  state: ProgressState,
  random: () => number = Math.random
): 'shown' | 'missed' | 'skipped' {
  if (!isLostBookmarkEligible(state) || state.lostBookmark.visible) {
    return 'skipped';
  }
  if (random() * 100 < lostBookmarkChancePct(state)) {
    getProgressManager().updateLostBookmark({ visible: true });
    return 'shown';
  }
  getProgressManager().updateLostBookmark({
    missCount: state.lostBookmark.missCount + 1,
  });
  return 'missed';
}

/**
 * 忽視懲罰：條目浮現時導航到其他頁面 → 條目消失、機率重置。
 * 條目未浮現時為 no-op（不會誤重置遞增中的機率）。
 */
export function dismissLostBookmark(state: ProgressState): void {
  if (!state.lostBookmark.visible) return;
  // 遞增歸零即回到基礎機率——基礎值本身是 roll 當下才讀的站台設定
  getProgressManager().updateLostBookmark({ visible: false, missCount: 0 });
}

/** 解鎖完成：條目永久消失（visible 落回 false，島解鎖由呼叫端執行） */
export function settleLostBookmark(): void {
  getProgressManager().updateLostBookmark({ visible: false });
}

/* ── 測試 hook（S6-3，dev only）──
 * 機率制很難手動驗收（基礎機率起跳、沒中才遞增、忽視重置），沿用
 * OnboardingGate 的 window bridge 前例，在 dev 提供 console 直接操作的入口。 */

/** 儀式頁開啟事件：bridge 的 openGate 廣播，HistoryReader 監聽切狀態 */
export const LOST_BOOKMARK_OPEN_GATE_EVENT = 'uep:lost-bookmark:open-gate';

interface LostBookmarkTestBridge {
  /** 直接讓書籤條目浮現（不經 roll；底線條件仍需成立才會渲染） */
  force(): void;
  /** 重置回初始狀態（條目消失、機率回基礎值） */
  reset(): void;
  /** 機率拉滿 100%——下次 page-completed 必中 */
  guarantee(): void;
  /** 立刻 roll 一次（等同讀完一篇的信號），回傳結果 */
  roll(): 'shown' | 'missed' | 'skipped';
  /** 直接開啟儀式頁（需在 /history Reader 內才有人消費事件） */
  openGate(): void;
  /** 查看目前狀態 */
  status(): {
    /** 下一次 roll 的實際機率（基礎設定 + 已累積的遞增） */
    chancePct: number;
    /** 已經沒中的次數 */
    missCount: number;
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
        missCount: 0,
      });
    },
    guarantee() {
      // 依現行的基礎值與加碼幅度算出必中所需次數（兩者都可調）
      getProgressManager().updateLostBookmark({
        missCount: lostBookmarkMaxMiss(),
      });
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
        chancePct: lostBookmarkChancePct(state),
        missCount: state.lostBookmark.missCount,
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
