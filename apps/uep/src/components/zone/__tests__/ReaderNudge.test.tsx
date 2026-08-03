/**
 * ReaderNudge 測試
 *
 * 核心契約：AFK 與休息提醒共用一層但不疊卡、兩者都要按下確認才消失
 * （活動事件關不掉——AFK 的閂鎖不隨 idle 解除）、idleNudgeMode 只關提示
 * 不關量測。
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { stopActivityWatch } from '../../../lib/activityWatch';
import { clearUepSettingsCache } from '../../../lib/uepSettings';
import { ReaderNudgeProvider, useReaderNudge } from '../ReaderNudge';

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

async function idleOut() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(THRESHOLD_SEC * 1000);
  });
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
    stopActivityWatch();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('閒置超過閾值時跳出 AFK 卡，按下確認才消失', async () => {
    render(
      <ReaderNudgeProvider>
        <div>內容</div>
      </ReaderNudgeProvider>
    );
    await settle();

    expect(screen.queryByText('你還在嗎')).toBeNull();
    await idleOut();
    expect(screen.getByText('你還在嗎')).toBeTruthy();

    await act(async () => {
      screen.getByText('我還在').click();
    });
    expect(screen.queryByText('你還在嗎')).toBeNull();
  });

  /**
   * 這是 2026-08-03 反轉舊契約的理由本身：從 DevTools 觸發後，使用者必須
   * 動滑鼠去關掉 DevTools 視窗，舊版的「動一下就消失」會讓卡片在被看清楚
   * 之前就自己收掉。
   */
  it('AFK 卡的閂鎖不隨活動事件解除', async () => {
    render(
      <ReaderNudgeProvider>
        <div>內容</div>
      </ReaderNudgeProvider>
    );
    await settle();
    await idleOut();
    expect(screen.getByText('你還在嗎')).toBeTruthy();

    await poke();
    expect(screen.getByText('你還在嗎')).toBeTruthy();
  });

  it('AFK 卡是 modal：有 backdrop、有確認鈕、焦點落在鈕上', async () => {
    render(
      <ReaderNudgeProvider>
        <div>內容</div>
      </ReaderNudgeProvider>
    );
    await settle();
    await idleOut();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.classList.contains('rnudge--afk')).toBe(true);

    const action = screen.getByText('我還在');
    expect(document.activeElement).toBe(action);
  });

  it('確認後重新起算，再次閒置會再跳一次', async () => {
    render(
      <ReaderNudgeProvider>
        <div>內容</div>
      </ReaderNudgeProvider>
    );
    await settle();
    await idleOut();

    await act(async () => {
      screen.getByText('我還在').click();
    });
    expect(screen.queryByText('你還在嗎')).toBeNull();

    await idleOut();
    expect(screen.getByText('你還在嗎')).toBeTruthy();
  });

  it('idleNudgeMode=disabled 不顯示提示卡', async () => {
    mockSettings({ 'reader.idleNudgeMode': 'disabled' });
    render(
      <ReaderNudgeProvider>
        <div>內容</div>
      </ReaderNudgeProvider>
    );
    await settle();
    await idleOut();

    expect(screen.queryByText('你還在嗎')).toBeNull();
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
    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('rnudge--rest')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    await poke();
    expect(screen.getByText('讀了一陣子了')).toBeTruthy();

    await act(async () => {
      screen.getByText('知道了').click();
    });
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('讀了一陣子了')).toBeNull();
  });

  it('兩者不疊卡：AFK 優先，確認之後休息提醒才現身', async () => {
    render(
      <ReaderNudgeProvider>
        <RestTrigger onAcknowledge={() => {}} />
      </ReaderNudgeProvider>
    );
    await settle();

    await idleOut();
    await act(async () => {
      screen.getByText('提交休息提醒').click();
    });

    expect(screen.getByText('你還在嗎')).toBeTruthy();
    expect(screen.queryByText('讀了一陣子了')).toBeNull();

    await act(async () => {
      screen.getByText('我還在').click();
    });
    expect(screen.queryByText('你還在嗎')).toBeNull();
    expect(screen.getByText('讀了一陣子了')).toBeTruthy();
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

  it('Provider 外呼叫 useReaderNudge 是 no-op，不丟錯', () => {
    expect(() =>
      render(<RestTrigger onAcknowledge={() => {}} />)
    ).not.toThrow();
    expect(() => screen.getByText('提交休息提醒').click()).not.toThrow();
  });
});
