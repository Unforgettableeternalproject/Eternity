/**
 * 解鎖儀式共通兩端測試（S9-B）
 *
 * 驗證：
 * - useUnlockEligibility 四關拆解（可用／已到訪／已解鎖／eligible）
 * - 非浮島 zone（portal）一律全假
 * - completeUnlockRitual 收束：解鎖 + 展開 + toast，且三者各自可關
 */

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInitialState } from '../../progress/types';
import type { ProgressState } from '../../progress/types';

/* canUseIslands 含登入判定；預設已登入 */
const authMock = vi.hoisted(() => ({ loggedIn: true }));
vi.mock('../../auth', () => ({
  getReaderAuth: () => ({
    isLoggedIn: () => authMock.loggedIn,
    subscribe: () => () => {},
  }),
  useReaderAuth: () => null,
}));

/* useProgress 直接餵狀態，不碰真的 store。其餘 progress 匯出保持原樣——
   islandRuntime 也從這個模組取 PROGRESS_CHANGE_EVENT 等常數。
   getProgressManager 也要餵：completeUnlockRitual 的完成時資格重驗走的是
   它而不是 hook（收束發生在 React 渲染之外的計時器裡）。 */
const progressMock = vi.hoisted(() => ({
  state: null as ProgressState | null,
  unlockIsland: vi.fn(),
}));
vi.mock('../../progress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../progress')>()),
  useProgress: () => progressMock.state,
  getProgressManager: () => ({
    getState: () => progressMock.state,
    unlockIsland: progressMock.unlockIsland,
  }),
}));

import { completeUnlockRitual, useUnlockEligibility } from '../unlockRitual';

function stateWith(partial: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...partial };
}

/** 探索者 + 已到訪 concepts + 尚未解鎖 = 完整資格 */
function eligibleState(): ProgressState {
  return stateWith({
    view: 'explorer',
    flags: ['zone:visited:concepts'],
    islandsUnlocked: [],
  });
}

beforeEach(() => {
  authMock.loggedIn = true;
  progressMock.state = eligibleState();
  // 桌面寬度（浮島是桌面專屬功能）
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useUnlockEligibility', () => {
  it('四關齊備時 eligible', () => {
    const { result } = renderHook(() => useUnlockEligibility('concepts'));
    expect(result.current).toEqual({
      canUse: true,
      visited: true,
      unlocked: false,
      eligible: true,
    });
  });

  it('未登入 → 不可用，eligible 為假', () => {
    authMock.loggedIn = false;
    const { result } = renderHook(() => useUnlockEligibility('concepts'));
    expect(result.current.canUse).toBe(false);
    expect(result.current.eligible).toBe(false);
  });

  it('觀測者視角 → 不可用', () => {
    progressMock.state = stateWith({
      view: 'observer',
      flags: ['zone:visited:concepts'],
    });
    const { result } = renderHook(() => useUnlockEligibility('concepts'));
    expect(result.current.canUse).toBe(false);
    expect(result.current.eligible).toBe(false);
  });

  it('未到訪該 zone → visited 假、eligible 假', () => {
    progressMock.state = stateWith({ view: 'explorer', flags: [] });
    const { result } = renderHook(() => useUnlockEligibility('concepts'));
    expect(result.current.canUse).toBe(true);
    expect(result.current.visited).toBe(false);
    expect(result.current.eligible).toBe(false);
  });

  it('已解鎖 → unlocked 真、eligible 假（儀式收工）', () => {
    progressMock.state = stateWith({
      view: 'explorer',
      flags: ['zone:visited:concepts'],
      islandsUnlocked: ['concepts'],
    });
    const { result } = renderHook(() => useUnlockEligibility('concepts'));
    expect(result.current.unlocked).toBe(true);
    expect(result.current.eligible).toBe(false);
  });

  it('旗標只認自己那個 zone', () => {
    progressMock.state = stateWith({
      view: 'explorer',
      flags: ['zone:visited:echoes'],
    });
    const { result } = renderHook(() => useUnlockEligibility('concepts'));
    expect(result.current.visited).toBe(false);
  });

  it('非浮島 zone（portal）一律全假', () => {
    const { result } = renderHook(() => useUnlockEligibility('portal'));
    expect(result.current).toEqual({
      canUse: false,
      visited: false,
      unlocked: false,
      eligible: false,
    });
  });
});

describe('completeUnlockRitual', () => {
  const unlockIsland = progressMock.unlockIsland;
  const open = vi.fn();
  const info = vi.fn();

  beforeEach(() => {
    unlockIsland.mockClear();
    open.mockClear();
    info.mockClear();
    // 收束會重驗「到訪過該 zone」，各 case 解鎖的島不同，一次全給
    progressMock.state = stateWith({
      view: 'explorer',
      flags: [
        'zone:visited:concepts',
        'zone:visited:echoes',
        'zone:visited:visuals',
        'zone:visited:storage',
      ],
      islandsUnlocked: [],
    });
    vi.stubGlobal('__uepProgress', { unlockIsland });
    vi.stubGlobal('__uepIslands', {
      open,
      subscribe: () => () => {},
      getState: () => ({ windows: {} }),
    });
    vi.stubGlobal('__uepToastManager', { info });
  });

  it('預設：解鎖 + 展開 + 報喜', () => {
    completeUnlockRitual('concepts');
    expect(unlockIsland).toHaveBeenCalledWith('concepts');
    expect(open).toHaveBeenCalledWith('concepts');
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('open:false → 只解鎖不展開', () => {
    completeUnlockRitual('storage', { open: false });
    expect(unlockIsland).toHaveBeenCalledWith('storage');
    expect(open).not.toHaveBeenCalled();
  });

  it('toast:null → 不報喜（儀式自帶視覺回饋時用）', () => {
    completeUnlockRitual('echoes', { toast: null });
    expect(unlockIsland).toHaveBeenCalledWith('echoes');
    expect(info).not.toHaveBeenCalled();
  });

  it('toast 可覆寫文案', () => {
    completeUnlockRitual('visuals', { toast: '畫框裡浮現了什麼。' });
    expect(info).toHaveBeenCalledWith('畫框裡浮現了什麼。');
  });

  it('資格齊備時回報成功', () => {
    expect(completeUnlockRitual('concepts')).toBe(true);
  });

  /* 發現與收束之間隔著對話框與 1.4 秒動畫，這段時間資格可能已經消失。
     resize 甚至不會 unmount Reader，計時器照樣走完（Codex 2026-07-25 review）。 */
  describe('完成時資格已失效 → 拒絕解鎖', () => {
    it('中途登出', () => {
      authMock.loggedIn = false;
      expect(completeUnlockRitual('concepts')).toBe(false);
      expect(unlockIsland).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    });

    it('中途切成觀測者', () => {
      progressMock.state = stateWith({
        view: 'observer',
        flags: ['zone:visited:concepts'],
      });
      expect(completeUnlockRitual('concepts')).toBe(false);
      expect(unlockIsland).not.toHaveBeenCalled();
    });

    it('中途縮到手機寬度', () => {
      vi.stubGlobal('innerWidth', 640);
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
      expect(completeUnlockRitual('concepts')).toBe(false);
      expect(unlockIsland).not.toHaveBeenCalled();
    });

    it('沒到訪過該 zone（旗標只認自己那個）', () => {
      progressMock.state = stateWith({
        view: 'explorer',
        flags: ['zone:visited:concepts'],
      });
      expect(completeUnlockRitual('storage')).toBe(false);
      expect(unlockIsland).not.toHaveBeenCalled();
    });
  });
});
