/**
 * 教學回顧測試
 *
 * 核心契約：回顧不受 session 上限與 seen 限制、不改寫 seen；
 * 面板只在「已解鎖且啟用中」的列給回顧鈕。
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import IslandGuideAuto from '../IslandGuideAuto';
import { requestGuideReplay } from '../guideReplay';

const SESSION_KEY = 'uep-island-guide-auto-shown';

const state = {
  canUse: true,
  desktop: true,
  unlocked: ['history'] as string[],
  disabled: [] as string[],
  seen: ['history'] as string[],
};

const markSeen = vi.fn();
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
      subscribe: () => () => {},
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
    hasGuide: () => true,
    getGuideSteps: (id: string) => [
      { anchor: () => null, title: `${id} 第一步`, body: '說明' },
    ],
  };
});

function mountIslandRoot(id: string) {
  const el = document.createElement('div');
  el.className = `uep-island uep-island--${id}`;
  document.body.appendChild(el);
}

async function runSchedule(ms = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('教學回顧', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    document.body.innerHTML = '';
    state.canUse = true;
    state.desktop = true;
    state.unlocked = ['history'];
    state.disabled = [];
    state.seen = ['history'];
    markSeen.mockClear();
    openIsland.mockClear();
    mountIslandRoot('history');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('已 seen 且已用掉 session 額度時，回顧仍能重播', async () => {
    sessionStorage.setItem(SESSION_KEY, 'true');
    render(<IslandGuideAuto />);
    await runSchedule();
    // 自動播放這時什麼都不會做
    expect(screen.queryByText('history 第一步')).toBeNull();

    await act(async () => {
      requestGuideReplay('history');
    });
    await runSchedule();

    expect(screen.getByText('history 第一步')).toBeTruthy();
    expect(openIsland).toHaveBeenCalledWith('history');
  });

  it('回顧走完不改寫 seen——它只是重播', async () => {
    render(<IslandGuideAuto />);
    await act(async () => {
      requestGuideReplay('history');
    });
    await runSchedule();

    await act(async () => screen.getByText('知道了').click());
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('島已停用時回顧請求無效', async () => {
    state.disabled = ['history'];
    render(<IslandGuideAuto />);
    await act(async () => {
      requestGuideReplay('history');
    });
    await runSchedule();

    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(openIsland).not.toHaveBeenCalled();
  });
});
