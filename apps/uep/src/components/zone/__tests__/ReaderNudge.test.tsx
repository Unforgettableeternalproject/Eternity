/**
 * ReaderNudge 測試
 *
 * 核心契約：AFK 與休息提醒共用一層但不疊卡、AFK 由 activityWatch 直接
 * 驅動、休息提醒要按下確認才消失（不被活動事件關掉）、idleNudgeMode
 * 只關提示不關量測。
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

  it('閒置超過閾值時淡入 AFK 卡，恢復活動即消失', async () => {
    render(
      <ReaderNudgeProvider>
        <div>內容</div>
      </ReaderNudgeProvider>
    );
    await settle();

    expect(screen.queryByText('你還在嗎')).toBeNull();
    await idleOut();
    expect(screen.getByText('你還在嗎')).toBeTruthy();

    await poke();
    expect(screen.queryByText('你還在嗎')).toBeNull();
  });

  it('AFK 卡沒有按鈕——動一下就是答案，不需要特定動作', async () => {
    render(
      <ReaderNudgeProvider>
        <div>內容</div>
      </ReaderNudgeProvider>
    );
    await settle();
    await idleOut();

    const card = screen.getByText('你還在嗎').closest('.rnudge');
    expect(card?.querySelector('button')).toBeNull();
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
    expect(screen.getByText('讀了一陣子了')).toBeTruthy();

    await poke();
    expect(screen.getByText('讀了一陣子了')).toBeTruthy();

    await act(async () => {
      screen.getByText('知道了').click();
    });
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('讀了一陣子了')).toBeNull();
  });

  it('兩者不疊卡：idle 時 AFK 優先，恢復活動後休息提醒才現身', async () => {
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

    await poke();
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
