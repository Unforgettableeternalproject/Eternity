/**
 * Concepts 解鎖儀式「斷線的終端」測試（S9-B）
 *
 * 四態呈現 + 確認流程（接受／取消）。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UnlockEligibility } from '../../../islands/unlockRitual';

const ritualMock = vi.hoisted(() => ({
  eligibility: {
    canUse: true,
    visited: true,
    unlocked: false,
    eligible: true,
  } as UnlockEligibility,
  complete: vi.fn(),
}));
vi.mock('../../../islands', () => ({
  // 真值 1400ms 會拖慢測試；但也不能太短——「動畫播完才解鎖」這條斷言
  // 需要足夠裕度，否則 waitFor 抓到 CONNECTING 時計時器已經到期，
  // 測試會誤報成「點了就立刻解鎖」。
  AWAKEN_MS: 300,
  useUnlockEligibility: () => ritualMock.eligibility,
  completeUnlockRitual: ritualMock.complete,
}));

const dialogMock = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('../../ui/UepDialog', () => ({
  uepDialog: { confirm: dialogMock.confirm },
}));

import ConceptsTerminalBadge from '../ConceptsTerminalBadge';

function setEligibility(partial: Partial<UnlockEligibility>) {
  ritualMock.eligibility = {
    canUse: true,
    unlocked: false,
    eligible: false,
    ...partial,
  };
}

beforeEach(() => {
  ritualMock.complete.mockClear();
  dialogMock.confirm.mockReset();
  setEligibility({ eligible: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConceptsTerminalBadge — 四態', () => {
  it('有資格未解鎖 → 紅色 DISCONNECTED 且可點', () => {
    render(<ConceptsTerminalBadge />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('DISCONNECTED');
    expect(btn.className).toContain('is-disconnected');
  });

  it('已解鎖 → CONNECTED，不可點', () => {
    setEligibility({ eligible: false, unlocked: true });
    render(<ConceptsTerminalBadge />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/CONNECTED/)).toBeTruthy();
  });

  it('無資格 → 只留提示符，不出現任何狀態字樣', () => {
    setEligibility({ canUse: false, eligible: false, unlocked: false });
    render(<ConceptsTerminalBadge />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/CONNECTED/)).toBeNull();
    expect(screen.queryByText(/DISCONNECTED/)).toBeNull();
    expect(screen.getByText('$ root@uep:~')).toBeTruthy();
  });

  it('未登入訪客看到的與觀測者相同（都只有提示符）', () => {
    setEligibility({ canUse: false, eligible: false });
    render(<ConceptsTerminalBadge />);
    expect(screen.getByText('$ root@uep:~').className).toContain('is-idle');
  });
});

describe('ConceptsTerminalBadge — 連線儀式', () => {
  it('確認後進 CONNECTING… 並在動畫結束時解鎖', async () => {
    dialogMock.confirm.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<ConceptsTerminalBadge />);

    await user.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByText(/CONNECTING/)).toBeTruthy();
    });
    // 此時尚未解鎖——儀式動畫還在跑
    expect(ritualMock.complete).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(ritualMock.complete).toHaveBeenCalledWith('concepts');
    });
  });

  it('取消 → 維持 DISCONNECTED，不解鎖', async () => {
    dialogMock.confirm.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<ConceptsTerminalBadge />);

    await user.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(dialogMock.confirm).toHaveBeenCalled();
    });
    expect(ritualMock.complete).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveTextContent('DISCONNECTED');
  });

  it('優先走 window bridge 的 dialog manager，而不是 import 進來的那份', async () => {
    // 這是 07/25 一驗「點了沒反應」的根因：ConceptsReader 是 client:only 的
    // island，UepDialogContainer 掛在 DesignLayout 的 client:idle——兩個
    // bundle 各有一份 module-level 單例。呼叫 import 的那份，訂閱在另一份上的
    // container 永遠收不到，promise 就這麼掛著。
    const bridgeConfirm = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('__uepDialogManager', { confirm: bridgeConfirm });

    render(<ConceptsTerminalBadge />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(bridgeConfirm).toHaveBeenCalled();
    });
    expect(dialogMock.confirm).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('確認對話框走終端機變體', async () => {
    dialogMock.confirm.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<ConceptsTerminalBadge />);

    await user.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(dialogMock.confirm).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ variant: 'terminal' })
      );
    });
  });
});
