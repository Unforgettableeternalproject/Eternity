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

import { useProgress, PROGRESS_CHANGE_EVENT } from '../../progress';
import type { ProgressChangeDetail, ProgressState } from '../../progress';
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
 * 解除本 tab 的自動播放上限（DevTools 手動驗收用）。
 * 清掉之後只要還有 unseen 的島就會重新自動排一次，不必開新分頁。
 */
export function clearGuideSessionLimit(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 清不掉就開新分頁
  }
}

/**
 * 最近一次浮島解鎖的時刻。
 *
 * ⚠️ **訂閱必須在模組層級，不能放進元件的 effect。** `IslandHost` 在
 * `activeIds.length === 0` 時直接 return null——也就是第一座島解鎖**之前**
 * 這個元件根本沒有 mount，元件內的訂閱掛不上，`island-unlocked` 事件會被
 * 整個錯過；解鎖後首次 mount 時旗標是 false，於是延遲走 0，教學直接蓋在
 * 剛開始播的甦醒動畫上。
 *
 * 而第一座島正是最需要這個延遲的一次（那是使用者第一次看到浮島）。
 *
 * IslandHost 靜態 import 本模組，而它掛在 TopBar 全站——所以模組層級的
 * 訂閱在任何島解鎖之前就已經生效。
 *
 * 走 window 事件而不是 `getProgressManager().subscribe()`：模組層級的副作用
 * 在 import 當下就執行，那時去碰 progress 單例會綁死載入順序（測試裡直接
 * 撞上 mock 的暫時性死區）。事件常數是純字串，沒有這個問題。
 */
let lastUnlockAt = 0;

if (typeof window !== 'undefined') {
  window.addEventListener(PROGRESS_CHANGE_EVENT, (event) => {
    const detail = (event as CustomEvent<ProgressChangeDetail>).detail;
    if (detail?.source === 'island-unlocked') lastUnlockAt = Date.now();
  });
}

/**
 * 解鎖儀式還要演多久。回 0 代表不必等。
 *
 * 用「距離解鎖過了多久」而不是一個布林旗標：元件可能在解鎖後好幾百毫秒
 * 才 mount（lazy chunk、Host 重渲染），那段時間已經被儀式用掉了，還等
 * 完整的 AWAKEN_MS 會多壓一段死時間。
 */
function remainingAwakenMs(): number {
  if (lastUnlockAt === 0) return 0;
  const elapsed = Date.now() - lastUnlockAt;
  if (elapsed >= AWAKEN_MS) return 0;
  return AWAKEN_MS - elapsed;
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
    const delay = remainingAwakenMs();

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
