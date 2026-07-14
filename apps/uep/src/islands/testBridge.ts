/**
 * 浮島 dev 測試 bridge（S6-3 追加，艾斯維爾 07/06 提議）
 *
 * 手動驗收浮島解鎖鏈的痛點：解鎖狀態、zone 足跡旗標都埋在 ProgressState
 * 裡，沒有反向操作入口——解鎖過就再也測不到解鎖儀式。這裡在 dev 提供
 * `window.__uepIslandsTest` 讓 console 直接操控。
 *
 * 與 `__uepLostBookmarkTest`（history 書籤專用）互補：這裡管的是
 * 全 zone 通用的解鎖/足跡狀態。掛載點在 IslandHost（全站覆蓋）。
 *
 * ⚠️ 已知時機陷阱（就是催生此 bridge 的那個坑）：`zone:visited:*` 只在
 * ReaderShell mount 時授予——進了 Reader 之後才 reset progress 的話，
 * 旗標要等重新整理（remount）才會補發。用 `visit(zone)` 可直接補。
 */

import { getReaderAuth } from '../auth';
import { isTestMode } from '../lib/apiBase';
import { getProgressManager } from '../progress';

import { zoneVisitedFlag } from './islandRuntime';
import { ISLAND_IDS, isIslandId } from './types';
import type { IslandId } from './types';

interface IslandsTestBridge {
  /** 直接解鎖浮島（跳過解鎖儀式） */
  unlock(id: IslandId): void;
  /** 重新上鎖浮島（視窗自動卸載，可重驗解鎖儀式） */
  relock(id: IslandId): void;
  /** 補授 zone 足跡旗標（等同進過該 zone 的 Reader） */
  visit(zone: IslandId): void;
  /** 撤銷 zone 足跡旗標（模擬從未到訪） */
  unvisit(zone: IslandId): void;
  /** 查看目前狀態 */
  status(): {
    view: string;
    /** 浮島前置：已登入的探索者才有浮島（false 時全部不掛載） */
    loggedIn: boolean;
    unlocked: string[];
    disabled: string[];
    visitedZones: string[];
  };
}

declare global {
  interface Window {
    __uepIslandsTest?: IslandsTestBridge;
  }
}

/** 無效 id 直接在 console 罵人，避免默默 no-op 讓人以為壞了 */
function assertIslandId(id: string): id is IslandId {
  if (isIslandId(id)) return true;
  console.warn(
    `[__uepIslandsTest] 無效的 island id「${id}」，可用：${ISLAND_IDS.join(', ')}`
  );
  return false;
}

/**
 * 掛上 dev 測試 bridge，回傳 cleanup。
 *
 * 掛載條件（Issue #41 起放寬）：
 *   - `import.meta.env.DEV` — 本地開發永遠掛
 *   - `isTestMode()` — test worker cookie 觸發或 build-time 綁 test worker
 * 兩者皆否才 no-op；production + prod worker 下整段仍會被 tree-shake。
 */
export function mountIslandsTestBridge(): () => void {
  if (!import.meta.env.DEV && !isTestMode()) return () => {};
  const bridge: IslandsTestBridge = {
    unlock(id) {
      if (!assertIslandId(id)) return;
      getProgressManager().unlockIsland(id);
    },
    relock(id) {
      if (!assertIslandId(id)) return;
      getProgressManager().relockIsland(id);
    },
    visit(zone) {
      if (!assertIslandId(zone)) return;
      getProgressManager().grantFlags([zoneVisitedFlag(zone)]);
    },
    unvisit(zone) {
      if (!assertIslandId(zone)) return;
      getProgressManager().revokeFlags([zoneVisitedFlag(zone)]);
    },
    status() {
      const state = getProgressManager().getState();
      return {
        view: state.view,
        loggedIn: getReaderAuth().isLoggedIn(),
        unlocked: [...state.islandsUnlocked],
        disabled: [...state.islandsDisabled],
        visitedZones: ISLAND_IDS.filter((id) =>
          state.flags.includes(zoneVisitedFlag(id))
        ),
      };
    },
  };
  window.__uepIslandsTest = bridge;
  return () => {
    if (window.__uepIslandsTest === bridge) {
      delete window.__uepIslandsTest;
    }
  };
}
