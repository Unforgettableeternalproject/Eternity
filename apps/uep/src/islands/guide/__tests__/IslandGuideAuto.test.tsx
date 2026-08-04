/**
 * IslandGuideAuto 測試（2026-08-04 改為事件驅動後重寫）
 *
 * 核心契約：收到請求才播、播放前先開島、等島 mount 才量 anchor、
 * 守門（停用／手機／無教學）一律不播、顯示中失去資格要收掉，
 * 以及 latch——請求早於元件 mount 時不能掉。
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import IslandGuideAuto from '../IslandGuideAuto';
import { requestIslandGuide, _resetGuideRequestForTest } from '../guideRequest';

const state = {
  canUse: true,
  desktop: true,
  unlocked: ['history'] as string[],
  disabled: [] as string[],
  hasGuide: true,
};

const openIsland = vi.fn();

vi.mock('../../../progress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../progress')>();
  return {
    ...actual,
    useProgress: () => ({
      islandsUnlocked: state.unlocked,
      islandsDisabled: state.disabled,
    }),
  };
});

vi.mock('../../islandRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../islandRuntime')>();
  return {
    ...actual,
    canUseIslands: () => state.canUse,
    shouldMountIsland: (_p: unknown, id: string) =>
      state.canUse &&
      state.unlocked.includes(id) &&
      !state.disabled.includes(id),
    getIslandRuntime: () => ({
      open: openIsland,
      getState: () => ({ windows: {}, focusOrder: [] }),
    }),
  };
});

vi.mock('../../useIslands', () => ({
  useDesktopIslandViewport: () => state.desktop,
}));

vi.mock('../guideSteps', async () => {
  const actual =
    await vi.importActual<typeof import('../guideSteps')>('../guideSteps');
  return {
    ...actual,
    hasGuide: () => state.hasGuide,
    getGuideSteps: (id: string) => [
      { anchor: () => null, title: `${id} 第一步`, body: '說明' },
      { anchor: () => null, title: `${id} 第二步`, body: '說明' },
    ],
  };
});

/** 島根節點——waitForIslandRoot 找的就是它 */
function mountIslandRoot(id: string) {
  const el = document.createElement('div');
  el.className = `uep-island uep-island--${id}`;
  document.body.appendChild(el);
}

/** 推進等島 mount 的 rAF 迴圈 */
async function settle(ms = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('IslandGuideAuto', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    _resetGuideRequestForTest();
    state.canUse = true;
    state.desktop = true;
    state.unlocked = ['history'];
    state.disabled = [];
    state.hasGuide = true;
    openIsland.mockClear();
    mountIslandRoot('history');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('沒有請求時什麼都不做', async () => {
    render(<IslandGuideAuto />);
    await settle();
    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(openIsland).not.toHaveBeenCalled();
  });

  it('收到請求 → 先開島再播', async () => {
    render(<IslandGuideAuto />);
    await act(async () => {
      requestIslandGuide('history');
    });
    await settle();

    expect(openIsland).toHaveBeenCalledWith('history');
    expect(screen.getByText('history 第一步')).toBeTruthy();
  });

  /**
   * ⚠️ 這一段模擬 **IslandHost 的真實結構**：`activeIds.length === 0` 時
   * 整個 Host return null，所以第一座島解鎖**之前** IslandGuideAuto 根本
   * 沒有 mount。解鎖儀式的請求發生在那個當下，若請求就地丟掉，
   * 第一座島——最需要教學的那一次——永遠等不到。
   */
  it('請求早於元件 mount 時不會掉（latch）', async () => {
    const { rerender } = render(<div />);
    await act(async () => {
      requestIslandGuide('history');
    });

    await act(async () => {
      rerender(<IslandGuideAuto />);
    });
    await settle();

    expect(screen.getByText('history 第一步')).toBeTruthy();
  });

  it('latch 只補播一次——重新 mount 不會又跳出來', async () => {
    const { rerender, unmount } = render(<div />);
    await act(async () => {
      requestIslandGuide('history');
    });
    await act(async () => {
      rerender(<IslandGuideAuto />);
    });
    await settle();
    unmount();

    render(<IslandGuideAuto />);
    await settle();
    expect(screen.queryByText('history 第一步')).toBeNull();
  });

  it('島還沒 mount 就逾時作廢', async () => {
    document.body.innerHTML = '';
    render(<IslandGuideAuto />);
    await act(async () => {
      requestIslandGuide('history');
    });
    await settle(4000);

    expect(screen.queryByText('history 第一步')).toBeNull();
  });

  it('島已停用時請求無效', async () => {
    state.disabled = ['history'];
    render(<IslandGuideAuto />);
    await act(async () => {
      requestIslandGuide('history');
    });
    await settle();

    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(openIsland).not.toHaveBeenCalled();
  });

  it('手機視窗不播', async () => {
    state.desktop = false;
    render(<IslandGuideAuto />);
    await act(async () => {
      requestIslandGuide('history');
    });
    await settle();

    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(openIsland).not.toHaveBeenCalled();
  });

  it('沒有寫教學的島不播', async () => {
    state.hasGuide = false;
    render(<IslandGuideAuto />);
    await act(async () => {
      requestIslandGuide('history');
    });
    await settle();

    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(openIsland).not.toHaveBeenCalled();
  });

  it('顯示中被停用該島 → 收掉', async () => {
    const { rerender } = render(<IslandGuideAuto />);
    await act(async () => {
      requestIslandGuide('history');
    });
    await settle();
    expect(screen.getByText('history 第一步')).toBeTruthy();

    state.disabled = ['history'];
    await act(async () => {
      rerender(<IslandGuideAuto />);
    });

    expect(screen.queryByText('history 第一步')).toBeNull();
  });

  it('走完最後一步就收掉，不留任何待播狀態', async () => {
    render(<IslandGuideAuto />);
    await act(async () => {
      requestIslandGuide('history');
    });
    await settle();

    await act(async () => screen.getByText('下一步').click());
    await act(async () => screen.getByText('知道了').click());
    expect(screen.queryByText('history 第一步')).toBeNull();

    // 沒有任何持久紀錄，所以再請求一次就會再播——回顧入口正是靠這個
    await act(async () => {
      requestIslandGuide('history');
    });
    await settle();
    expect(screen.getByText('history 第一步')).toBeTruthy();
  });

  it('Escape 關掉後不會自己補播', async () => {
    render(<IslandGuideAuto />);
    await act(async () => {
      requestIslandGuide('history');
    });
    await settle();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByText('history 第一步')).toBeNull();

    await settle();
    expect(screen.queryByText('history 第一步')).toBeNull();
  });
});
