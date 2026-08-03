/**
 * 休息提醒測試
 *
 * 核心契約：兩條線先到先觸發且各自可用 0 停用、只計本 session 真的完成的
 * 頁、冷卻從按下確認起算、確認後 baseline 重設不會立刻再觸發。
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { stopActivityWatch } from '../../../lib/activityWatch';
import { clearUepSettingsCache } from '../../../lib/uepSettings';
import { PROGRESS_CHANGE_EVENT } from '../../../progress';
import { ReaderNudgeProvider } from '../../zone/ReaderNudge';
import { RestReminder } from '../useRestReminder';

/** 閒置閾值放大，讓推進時間不會意外中斷活躍區間 */
const IDLE_SEC = 3600;

const DEFAULTS = {
  'reader.activityIdleThresholdSec': IDLE_SEC,
  // 這一組測的是休息提醒的判定，關掉 AFK 卡以免它佔住同一層
  // （不疊卡的行為本身在 ReaderNudge 測）
  'reader.idleNudgeMode': 'disabled',
  'reader.restActiveMinutes': 45,
  'reader.restPageCount': 5,
  'reader.restWindowMinutes': 30,
  'reader.restCooldownMinutes': 60,
};

function mockSettings(overrides: Record<string, string | number> = {}) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      data: { settings: { ...DEFAULTS, ...overrides } },
    }),
  })) as unknown as typeof fetch;
}

async function mount(overrides?: Record<string, string | number>) {
  mockSettings(overrides);
  render(
    <ReaderNudgeProvider>
      <RestReminder />
    </ReaderNudgeProvider>
  );
  // Provider 與 hook 各自 await 去重後的 initUepSettings
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** 模擬「首次讀完一篇」——只有這個 source 會被計入 */
async function completePage(source = 'page-completed') {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(PROGRESS_CHANGE_EVENT, { detail: { source } })
    );
  });
}

async function poke() {
  await act(async () => {
    window.dispatchEvent(new Event('pointermove'));
  });
}

/**
 * 保持活躍地推進時間——每 20 秒動一下。閾值短的測試裡直接 advance
 * 會在中途進 idle 而停止累積。
 */
async function activeAdvance(ms: number) {
  let left = ms;
  while (left > 0) {
    const step = Math.min(20_000, left);
    await poke();
    await advance(step);
    left -= step;
  }
}

/** 與 `useRestReminder.ts` 的 `REST_TITLE` 對齊——文案改了這裡要跟著改 */
const card = () => screen.queryByText('看了好多東西了');

/**
 * 按下「知道了」並等退場動畫演完。
 *
 * 2026-08-04 起休息提醒是側邊滑出的卡片，按鈕按下後會先播 460ms 的滑回
 * 動畫，**動畫結束才呼叫 `onAcknowledge`**——也就是冷卻與 baseline 的重設
 * 都發生在那之後。這裡不推進時間的話，後續斷言看到的是還沒重設的狀態。
 */
async function acknowledge() {
  await act(async () => {
    screen.getByText('知道了').click();
    await vi.advanceTimersByTimeAsync(500);
  });
}

describe('useRestReminder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    clearUepSettingsCache();
    delete window.__uepSettings;
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  afterEach(() => {
    stopActivityWatch();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('累積活躍時長達標時提醒', async () => {
    await mount({ 'reader.restActiveMinutes': 1, 'reader.restPageCount': 0 });

    await advance(50_000);
    expect(card()).toBeNull();

    await advance(20_000);
    expect(card()).toBeTruthy();
  });

  it('視窗內完成頁數達標時提醒——時長還遠不到也會觸發', async () => {
    await mount({ 'reader.restActiveMinutes': 45, 'reader.restPageCount': 3 });

    await completePage();
    await completePage();
    await advance(20_000);
    expect(card()).toBeNull();

    await completePage();
    await advance(20_000);
    expect(card()).toBeTruthy();
  });

  it('只計 page-completed——hydrate 與重讀不算本次的大量閱讀', async () => {
    await mount({ 'reader.restActiveMinutes': 0, 'reader.restPageCount': 2 });

    await completePage('hydrate');
    await completePage('reading-time');
    await completePage('flag');
    await advance(20_000);
    expect(card()).toBeNull();

    await completePage();
    await completePage();
    await advance(20_000);
    expect(card()).toBeTruthy();
  });

  it('視窗外的完成紀錄會被剔除', async () => {
    await mount({
      'reader.restActiveMinutes': 0,
      'reader.restPageCount': 2,
      'reader.restWindowMinutes': 1,
    });

    await completePage();
    // 第一筆已經滑出一分鐘的視窗，湊不成兩筆
    await advance(70_000);
    await completePage();
    await advance(20_000);
    expect(card()).toBeNull();

    await completePage();
    await advance(20_000);
    expect(card()).toBeTruthy();
  });

  it('冷卻從按下確認起算，且確認後不會立刻重觸發', async () => {
    await mount({
      'reader.restActiveMinutes': 1,
      'reader.restPageCount': 0,
      'reader.restCooldownMinutes': 10,
    });

    await advance(70_000);
    expect(card()).toBeTruthy();

    // 卡片停留期間不重複提交，也還沒開始冷卻
    await advance(300_000);
    await acknowledge();
    expect(card()).toBeNull();

    // baseline 重設：即使剛才已累積五分鐘，也要重新累積滿一分鐘
    await advance(70_000);
    expect(card()).toBeNull();

    // 冷卻十分鐘內都不再提醒（前面已經走掉 70 秒）
    await advance(8 * 60_000);
    expect(card()).toBeNull();

    await advance(2 * 60_000);
    expect(card()).toBeTruthy();
  });

  it('確認後完成頁數重新起算', async () => {
    await mount({ 'reader.restActiveMinutes': 0, 'reader.restPageCount': 2 });

    await completePage();
    await completePage();
    await advance(20_000);
    await acknowledge();

    // 冷卻結束後只完成一頁，不該再提醒
    await advance(61 * 60_000);
    await completePage();
    await advance(20_000);
    expect(card()).toBeNull();

    await completePage();
    await advance(20_000);
    expect(card()).toBeTruthy();
  });

  it('兩條線都設 0 = 整個停用', async () => {
    await mount({ 'reader.restActiveMinutes': 0, 'reader.restPageCount': 0 });

    for (let i = 0; i < 10; i += 1) await completePage();
    await advance(4 * 60 * 60_000);
    expect(card()).toBeNull();
  });

  it('閒置的時間不算進累積活躍時長', async () => {
    // 門檻兩分鐘、閾值 30 秒。閾值內的無動作仍算閱讀（讀長段落不會一直動
    // 滑鼠），只有跨過閾值確認是掛機後才回溯封存到最後一次活動
    await mount({
      'reader.activityIdleThresholdSec': 30,
      'reader.restActiveMinutes': 2,
      'reader.restPageCount': 0,
    });

    await advance(20_000);
    await poke();
    await advance(10_000);
    await poke();

    // 掛機十分鐘。若這段被計入，兩分鐘的門檻早就破了
    await advance(10 * 60_000);
    expect(card()).toBeNull();

    // 累積值停在 30 秒，恢復活動後還要 90 秒才跨過兩分鐘
    await activeAdvance(60_000);
    expect(card()).toBeNull();

    await activeAdvance(40_000);
    expect(card()).toBeTruthy();
  });
});
