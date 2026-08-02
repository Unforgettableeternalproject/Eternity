/**
 * IslandGuideAuto 測試
 *
 * 核心契約：多島 unseen 只排一座且順序決定性、每 tab session 上限一次、
 * 自動開島後才量 anchor、守門失效即取消且不消耗額度、完成／略過／Escape
 * 的 seen 差異。
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import IslandGuideAuto from '../IslandGuideAuto';

const SESSION_KEY = 'uep-island-guide-auto-shown';

const state = {
  canUse: true,
  desktop: true,
  unlocked: ['history', 'echoes'] as string[],
  disabled: [] as string[],
  seen: [] as string[],
};

const markSeen = vi.fn();
let progressListener: ((s: unknown, d: { source: string }) => void) | null =
  null;
const openIsland = vi.fn();

vi.mock('../../../progress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../progress')>();
  return {
    ...actual,
    useProgress: () => ({
      islandsUnlocked: state.unlocked,
      islandsDisabled: state.disabled,
      islandGuidesSeen: state.seen,
    }),
    getProgressManager: () => ({
      markIslandGuideSeen: markSeen,
      subscribe: (fn: (s: unknown, d: { source: string }) => void) => {
        progressListener = fn;
        return () => {
          progressListener = null;
        };
      },
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

/** 三座島都有教學，讓「挑第一個」的順序真的被測到 */
vi.mock('../guideSteps', async () => {
  const actual =
    await vi.importActual<typeof import('../guideSteps')>('../guideSteps');
  return {
    ...actual,
    hasGuide: () => true,
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

/** 推進排程：延遲 + 等島 mount 的 rAF 迴圈 */
async function runSchedule(ms = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('IslandGuideAuto', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    document.body.innerHTML = '';
    state.canUse = true;
    state.desktop = true;
    state.unlocked = ['history', 'echoes'];
    state.disabled = [];
    state.seen = [];
    markSeen.mockClear();
    openIsland.mockClear();
    mountIslandRoot('history');
    mountIslandRoot('echoes');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('多島 unseen 只播一座，且依 ISLAND_IDS 的順序而非解鎖順序', async () => {
    // 解鎖清單刻意把 echoes 放前面——若照它挑就會播錯島
    state.unlocked = ['echoes', 'history'];
    render(<IslandGuideAuto />);
    await runSchedule();

    expect(screen.getByText('history 第一步')).toBeTruthy();
    expect(screen.queryByText('echoes 第一步')).toBeNull();
  });

  it('播放前先把島打開', async () => {
    render(<IslandGuideAuto />);
    await runSchedule();
    expect(openIsland).toHaveBeenCalledWith('history');
  });

  it('已 seen 的島跳過，換下一座', async () => {
    state.seen = ['history'];
    render(<IslandGuideAuto />);
    await runSchedule();
    expect(screen.getByText('echoes 第一步')).toBeTruthy();
  });

  it('每個 tab session 只自動播一次', async () => {
    sessionStorage.setItem(SESSION_KEY, 'true');
    render(<IslandGuideAuto />);
    await runSchedule();
    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(openIsland).not.toHaveBeenCalled();
  });

  it('顯示時才寫 session key——排程被取消不該消耗額度', async () => {
    state.canUse = false;
    render(<IslandGuideAuto />);
    await runSchedule();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('島還沒 mount 就逾時作廢，不寫 session key', async () => {
    document.body.innerHTML = '';
    render(<IslandGuideAuto />);
    await runSchedule(4000);
    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('剛解鎖的島要等甦醒動畫演完才開始', async () => {
    // 從「一座都還沒解鎖」起步，否則 mount 當下就先排了一輪 delay=0
    state.unlocked = [];
    const { rerender } = render(<IslandGuideAuto />);
    await runSchedule();
    expect(screen.queryByText('history 第一步')).toBeNull();

    // 解鎖：store 的 listener 同步先跑，React 重渲染在其後
    state.unlocked = ['history'];
    await act(async () => {
      progressListener?.({}, { source: 'island-unlocked' });
      rerender(<IslandGuideAuto />);
    });

    // AWAKEN_MS 是 1400——甦醒動畫還沒演完就蓋教學等於把剛給的東西搶走
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(screen.queryByText('history 第一步')).toBeNull();

    await runSchedule();
    expect(screen.getByText('history 第一步')).toBeTruthy();
  });

  it('完成最後一步寫 seen', async () => {
    render(<IslandGuideAuto />);
    await runSchedule();

    await act(async () => screen.getByText('下一步').click());
    await act(async () => screen.getByText('知道了').click());
    expect(markSeen).toHaveBeenCalledWith('history');
  });

  it('略過教學同樣寫 seen', async () => {
    render(<IslandGuideAuto />);
    await runSchedule();

    await act(async () => screen.getByText('略過教學').click());
    expect(markSeen).toHaveBeenCalledWith('history');
  });

  it('Escape 不寫 seen，但本 session 不再自動打擾', async () => {
    render(<IslandGuideAuto />);
    await runSchedule();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(markSeen).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(SESSION_KEY)).toBe('true');
    expect(screen.queryByText('history 第一步')).toBeNull();
  });

  it('顯示中被停用該島 → 收掉且不寫 seen', async () => {
    const { rerender } = render(<IslandGuideAuto />);
    await runSchedule();
    expect(screen.getByText('history 第一步')).toBeTruthy();

    state.disabled = ['history'];
    await act(async () => {
      rerender(<IslandGuideAuto />);
    });

    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('手機視窗不自動播', async () => {
    state.desktop = false;
    render(<IslandGuideAuto />);
    await runSchedule();
    expect(screen.queryByText('history 第一步')).toBeNull();
  });
});
