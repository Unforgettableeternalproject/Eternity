/**
 * ReaderNudge 測試
 *
 * 2026-08-04 起這一層只剩休息提醒——閒置改由 `IdleVeil` 承擔，測試在
 * `lib/__tests__/idleVeil.test.ts`。
 *
 * 核心契約：休息提醒要按下確認才消失（活動事件關不掉）、確認後要等退場
 * 動畫演完才通知提交方、提交方可以撤銷尚未確認的提醒。
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { stopActivityWatch } from '../../../lib/activityWatch';
import { stopIdleVeil } from '../../../lib/idleVeil';
import { clearUepSettingsCache } from '../../../lib/uepSettings';
import { ReaderNudgeProvider, useReaderNudge } from '../ReaderNudge';

/** 與 ReaderNudge 的 LEAVE_MS 對齊 */
const LEAVE_MS = 460;

function mockSettings(overrides: Record<string, string | number> = {}) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        settings: {
          'reader.activityIdleThresholdSec': 60,
          'reader.idleNudgeMode': 'enabled',
          ...overrides,
        },
      },
    }),
  })) as unknown as typeof fetch;
}

/** 讓測試能從 Provider 內部提交休息提醒 */
function RestTrigger({ onAcknowledge }: { onAcknowledge: () => void }) {
  const { requestRestNudge, dismissRestNudge } = useReaderNudge();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          requestRestNudge({
            title: '讀了一陣子了',
            body: '要不要起來走走？',
            onAcknowledge,
          })
        }
      >
        提交休息提醒
      </button>
      <button type="button" onClick={dismissRestNudge}>
        撤銷休息提醒
      </button>
    </>
  );
}

async function poke() {
  await act(async () => {
    window.dispatchEvent(new Event('pointermove'));
  });
}

/** Provider 的 startActivityWatch 是非同步的，等它落地 */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('ReaderNudge', () => {
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

  it('休息提醒要按下確認才消失，活動事件不會關掉它', async () => {
    const onAcknowledge = vi.fn();
    render(
      <ReaderNudgeProvider>
        <RestTrigger onAcknowledge={onAcknowledge} />
      </ReaderNudgeProvider>
    );
    await settle();

    await act(async () => {
      screen.getByText('提交休息提醒').click();
    });
    expect(screen.getByText('讀了一陣子了')).toBeTruthy();

    await poke();
    expect(screen.getByText('讀了一陣子了')).toBeTruthy();

    await act(async () => {
      screen.getByText('知道了').click();
      // 退場動畫演完才會通知提交方
      await vi.advanceTimersByTimeAsync(LEAVE_MS);
    });
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('讀了一陣子了')).toBeNull();
  });

  it('確認後先播退場動畫，動畫途中不通知提交方', async () => {
    const onAcknowledge = vi.fn();
    render(
      <ReaderNudgeProvider>
        <RestTrigger onAcknowledge={onAcknowledge} />
      </ReaderNudgeProvider>
    );
    await settle();
    await act(async () => {
      screen.getByText('提交休息提醒').click();
    });

    await act(async () => {
      screen.getByText('知道了').click();
      await vi.advanceTimersByTimeAsync(LEAVE_MS - 100);
    });
    // 還在滑回去的路上：卡片仍在，冷卻也還沒開始
    expect(onAcknowledge).not.toHaveBeenCalled();
    expect(document.querySelector('.rnudge--leaving')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('重複按確認只會通知一次', async () => {
    const onAcknowledge = vi.fn();
    render(
      <ReaderNudgeProvider>
        <RestTrigger onAcknowledge={onAcknowledge} />
      </ReaderNudgeProvider>
    );
    await settle();
    await act(async () => {
      screen.getByText('提交休息提醒').click();
    });

    await act(async () => {
      screen.getByText('知道了').click();
      screen.getByText('知道了').click();
      screen.getByText('知道了').click();
      await vi.advanceTimersByTimeAsync(LEAVE_MS);
    });
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('提交方可以撤銷尚未確認的休息提醒', async () => {
    render(
      <ReaderNudgeProvider>
        <RestTrigger onAcknowledge={() => {}} />
      </ReaderNudgeProvider>
    );
    await settle();

    await act(async () => {
      screen.getByText('提交休息提醒').click();
    });
    expect(screen.getByText('讀了一陣子了')).toBeTruthy();

    await act(async () => {
      screen.getByText('撤銷休息提醒').click();
    });
    expect(screen.queryByText('讀了一陣子了')).toBeNull();
  });

  it('卡片帶著 U.E.P 立繪，且不擋整個畫面', async () => {
    render(
      <ReaderNudgeProvider>
        <RestTrigger onAcknowledge={() => {}} />
      </ReaderNudgeProvider>
    );
    await settle();
    await act(async () => {
      screen.getByText('提交休息提醒').click();
    });

    const layer = document.querySelector('.rnudge');
    expect(layer?.querySelector('img.rnudge-art')).toBeTruthy();
    // 沒有 backdrop 元素——側邊卡不遮內容
    expect(document.querySelector('.rnudge-backdrop')).toBeNull();
  });

  it('Provider 外呼叫 useReaderNudge 是 no-op，不丟錯', () => {
    expect(() =>
      render(<RestTrigger onAcknowledge={() => {}} />)
    ).not.toThrow();
    expect(() => screen.getByText('提交休息提醒').click()).not.toThrow();
  });
});
