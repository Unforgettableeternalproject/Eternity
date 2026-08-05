/**
 * 閒置帷幕測試（S10-4 A 段，2026-08-04）
 *
 * 這套機制的價值全在「拖越久越難散」這條規則上，所以測試釘的是：
 * 階段隨時間推進、驅散門檻隨階段變高、半調子的活動不會重置階段、
 * 散掉時要把時間軸一併重設。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getActivityDebug,
  startActivityWatch,
  stopActivityWatch,
} from '../activityWatch';
import {
  forceVeilStage,
  getVeilDebug,
  getVeilState,
  setDispelPaused,
  startIdleVeil,
  stopIdleVeil,
} from '../idleVeil';
import { clearUepSettingsCache } from '../uepSettings';

const THRESHOLD_SEC = 60;

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

async function boot() {
  await startActivityWatch();
  startIdleVeil();
}

/** 跨過閒置閾值，讓帷幕升起 */
async function goIdle() {
  await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 1000 + 1000);
}

async function wait(sec: number) {
  await vi.advanceTimersByTimeAsync(sec * 1000);
}

/** 模擬滑鼠移動 distance px（拆成兩點，idleVeil 靠相鄰兩點的差值累加） */
async function movePointer(distance: number) {
  window.dispatchEvent(
    new PointerEvent('pointermove', { clientX: 0, clientY: 0 })
  );
  window.dispatchEvent(
    new PointerEvent('pointermove', { clientX: distance, clientY: 0 })
  );
  await vi.advanceTimersByTimeAsync(300);
}

describe('idleVeil', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    clearUepSettingsCache();
    delete window.__uepSettings;
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    mockSettings();
  });

  afterEach(() => {
    stopIdleVeil();
    stopActivityWatch();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('閒置後 20／60／120 秒依序進三個階段', async () => {
    await boot();
    expect(getVeilState().stage).toBe(0);

    await goIdle();
    // 剛判定閒置的前 20 秒畫面要乾淨
    expect(getVeilState().stage).toBe(0);

    await wait(20);
    expect(getVeilState().stage).toBe(1);

    await wait(40);
    expect(getVeilState().stage).toBe(2);

    await wait(60);
    expect(getVeilState().stage).toBe(3);
  });

  it('濃度隨時間累進，階段三是全遮', async () => {
    await boot();
    await goIdle();

    await wait(21);
    const s1 = getVeilState().coverage;
    expect(s1).toBeGreaterThan(0);

    await wait(40);
    expect(getVeilState().coverage).toBeGreaterThan(s1);

    await wait(60);
    expect(getVeilState().coverage).toBe(1);
  });

  it('階段一動一下就散，並把時間軸一併重設', async () => {
    await boot();
    await goIdle();
    await wait(21);
    expect(getVeilState().stage).toBe(1);

    await movePointer(100); // > 80px 門檻
    expect(getVeilState().stage).toBe(0);
    // noteActivity 讓 activityWatch 也回到「剛剛才動過」
    expect(getActivityDebug().idle).toBe(false);
  });

  it('拖越久越難散：階段三的門檻擋得住階段一的活動量', async () => {
    await boot();
    await goIdle();
    await wait(121);
    expect(getVeilState().stage).toBe(3);

    await movePointer(100);
    // 同樣的 100px 在階段一足以驅散，這裡只推進一小段
    expect(getVeilState().stage).toBe(3);
    expect(getVeilState().dispel).toBeGreaterThan(0);
    expect(getVeilState().dispel).toBeLessThan(1);

    await movePointer(1200);
    expect(getVeilState().stage).toBe(0);
  });

  it('半調子的活動累積驅散進度，但不重置階段', async () => {
    await boot();
    await goIdle();
    await wait(61);
    expect(getVeilState().stage).toBe(2);

    await movePointer(100);
    expect(getVeilState().stage).toBe(2);
    const partial = getVeilState().dispel;
    expect(partial).toBeGreaterThan(0);

    // 又放著不動——階段照樣往上爬，而且已累積的進度不會被沒收
    await wait(60);
    expect(getVeilState().stage).toBe(3);
    expect(getVeilDebug().movedPx).toBeGreaterThan(0);
  });

  it('驅散進度即時反映在濃度上（使用者看得到自己撥開了多少）', async () => {
    await boot();
    await goIdle();
    await wait(121);
    const full = getVeilState().coverage;

    await movePointer(600); // 1200px 門檻的一半
    expect(getVeilState().coverage).toBeLessThan(full);
  });

  it('只用鍵盤也驅散得掉', async () => {
    await boot();
    await goIdle();
    await wait(21);

    // 每次 keydown 等效 40px，兩次就超過階段一的 80px
    for (let i = 0; i < 3; i += 1) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(getVeilState().stage).toBe(0);
  });

  it('idleNudgeMode=disabled 時不升起帷幕', async () => {
    mockSettings({ 'reader.idleNudgeMode': 'disabled' });
    await boot();
    await goIdle();
    await wait(130);

    expect(getVeilState().stage).toBe(0);
    // 但量測本身照常運作——關的只是 UI
    expect(getActivityDebug().idle).toBe(true);
  });

  it('DevTools 直接跳階段走的是正規路徑', async () => {
    await boot();
    forceVeilStage(3);

    expect(getVeilState().stage).toBe(3);
    expect(getVeilDebug().needPx).toBe(1200);

    // 跳過去之後的驅散行為與真實掛機一致
    await movePointer(1300);
    expect(getVeilState().stage).toBe(0);
  });

  it('暫停期間的滑鼠位移不算驅散（DevTools 面板開著時）', async () => {
    await boot();
    await goIdle();
    await wait(21);
    expect(getVeilState().stage).toBe(1);

    setDispelPaused(true);
    // 面板開著時操作按鈕的位移遠超過階段一的 80px 門檻
    await movePointer(2000);
    expect(getVeilState().stage).toBe(1);
    expect(getVeilDebug().movedPx).toBe(0);

    // 關掉面板之後才開始追蹤
    setDispelPaused(false);
    await movePointer(100);
    expect(getVeilState().stage).toBe(0);
  });

  it('恢復追蹤時不追認「把滑鼠移回內容」那一段', async () => {
    await boot();
    await goIdle();
    await wait(21);

    setDispelPaused(true);
    // 指標停在面板上（畫面右側）
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 1200, clientY: 400 })
    );
    setDispelPaused(false);

    // 恢復後的第一個事件是「從面板移回內容」，不該被記成一整段距離
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 100, clientY: 400 })
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(getVeilDebug().movedPx).toBe(0);
    expect(getVeilState().stage).toBe(1);
  });

  it('暫停驅散不會連階段推進一起停掉', async () => {
    await boot();
    await goIdle();
    setDispelPaused(true);

    await wait(21);
    expect(getVeilState().stage).toBe(1);
    await wait(40);
    expect(getVeilState().stage).toBe(2);
  });

  /* 背景不計掛機（S10-4 §2-3）。階段是用牆鐘推的，不停表的話切出去一小時
     回來就直接全遮，還要劃 1200px 才撥得開 */
  describe('離開前景時凍結時間軸', () => {
    /** 切到背景分頁 */
    function hide() {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    }

    function show() {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    }

    it('背景停留的時間不計入階段推進', async () => {
      await boot();
      await goIdle();
      await wait(21);
      expect(getVeilState().stage).toBe(1);

      hide();
      expect(getVeilDebug().frozen).toBe(true);
      await wait(3600); // 切出去一小時
      show();

      // 回來時仍停在離開前的階段，而不是跳到全遮
      expect(getVeilDebug().frozen).toBe(false);
      expect(getVeilState().stage).toBe(1);
    });

    it('回到前景後接著長，不是從頭重來', async () => {
      await boot();
      await goIdle();
      await wait(21);

      hide();
      await wait(600);
      show();

      // 離開時累積了 21 秒，再走 40 秒就該跨進階段二
      await wait(40);
      expect(getVeilState().stage).toBe(2);
    });

    it('視窗失焦同樣凍結', async () => {
      await boot();
      await goIdle();
      await wait(21);

      window.dispatchEvent(new Event('blur'));
      expect(getVeilDebug().frozen).toBe(true);
      await wait(3600);
      window.dispatchEvent(new Event('focus'));

      expect(getVeilState().stage).toBe(1);
    });

    it('凍結期間顯示的經過秒數停住', async () => {
      await boot();
      await goIdle();
      await wait(21);
      const before = getVeilDebug().elapsedSec;

      hide();
      await wait(300);
      expect(getVeilDebug().elapsedSec).toBe(before);
    });
  });

  it('重複進入 idle 不會重置已經在生長的帷幕', async () => {
    await boot();
    await goIdle();
    await wait(61);
    expect(getVeilState().stage).toBe(2);

    // 動一下但不足以驅散：activityWatch 會離開 idle 再重新進入，
    // 帷幕不該因此從頭開始長
    await movePointer(10);
    await goIdle();
    expect(getVeilState().stage).toBe(3);
  });
});
