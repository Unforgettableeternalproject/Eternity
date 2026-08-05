/**
 * GuideRunner 測試（2026-08-04 改為事件驅動後重寫）
 *
 * 核心契約：收到請求才播、播放前先開島、等島 mount 才量 anchor、
 * 守門（停用／手機／無教學）一律不播、顯示中失去資格要收掉，
 * 以及 latch——請求早於元件 mount 時不能掉。
 *
 * 識別證（2026-08-05）走同一條通道但守門不同：不歸浮島規則管，只要人在；
 * 而且它是**唯一**會寫「看過了」的對象（觸發源是會反覆發生的登入）。
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import GuideRunner from '../GuideRunner';
import { requestGuide, _resetGuideRequestForTest } from '../guideRequest';
import { IDENT_GUIDE_FLAG, IDENT_OPEN_EVENT } from '../identGuide';

/* hoisted：islandRuntime 在 import 當下就會問 getReaderAuth().isLoggedIn()，
   一般的 const 那時還在暫時性死區 */
const state = vi.hoisted(() => ({
  canUse: true,
  desktop: true,
  unlocked: ['history'] as string[],
  disabled: [] as string[],
  hasGuide: true,
  loggedIn: true,
}));

const openIsland = vi.fn();
const grantFlags = vi.fn();

vi.mock('../../../auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../auth')>()),
  useReaderAuth: () => (state.loggedIn ? { username: 'test' } : null),
  getReaderAuth: () => ({
    isLoggedIn: () => state.loggedIn,
    // islandRuntime 在模組層級訂閱 auth
    subscribe: () => () => {},
  }),
}));

vi.mock('../../../progress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../progress')>();
  return {
    ...actual,
    useProgress: () => ({
      islandsUnlocked: state.unlocked,
      islandsDisabled: state.disabled,
    }),
    getProgressManager: () => ({ grantFlags }),
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

/** 島根節點——waitForGuideRoot 找的就是它 */
function mountIslandRoot(id: string) {
  const el = document.createElement('div');
  el.className = `uep-island uep-island--${id}`;
  document.body.appendChild(el);
}

/** 識別證的根節點 */
function mountIdentRoot() {
  const el = document.createElement('div');
  el.className = 'uep-ident';
  document.body.appendChild(el);
}

/** 推進等島 mount 的 rAF 迴圈 */
async function settle(ms = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('GuideRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    _resetGuideRequestForTest();
    state.canUse = true;
    state.desktop = true;
    state.unlocked = ['history'];
    state.disabled = [];
    state.hasGuide = true;
    state.loggedIn = true;
    openIsland.mockClear();
    grantFlags.mockClear();
    mountIslandRoot('history');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('沒有請求時什麼都不做', async () => {
    render(<GuideRunner />);
    await settle();
    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(openIsland).not.toHaveBeenCalled();
  });

  it('收到請求 → 先開島再播', async () => {
    render(<GuideRunner />);
    await act(async () => {
      requestGuide('history');
    });
    await settle();

    expect(openIsland).toHaveBeenCalledWith('history');
    expect(screen.getByText('history 第一步')).toBeTruthy();
  });

  /**
   * ⚠️ 這一段模擬 **IslandHost 的真實結構**：`activeIds.length === 0` 時
   * 整個 Host return null，所以第一座島解鎖**之前** GuideRunner 根本
   * 沒有 mount。解鎖儀式的請求發生在那個當下，若請求就地丟掉，
   * 第一座島——最需要教學的那一次——永遠等不到。
   */
  it('請求早於元件 mount 時不會掉（latch）', async () => {
    const { rerender } = render(<div />);
    await act(async () => {
      requestGuide('history');
    });

    await act(async () => {
      rerender(<GuideRunner />);
    });
    await settle();

    expect(screen.getByText('history 第一步')).toBeTruthy();
  });

  it('latch 只補播一次——重新 mount 不會又跳出來', async () => {
    const { rerender, unmount } = render(<div />);
    await act(async () => {
      requestGuide('history');
    });
    await act(async () => {
      rerender(<GuideRunner />);
    });
    await settle();
    unmount();

    render(<GuideRunner />);
    await settle();
    expect(screen.queryByText('history 第一步')).toBeNull();
  });

  it('島還沒 mount 就逾時作廢', async () => {
    document.body.innerHTML = '';
    render(<GuideRunner />);
    await act(async () => {
      requestGuide('history');
    });
    await settle(4000);

    expect(screen.queryByText('history 第一步')).toBeNull();
  });

  it('島已停用時請求無效', async () => {
    state.disabled = ['history'];
    render(<GuideRunner />);
    await act(async () => {
      requestGuide('history');
    });
    await settle();

    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(openIsland).not.toHaveBeenCalled();
  });

  it('手機視窗不播', async () => {
    state.desktop = false;
    render(<GuideRunner />);
    await act(async () => {
      requestGuide('history');
    });
    await settle();

    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(openIsland).not.toHaveBeenCalled();
  });

  it('沒有寫教學的島不播', async () => {
    state.hasGuide = false;
    render(<GuideRunner />);
    await act(async () => {
      requestGuide('history');
    });
    await settle();

    expect(screen.queryByText('history 第一步')).toBeNull();
    expect(openIsland).not.toHaveBeenCalled();
  });

  it('顯示中被停用該島 → 收掉', async () => {
    const { rerender } = render(<GuideRunner />);
    await act(async () => {
      requestGuide('history');
    });
    await settle();
    expect(screen.getByText('history 第一步')).toBeTruthy();

    state.disabled = ['history'];
    await act(async () => {
      rerender(<GuideRunner />);
    });

    expect(screen.queryByText('history 第一步')).toBeNull();
  });

  it('走完最後一步就收掉，不留任何待播狀態', async () => {
    render(<GuideRunner />);
    await act(async () => {
      requestGuide('history');
    });
    await settle();

    await act(async () => screen.getByText('下一步').click());
    await act(async () => screen.getByText('知道了').click());
    expect(screen.queryByText('history 第一步')).toBeNull();

    // 沒有任何持久紀錄，所以再請求一次就會再播——回顧入口正是靠這個
    await act(async () => {
      requestGuide('history');
    });
    await settle();
    expect(screen.getByText('history 第一步')).toBeTruthy();
  });

  describe('識別證', () => {
    beforeEach(() => {
      mountIdentRoot();
    });

    it('請求時發出翻開事件並播放', async () => {
      const opened = vi.fn();
      window.addEventListener(IDENT_OPEN_EVENT, opened);
      render(<GuideRunner />);
      await act(async () => {
        requestGuide('ident');
      });
      await settle();
      window.removeEventListener(IDENT_OPEN_EVENT, opened);

      expect(opened).toHaveBeenCalled();
      expect(screen.getByText('ident 第一步')).toBeTruthy();
      // 識別證不歸 islandRuntime 管，不該去開任何島
      expect(openIsland).not.toHaveBeenCalled();
    });

    it('未登入時不播——識別證是登入者才有的東西', async () => {
      state.loggedIn = false;
      render(<GuideRunner />);
      await act(async () => {
        requestGuide('ident');
      });
      await settle();

      expect(screen.queryByText('ident 第一步')).toBeNull();
    });

    it('島全被停用也照播——它不歸浮島規則管', async () => {
      state.canUse = false;
      state.unlocked = [];
      render(<GuideRunner />);
      await act(async () => {
        requestGuide('ident');
      });
      await settle();

      expect(screen.getByText('ident 第一步')).toBeTruthy();
    });

    it('走完最後一步寫下「看過了」旗標', async () => {
      render(<GuideRunner />);
      await act(async () => {
        requestGuide('ident');
      });
      await settle();

      await act(async () => screen.getByText('下一步').click());
      await act(async () => screen.getByText('知道了').click());
      expect(grantFlags).toHaveBeenCalledWith([IDENT_GUIDE_FLAG]);
    });

    it('略過教學同樣算看過', async () => {
      render(<GuideRunner />);
      await act(async () => {
        requestGuide('ident');
      });
      await settle();

      await act(async () => screen.getByText('略過教學').click());
      expect(grantFlags).toHaveBeenCalledWith([IDENT_GUIDE_FLAG]);
    });

    it('Escape 不算看過——下次登入還會再給一次', async () => {
      render(<GuideRunner />);
      await act(async () => {
        requestGuide('ident');
      });
      await settle();

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(grantFlags).not.toHaveBeenCalled();
    });

    it('浮島教學走完不寫任何旗標', async () => {
      render(<GuideRunner />);
      await act(async () => {
        requestGuide('history');
      });
      await settle();

      await act(async () => screen.getByText('下一步').click());
      await act(async () => screen.getByText('知道了').click());
      expect(grantFlags).not.toHaveBeenCalled();
    });
  });

  it('Escape 關掉後不會自己補播', async () => {
    render(<GuideRunner />);
    await act(async () => {
      requestGuide('history');
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
