/**
 * activityWatch 測試
 *
 * 核心契約：
 * 1. 閒置判定的邊界（未達閾值不觸發、達到就觸發、任一活動即恢復）
 * 2. **與內容保護共用時間軸**——hidden／blur 封存並收掉提示，visible 但
 *    未取得 focus 不恢復，focus 恢復時把時間重設為當下
 * 3. 累計活躍毫秒扣掉閒置與離開前景的時間，且是 O(1) 的差值不是區間陣列
 * 4. start／stop 不重複掛 listener
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  startActivityWatch,
  stopActivityWatch,
  subscribeActivity,
  getActivityState,
  getActiveTotalMs,
  isIdleNudgeEnabled,
  forceIdleNow,
  getActivityDebug,
  type ActivityState,
} from '../activityWatch';
import { clearUepSettingsCache } from '../uepSettings';

const THRESHOLD_SEC = 60;

/** 讓 initUepSettings 拿到我們要的閾值，不打真的網路 */
function mockSettings(overrides: Record<string, string | number> = {}) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        settings: {
          'reader.activityIdleThresholdSec': THRESHOLD_SEC,
          'reader.idleNudgeMode': 'enabled',
          ...overrides,
        },
      },
    }),
  })) as unknown as typeof fetch;
}

/** jsdom 的 visibilityState / hasFocus 都不會自己動，要手動擺佈 */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function setFocused(focused: boolean) {
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
}

function activity() {
  window.dispatchEvent(new Event('pointermove'));
}

async function start(overrides?: Record<string, string | number>) {
  mockSettings(overrides);
  setFocused(true);
  await startActivityWatch();
}

describe('activityWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T00:00:00Z'));
    sessionStorage.clear();
    clearUepSettingsCache();
    delete window.__uepSettings;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  afterEach(() => {
    stopActivityWatch();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('未達閾值不進 idle，達到才進', async () => {
    await start();
    const seen: ActivityState[] = [];
    subscribeActivity((s) => seen.push(s));

    await vi.advanceTimersByTimeAsync((THRESHOLD_SEC - 1) * 1000);
    expect(getActivityState().idle).toBe(false);
    expect(seen).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(getActivityState().idle).toBe(true);
    expect(seen).toEqual([{ idle: true, idleSince: Date.now() }]);
  });

  it('任一活動事件即恢復，且不必等下一個 tick', async () => {
    await start();
    const seen: ActivityState[] = [];
    subscribeActivity((s) => seen.push(s));

    await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 1000);
    expect(getActivityState().idle).toBe(true);

    activity();
    // 沒有推進計時器——恢復是同步的
    expect(getActivityState()).toEqual({ idle: false, idleSince: null });
    expect(seen).toHaveLength(2);
  });

  it('活動中的高頻事件不通知訂閱者', async () => {
    await start();
    const fn = vi.fn();
    subscribeActivity(fn);

    for (let i = 0; i < 50; i += 1) {
      activity();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it('捲動走 capture 階段也算活動（Reader 內層容器不冒泡到 window）', async () => {
    await start();
    await vi.advanceTimersByTimeAsync((THRESHOLD_SEC - 1) * 1000);

    document.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(getActivityState().idle).toBe(false);
  });

  it('頁面 hidden 時封存並收掉 idle 提示', async () => {
    await start();
    await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 1000);
    expect(getActivityState().idle).toBe(true);

    setVisibility('hidden');
    expect(getActivityState()).toEqual({ idle: false, idleSince: null });

    // 背景期間再久也不會重新進 idle——tick 已停
    await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 10 * 1000);
    expect(getActivityState().idle).toBe(false);
  });

  it('window blur 也要停表——document 可能仍是 visible', async () => {
    await start();
    window.dispatchEvent(new Event('blur'));

    await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 5 * 1000);
    expect(getActivityState().idle).toBe(false);
  });

  it('visible 但視窗未取得 focus 時不恢復', async () => {
    await start();
    setVisibility('hidden');
    setFocused(false);
    setVisibility('visible');

    await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 2 * 1000);
    // 仍在暫停中：既沒進 idle，活躍時間也沒有累加
    expect(getActivityState().idle).toBe(false);
    const before = getActiveTotalMs();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getActiveTotalMs()).toBe(before);
  });

  it('focus 事件抵達但 document 仍 hidden 時不恢復', async () => {
    await start();
    setVisibility('hidden');
    window.dispatchEvent(new Event('focus'));

    const before = getActiveTotalMs();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getActiveTotalMs()).toBe(before);
  });

  it('回到前景時把時間軸重設為當下，不追認離開期間的沒動作', async () => {
    await start();
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 10 * 1000);

    setFocused(true);
    setVisibility('visible');
    // 若沒有重設 lastActivityAt，回來的下一個 tick 就會判定已閒置十分鐘
    await vi.advanceTimersByTimeAsync(2000);
    expect(getActivityState().idle).toBe(false);
  });

  describe('累計活躍毫秒', () => {
    it('活動期間單調累加，取差值即為該段的活躍時間', async () => {
      await start();
      const snapshot = getActiveTotalMs();

      await vi.advanceTimersByTimeAsync(10_000);
      activity();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(getActiveTotalMs() - snapshot).toBe(20_000);
    });

    it('閒置的時間不計入，且封存到最後一次活動而非進 idle 的當下', async () => {
      await start();
      const snapshot = getActiveTotalMs();

      await vi.advanceTimersByTimeAsync(30_000);
      activity();
      // 從這裡開始沒有動作，跨過閾值後進 idle
      await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 3 * 1000);
      expect(getActivityState().idle).toBe(true);

      // 30 秒的真實活動，閾值那段與之後的掛機都不算
      expect(getActiveTotalMs() - snapshot).toBe(30_000);
    });

    it('離開前景的時間不計入', async () => {
      await start();
      const snapshot = getActiveTotalMs();

      await vi.advanceTimersByTimeAsync(5000);
      setVisibility('hidden');
      await vi.advanceTimersByTimeAsync(600_000);
      setFocused(true);
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(5000);

      expect(getActiveTotalMs() - snapshot).toBe(10_000);
    });

    it('恢復活動後接續累加，不是重新計數', async () => {
      await start();
      const snapshot = getActiveTotalMs();

      // 20 秒的活躍：最後一次活動落在第 20 秒，所以整段都會被封存進累計
      await vi.advanceTimersByTimeAsync(10_000);
      activity();
      await vi.advanceTimersByTimeAsync(10_000);
      activity();

      await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 1000);
      expect(getActivityState().idle).toBe(true);

      activity();
      await vi.advanceTimersByTimeAsync(20_000);

      expect(getActiveTotalMs() - snapshot).toBe(40_000);
    });
  });

  describe('forceIdleNow（DevTools 驗收入口）', () => {
    it('走正規判定：訂閱者收到通知，狀態與真實閒置一致', async () => {
      await start();
      const seen: ActivityState[] = [];
      subscribeActivity((s) => seen.push(s));

      forceIdleNow();
      expect(getActivityState().idle).toBe(true);
      expect(seen).toHaveLength(1);

      // 恢復路徑也一樣
      activity();
      expect(getActivityState().idle).toBe(false);
    });

    it('剛開始活躍就強制閒置，累計值不可變成負數', async () => {
      await start();
      // 封存的是「最後一次活動的時刻」，而 forceIdleNow 把它推到區間起點
      // 之前——沒有 clamp 的話這裡會是負的，之後的閱讀時數差值全被丟掉
      forceIdleNow();
      expect(getActiveTotalMs()).toBeGreaterThanOrEqual(0);

      activity();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(getActiveTotalMs()).toBe(10_000);
    });

    it('未啟動時是 no-op', () => {
      expect(() => forceIdleNow()).not.toThrow();
      expect(getActivityState().idle).toBe(false);
    });
  });

  describe('getActivityDebug', () => {
    it('回報閾值、累積與暫停狀態', async () => {
      await start();
      await vi.advanceTimersByTimeAsync(5000);

      const debug = getActivityDebug();
      expect(debug.started).toBe(true);
      expect(debug.thresholdSec).toBe(THRESHOLD_SEC);
      expect(debug.activeTotalMs).toBe(5000);
      expect(debug.suspended).toBe(false);

      setVisibility('hidden');
      expect(getActivityDebug().suspended).toBe(true);
    });
  });

  describe('生命週期', () => {
    it('重複 start 不重複掛 listener，也只 fetch 一次設定', async () => {
      mockSettings();
      setFocused(true);
      await Promise.all([
        startActivityWatch(),
        startActivityWatch(),
        startActivityWatch(),
      ]);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      const fn = vi.fn();
      subscribeActivity(fn);
      await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 1000);
      // 掛兩份 listener 的話 tick 也會有兩個，通知就會是兩次
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('stop 後不再有 tick，狀態歸零', async () => {
      await start();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getActiveTotalMs()).toBeGreaterThan(0);

      stopActivityWatch();
      expect(getActiveTotalMs()).toBe(0);

      const fn = vi.fn();
      subscribeActivity(fn);
      await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 5 * 1000);
      expect(fn).not.toHaveBeenCalled();
    });

    it('背景分頁載入時不從一開始就累計活躍時間', async () => {
      mockSettings();
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      setFocused(false);
      await startActivityWatch();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(getActiveTotalMs()).toBe(0);
    });
  });

  describe('設定', () => {
    it('閾值來自站台設定，不是寫死的預設值', async () => {
      await start({ 'reader.activityIdleThresholdSec': 30 });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getActivityState().idle).toBe(true);
    });

    it('設定 fetch 失敗仍啟動，用程式碼預設值', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch;
      setFocused(true);
      await expect(startActivityWatch()).resolves.toBeUndefined();

      await vi.advanceTimersByTimeAsync(179_000);
      expect(getActivityState().idle).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(getActivityState().idle).toBe(true);
    });

    it('idleNudgeMode=disabled 只關提示，量測照常', async () => {
      await start({ 'reader.idleNudgeMode': 'disabled' });
      expect(isIdleNudgeEnabled()).toBe(false);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(getActiveTotalMs()).toBe(30_000);
      await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 1000);
      // idle 判定仍然發生——統計要靠它扣掉掛機
      expect(getActivityState().idle).toBe(true);
    });
  });
});
