/**
 * 浮島教學的自動播放（S10-4 C 段）
 *
 * ## 觸發是純衍生，不新增 bridge
 *
 * `islandsUnlocked` 有它、`islandGuidesSeen` 沒有 → 該演。這兩份資訊本來
 * 就都在 ProgressState 裡，跨元件傳遞是多餘的。專案已經有 terminalBridge／
 * echoSuggestionBridge／relatedBridge 三套島訊號，再加一套的門檻應該很高。
 *
 * ## 每個 tab session 最多一座
 *
 * 舊帳號 hydrate 後可能五島全部 unlocked、全部 unseen。同一頁連播五套教學
 * 不是教學是刁難。sessionStorage 只控制「這個 tab 已經自動彈過」，真正的
 * 跨裝置完成事實仍只有 `islandGuidesSeen`。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useProgress } from '../../progress';
import type { ProgressState } from '../../progress';
import { getProgressManager } from '../../progress';
import {
  canUseIslands,
  getIslandRuntime,
  shouldMountIsland,
} from '../islandRuntime';
import { ISLAND_IDS } from '../types';
import type { IslandId } from '../types';
import { AWAKEN_MS } from '../unlockRitual';
import { useDesktopIslandViewport } from '../useIslands';

import IslandGuideOverlay, {
  type GuideCloseReason,
} from './IslandGuideOverlay';
import { subscribeGuideReplay } from './guideReplay';
import { getGuideSteps, hasGuide, islandRoot } from './guideSteps';

const SESSION_KEY = 'uep-island-guide-auto-shown';

/** 等島 mount 的上限。lazy chunk 要載入，兩個 frame 不一定夠 */
const MOUNT_WAIT_MS = 2500;

function sessionAlreadyShown(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === 'true';
  } catch {
    // 讀不到（隱私模式）就當作沒播過——最壞情況是每個新分頁多播一次，
    // 比「永遠不播」好
    return false;
  }
}

function markSessionShown(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, 'true');
  } catch {
    // 寫不進去不影響本次播放
  }
}

/**
 * 挑出要播的那一座。
 *
 * 在 `ISLAND_IDS` 上迭代而不是在 `islandsUnlocked` 或 `islandGuidesSeen` 上
 * ——那兩份的順序取決於使用者的解鎖先後與遠端合流結果，用它們挑「第一個」
 * 會讓同樣的狀態在不同裝置上播出不同的島。
 */
function pickCandidate(
  progress: ProgressState,
  seen: string[]
): IslandId | null {
  return (
    ISLAND_IDS.find(
      (id) =>
        hasGuide(id) && shouldMountIsland(progress, id) && !seen.includes(id)
    ) ?? null
  );
}

/** 等島的根節點出現。逾時回 false，該次排程作廢（不寫 seen 也不寫 session key） */
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
  /** 這次播放是回顧：不寫 seen、不受 session 上限管 */
  const replayRef = useRef(false);

  const progressRef = useRef(progress);
  progressRef.current = progress;
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;
  /** 這一輪是不是剛解鎖觸發的——是的話要讓解鎖儀式先演完 */
  const justUnlockedRef = useRef(false);
  /** 同一時間只排一次 */
  const schedulingRef = useRef(false);

  /**
   * 島現在能不能演教學。**不含 seen 判定**——那是「要不要自動播」的條件，
   * 不是「能不能演」的條件。混在一起會讓回顧一顯示就被守門收掉（回顧的
   * 對象幾乎必然是已經看過的島）。
   */
  const available = useCallback(
    (id: IslandId): boolean =>
      desktopRef.current &&
      canUseIslands(progressRef.current) &&
      shouldMountIsland(progressRef.current, id),
    []
  );

  /** 自動播放的條件：能演，而且還沒看過 */
  const autoEligible = useCallback(
    (id: IslandId): boolean =>
      available(id) && !progressRef.current.islandGuidesSeen.includes(id),
    [available]
  );

  useEffect(
    () =>
      getProgressManager().subscribe((_state, detail) => {
        if (detail.source === 'island-unlocked') justUnlockedRef.current = true;
      }),
    []
  );

  // 回顧：使用者從浮島偏好面板明確要求，所以不看 session 上限也不看 seen，
  // 只確認島現在真的可用
  useEffect(
    () =>
      subscribeGuideReplay((id) => {
        const p = progressRef.current;
        if (!desktopRef.current || !canUseIslands(p)) return;
        if (!shouldMountIsland(p, id)) return;
        getIslandRuntime().open(id);
        void waitForIslandRoot(id).then((mounted) => {
          if (!mounted) return;
          replayRef.current = true;
          setActive(id);
        });
      }),
    []
  );

  useEffect(() => {
    if (active || schedulingRef.current) return undefined;
    if (sessionAlreadyShown()) return undefined;
    if (!desktop || !canUseIslands(progress)) return undefined;

    const candidate = pickCandidate(progress, progress.islandGuidesSeen);
    if (!candidate) return undefined;

    schedulingRef.current = true;
    let cancelled = false;
    // 剛做完解鎖儀式的島要等甦醒動畫演完——教學蓋在儀式上等於把剛給的
    // 東西立刻搶走
    const delay = justUnlockedRef.current ? AWAKEN_MS : 0;

    const timer = window.setTimeout(() => {
      void (async () => {
        // 延遲期間可能登出、切觀測者、縮成手機、停用或重新上鎖該島
        if (cancelled || !autoEligible(candidate)) {
          schedulingRef.current = false;
          return;
        }
        getIslandRuntime().open(candidate);
        const mounted = await waitForIslandRoot(candidate);
        // 等待期間同樣要重驗——非同步落地後的世界可能已經不一樣
        if (cancelled || !mounted || !autoEligible(candidate)) {
          schedulingRef.current = false;
          return;
        }
        justUnlockedRef.current = false;
        // session key 在真正顯示的那一刻才寫：排程被取消時不該消耗掉
        // 這個 tab 唯一的自動播放額度
        markSessionShown();
        setActive(candidate);
        schedulingRef.current = false;
      })();
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      schedulingRef.current = false;
    };
  }, [progress, desktop, active, autoEligible]);

  // overlay 顯示中失去資格（登出／切觀測者／縮成手機／停用該島）→ 收掉。
  // session key 已經寫了，本 session 不再自動打擾
  useEffect(() => {
    if (active && !available(active)) setActive(null);
  }, [active, progress, desktop, available]);

  const handleClose = useCallback(
    (reason: GuideCloseReason) => {
      const id = active;
      const wasReplay = replayRef.current;
      setActive(null);
      replayRef.current = false;
      if (!id || wasReplay) return; // 回顧只是重播，不改寫任何狀態
      // Escape 與守門取消只是「現在不看」，完成與略過才是「不用再給我看」
      if (reason === 'completed' || reason === 'skipped') {
        getProgressManager().markIslandGuideSeen(id);
      }
    },
    [active]
  );

  if (!active) return null;

  return (
    <IslandGuideOverlay
      islandId={active}
      steps={getGuideSteps(active)}
      onClose={handleClose}
    />
  );
}
