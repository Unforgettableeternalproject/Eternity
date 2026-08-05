/**
 * 教學的播放層（S10-4 C 段；2026-08-04 改為事件驅動、08-05 納入識別證）
 *
 * 掛在 TopBar（覆蓋全站），唯一的職責是「收到請求 → 確認對象能演 → 等它出現
 * → 蓋上 overlay」。什麼時候該演由請求端決定（解鎖儀式收束、識別證首次掛上、
 * 偏好面板回顧），見 `guideRequest.ts`。
 *
 * ⚠️ **不能掛在 `IslandHost` 底下**（2026-08-05 修）。Host 在
 * `activeIds.length === 0`（一座島都還沒解鎖）或觀測者視角時整個 return null
 * ——而識別證教學的對象正是**剛註冊、一座島都沒有的人**，掛在裡面等於永遠
 * 不播。請求會被 latch 卡住，直到第一座島解鎖才被領走，還會被那座島自己的
 * 請求覆蓋掉。
 *
 * 自己 `createPortal` 到 body：overlay 不 portal，而 TopBar 是 sticky 堆疊
 * 上下文，內部元素的 z-index 對外會被鎖在 100 層（S5 教訓）。原本是靠
 * IslandHost 的 portal 順帶解決的。
 *
 * 舊版的觸發是純衍生的 `islandsUnlocked ∖ islandGuidesSeen`，每次 progress
 * 變動都重算，因此得額外背著 sessionStorage 分頁額度、額度換人時的還原、
 * 以及一個補償 mount 時序的模組層級旗標。改成事件驅動後那些全部移除。
 *
 * ## 島與識別證的差異只有兩處
 *
 * 「能不能演」與「怎麼讓它出現」——島問 `shouldMountIsland` 並走
 * `islandRuntime.open()`；識別證只要人在（登入的桌面訪客），翻開走
 * `IDENT_OPEN_EVENT`。其餘（等根節點、逾時作廢、顯示中失去資格就收掉）
 * 兩者共用。
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { getReaderAuth, useReaderAuth } from '../../auth';
import { getProgressManager, useProgress } from '../../progress';
import {
  canUseIslands,
  getIslandRuntime,
  isDesktopIslandViewport,
  shouldMountIsland,
} from '../islandRuntime';
import type { IslandId } from '../types';
import { useDesktopIslandViewport } from '../useIslands';

import IslandGuideOverlay, {
  type GuideCloseReason,
} from './IslandGuideOverlay';
import { subscribeGuide } from './guideRequest';
import { IDENT_GUIDE_FLAG, IDENT_OPEN_EVENT } from './identGuide';
import { getGuideSteps, guideRoot, hasGuide } from './guideSteps';
import type { GuideTargetId } from './guideSteps';

/** 等對象出現的上限。島是 lazy chunk，兩個 frame 不一定夠 */
const MOUNT_WAIT_MS = 2500;

/** 等對象的根節點出現。逾時回 false，該次請求作廢 */
function waitForGuideRoot(id: GuideTargetId): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + MOUNT_WAIT_MS;
    let frames = 0;
    const tick = () => {
      frames += 1;
      // 至少過兩幀：根節點出現的那一拍內容還在 Suspense fallback，
      // 這時量 anchor 會全部落空而降級成置中卡
      if (frames >= 2 && guideRoot(id)) {
        resolve(true);
        return;
      }
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export default function GuideRunner() {
  const progress = useProgress();
  const session = useReaderAuth();
  const desktop = useDesktopIslandViewport();
  const [active, setActive] = useState<GuideTargetId | null>(null);

  /**
   * 對象現在能不能演教學。
   *
   * ⚠️ **一律讀即時狀態，不讀 render 時的快照**（2026-08-05 修）。
   * `completeUnlockRitual` 是在解鎖後的**同一個同步堆疊**裡呼叫
   * `requestGuide` 的，而 React 的重渲染排在那之後——用 render 時的
   * progress（無論放 ref 還是直接閉包）判定，看到的都是解鎖前的快照，
   * 於是 `shouldMountIsland` 判成「這座島還沒解鎖」而把請求整個丟掉。
   * 症狀是浮島教學在正式解鎖時永遠不播，而且不會有任何錯誤。
   *
   * 下面的 `useProgress()` / `useReaderAuth()` / `useDesktopIslandViewport()`
   * 仍要留著——它們負責在狀態變化時重渲染，讓「顯示中失去資格就收掉」
   * 的 effect 重跑。訂閱與判定是兩件事。
   */
  const available = useCallback((id: GuideTargetId): boolean => {
    if (!hasGuide(id) || !isDesktopIslandViewport()) return false;
    // 識別證是登入者才有的東西，且不歸浮島的解鎖／停用規則管
    if (id === 'ident') return getReaderAuth().isLoggedIn();
    const state = getProgressManager().getState();
    return canUseIslands(state) && shouldMountIsland(state, id as IslandId);
  }, []);

  useEffect(
    () =>
      subscribeGuide((id) => {
        if (!available(id)) return;
        if (id === 'ident') {
          window.dispatchEvent(new CustomEvent(IDENT_OPEN_EVENT));
        } else {
          getIslandRuntime().open(id as IslandId);
        }
        void waitForGuideRoot(id).then((mounted) => {
          // 等待期間世界可能已經不一樣（登出、切觀測者、縮成手機、停用該島）
          if (!mounted || !available(id)) return;
          setActive(id);
        });
      }),
    [available]
  );

  // 顯示中失去資格 → 收掉
  useEffect(() => {
    if (active && !available(active)) setActive(null);
  }, [active, progress, session, desktop, available]);

  const handleClose = useCallback(
    (reason: GuideCloseReason) => {
      const id = active;
      setActive(null);
      // 只有識別證需要記「看過了」——它的觸發（登入）會反覆發生。
      // Escape 是「現在不看」，下次登入還會給；完成與略過才算數。
      if (id !== 'ident') return;
      if (reason !== 'completed' && reason !== 'skipped') return;
      getProgressManager().grantFlags([IDENT_GUIDE_FLAG]);
    },
    [active]
  );

  if (!active || typeof document === 'undefined') return null;

  return createPortal(
    <IslandGuideOverlay
      targetId={active}
      steps={getGuideSteps(active)}
      onClose={handleClose}
    />,
    document.body
  );
}
