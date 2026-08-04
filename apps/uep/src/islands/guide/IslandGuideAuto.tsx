/**
 * 浮島教學的播放層（S10-4 C 段；2026-08-04 改為事件驅動）
 *
 * 掛在 `IslandHost` 底下，唯一的職責是「收到請求 → 確認島能演 → 等它 mount
 * → 蓋上 overlay」。什麼時候該演由請求端決定（解鎖儀式收束、偏好面板回顧），
 * 見 `guideRequest.ts`。
 *
 * 舊版的觸發是純衍生的 `islandsUnlocked ∖ islandGuidesSeen`，每次 progress
 * 變動都重算，因此得額外背著 sessionStorage 分頁額度、額度換人時的還原、
 * 以及一個補償 mount 時序的模組層級旗標。改成事件驅動後那些全部移除，
 * 這裡不再讀任何持久狀態。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useProgress } from '../../progress';
import {
  canUseIslands,
  getIslandRuntime,
  shouldMountIsland,
} from '../islandRuntime';
import type { IslandId } from '../types';
import { useDesktopIslandViewport } from '../useIslands';

import IslandGuideOverlay from './IslandGuideOverlay';
import { subscribeIslandGuide } from './guideRequest';
import { getGuideSteps, hasGuide, islandRoot } from './guideSteps';

/** 等島 mount 的上限。lazy chunk 要載入，兩個 frame 不一定夠 */
const MOUNT_WAIT_MS = 2500;

/** 等島的根節點出現。逾時回 false，該次請求作廢 */
function waitForIslandRoot(id: IslandId): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + MOUNT_WAIT_MS;
    let frames = 0;
    const tick = () => {
      frames += 1;
      // 至少過兩幀：根節點出現的那一拍內容還在 Suspense fallback，
      // 這時量 anchor 會全部落空而降級成置中卡
      if (frames >= 2 && islandRoot(id)) {
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

export default function IslandGuideAuto() {
  const progress = useProgress();
  const desktop = useDesktopIslandViewport();
  const [active, setActive] = useState<IslandId | null>(null);

  const progressRef = useRef(progress);
  progressRef.current = progress;
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;

  /** 島現在能不能演教學 */
  const available = useCallback(
    (id: IslandId): boolean =>
      hasGuide(id) &&
      desktopRef.current &&
      canUseIslands(progressRef.current) &&
      shouldMountIsland(progressRef.current, id),
    []
  );

  useEffect(
    () =>
      subscribeIslandGuide((id) => {
        if (!available(id)) return;
        getIslandRuntime().open(id);
        void waitForIslandRoot(id).then((mounted) => {
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
  }, [active, progress, desktop, available]);

  const handleClose = useCallback(() => {
    setActive(null);
  }, []);

  if (!active) return null;

  return (
    <IslandGuideOverlay
      islandId={active}
      steps={getGuideSteps(active)}
      onClose={handleClose}
    />
  );
}
