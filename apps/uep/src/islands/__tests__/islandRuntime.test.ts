/**
 * Island Runtime 單元測試
 *
 * runtime 是 module singleton，每個測試前用 vi.resetModules() 取得全新實例，
 * 並清空 localStorage 與 window bridge（含 progress 的，因 runtime 依賴它）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { TERMINAL_LOG_KEY } from '../concepts/terminalLog';
import { islandStorageKey } from '../persistence';
import { ISLAND_SCHEMA_VERSION, ISLAND_Z_BASE } from '../types';

/* 浮島限已登入探索者（S7-C 定案）——mock auth，預設已登入，
   個別測試可切 authMock.loggedIn 驗登出行為。
   listeners 供登入轉變測試手動觸發 auth notify。 */
const authMock = vi.hoisted(() => ({
  loggedIn: true,
  listeners: [] as ((session: { token: string } | null) => void)[],
}));
vi.mock('../../auth', () => ({
  getReaderAuth: () => ({
    isLoggedIn: () => authMock.loggedIn,
    subscribe: (fn: (session: { token: string } | null) => void) => {
      authMock.listeners.push(fn);
      return () => {};
    },
  }),
}));

async function freshRuntime() {
  vi.resetModules();
  const mod = await import('../islandRuntime');
  return mod;
}

beforeEach(() => {
  authMock.loggedIn = true;
  authMock.listeners = [];
  window.localStorage.clear();
  delete window.__uepIslands;
  delete window.__uepProgress;
});

describe('bootstrap', () => {
  it('無既有資料時是空狀態', async () => {
    const { uepIslands } = await freshRuntime();
    expect(uepIslands.getState().windows).toEqual({});
    expect(uepIslands.getState().focusOrder).toEqual([]);
  });

  it('從 localStorage 還原視窗狀態，開著的島進焦點序', async () => {
    window.localStorage.setItem(
      islandStorageKey('history'),
      JSON.stringify({
        version: ISLAND_SCHEMA_VERSION,
        open: true,
        position: { left: 10, top: 20 },
        updatedAt: '2026-07-05T00:00:00.000Z',
      })
    );
    window.localStorage.setItem(
      islandStorageKey('storage'),
      JSON.stringify({
        version: ISLAND_SCHEMA_VERSION,
        open: false,
        position: null,
        updatedAt: '2026-07-05T00:00:00.000Z',
      })
    );
    const { uepIslands } = await freshRuntime();
    expect(uepIslands.getWindow('history')?.open).toBe(true);
    expect(uepIslands.getWindow('history')?.position).toEqual({
      left: 10,
      top: 20,
    });
    expect(uepIslands.getWindow('storage')?.open).toBe(false);
    expect(uepIslands.getState().focusOrder).toEqual(['history']);
  });

  it('毀損資料靜默跳過', async () => {
    window.localStorage.setItem(islandStorageKey('history'), '{broken!!');
    const { uepIslands } = await freshRuntime();
    expect(uepIslands.getWindow('history')).toBeNull();
  });
});

describe('open / close / toggle', () => {
  it('open 建立視窗狀態、進焦點序、持久化', async () => {
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    expect(uepIslands.getWindow('history')?.open).toBe(true);
    expect(uepIslands.getState().focusOrder).toEqual(['history']);
    const stored = JSON.parse(
      window.localStorage.getItem(islandStorageKey('history'))!
    );
    expect(stored.open).toBe(true);
  });

  it('close 收合並移出焦點序', async () => {
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    uepIslands.close('history');
    expect(uepIslands.getWindow('history')?.open).toBe(false);
    expect(uepIslands.getState().focusOrder).toEqual([]);
  });

  it('close 未開啟的島是 no-op（不寫入、不通知）', async () => {
    const { uepIslands } = await freshRuntime();
    const listener = vi.fn();
    uepIslands.subscribe(listener);
    uepIslands.close('echoes');
    expect(listener).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(islandStorageKey('echoes'))).toBeNull();
  });

  it('toggle 往返切換', async () => {
    const { uepIslands } = await freshRuntime();
    uepIslands.toggle('history');
    expect(uepIslands.getWindow('history')?.open).toBe(true);
    uepIslands.toggle('history');
    expect(uepIslands.getWindow('history')?.open).toBe(false);
  });

  it('重複 open 把島推回最上層而不重複', async () => {
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    uepIslands.open('storage');
    uepIslands.open('history');
    expect(uepIslands.getState().focusOrder).toEqual(['storage', 'history']);
  });
});

describe('collapseAll / 登入收合', () => {
  it('collapseAll 收合所有開啟島、清焦點序、持久化（位置保留）', async () => {
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    uepIslands.setPosition('history', { left: 10, top: 20 });
    uepIslands.open('concepts');
    uepIslands.collapseAll();
    expect(uepIslands.getWindow('history')?.open).toBe(false);
    expect(uepIslands.getWindow('concepts')?.open).toBe(false);
    expect(uepIslands.getState().focusOrder).toEqual([]);
    // 位置記錄不受收合影響
    expect(uepIslands.getWindow('history')?.position).toEqual({
      left: 10,
      top: 20,
    });
    const stored = JSON.parse(
      window.localStorage.getItem(islandStorageKey('history'))!
    );
    expect(stored.open).toBe(false);
    expect(stored.position).toEqual({ left: 10, top: 20 });
  });

  it('collapseAll 無開啟島時是 no-op（不通知）', async () => {
    const { uepIslands } = await freshRuntime();
    const listener = vi.fn();
    uepIslands.subscribe(listener);
    uepIslands.collapseAll();
    expect(listener).not.toHaveBeenCalled();
  });

  it('登入轉變（訪客→登入）觸發全島收合', async () => {
    authMock.loggedIn = false;
    // 上次 session 留下的「開著」狀態
    window.localStorage.setItem(
      islandStorageKey('history'),
      JSON.stringify({
        version: 1,
        open: true,
        position: null,
        updatedAt: '2026-07-05T00:00:00.000Z',
      })
    );
    const { uepIslands } = await freshRuntime();
    expect(uepIslands.getWindow('history')?.open).toBe(true);
    // 模擬登入：auth notify null→session 轉變
    authMock.loggedIn = true;
    authMock.listeners.forEach((fn) => fn({ token: 'x' }));
    expect(uepIslands.getWindow('history')?.open).toBe(false);
    expect(uepIslands.getState().focusOrder).toEqual([]);
  });

  it('頁面載入時已登入：後續 auth notify（如 refresh）不觸發收合', async () => {
    authMock.loggedIn = true;
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    // refresh() 之類的 notify：session 維持非 null
    authMock.listeners.forEach((fn) => fn({ token: 'x' }));
    expect(uepIslands.getWindow('history')?.open).toBe(true);
  });

  it('登出轉變（session→null）觸發全面重置（S7 驗收 #9）', async () => {
    authMock.loggedIn = true;
    window.localStorage.setItem(TERMINAL_LOG_KEY, '[]');
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    uepIslands.setPosition('history', { left: 10, top: 20 });
    // 登出：session → null → 視窗狀態（含位置）與 terminal 歷史全清
    authMock.loggedIn = false;
    authMock.listeners.forEach((fn) => fn(null));
    expect(uepIslands.getWindow('history')).toBeNull();
    expect(uepIslands.getState().focusOrder).toEqual([]);
    expect(window.localStorage.getItem(islandStorageKey('history'))).toBeNull();
    expect(window.localStorage.getItem(TERMINAL_LOG_KEY)).toBeNull();
  });
});

describe('resetAll / 進度重置清空小工具（S7 驗收 #9/#13）', () => {
  it('resetAll 清空 in-memory 狀態、localStorage 與 terminal 歷史', async () => {
    window.localStorage.setItem(TERMINAL_LOG_KEY, '[{"kind":"in","text":"$"}]');
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    uepIslands.open('concepts');
    uepIslands.setPosition('concepts', { left: 5, top: 5 });
    uepIslands.resetAll();
    expect(uepIslands.getState().windows).toEqual({});
    expect(uepIslands.getState().focusOrder).toEqual([]);
    expect(window.localStorage.getItem(islandStorageKey('history'))).toBeNull();
    expect(
      window.localStorage.getItem(islandStorageKey('concepts'))
    ).toBeNull();
    expect(window.localStorage.getItem(TERMINAL_LOG_KEY)).toBeNull();
  });

  it('resetAll 以 source=reset 通知訂閱者', async () => {
    const { uepIslands } = await freshRuntime();
    const listener = vi.fn();
    uepIslands.subscribe(listener);
    uepIslands.resetAll();
    expect(listener).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: 'reset' })
    );
  });

  it('progress reset 事件（source=reset）觸發 resetAll', async () => {
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    window.dispatchEvent(
      new CustomEvent('uep:progress-change', {
        detail: { state: {}, source: 'reset' },
      })
    );
    expect(uepIslands.getState().windows).toEqual({});
    expect(window.localStorage.getItem(islandStorageKey('history'))).toBeNull();
  });

  it('其他 progress 事件來源不觸發重置', async () => {
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    window.dispatchEvent(
      new CustomEvent('uep:progress-change', {
        detail: { state: {}, source: 'view-change' },
      })
    );
    expect(uepIslands.getWindow('history')?.open).toBe(true);
  });
});

describe('focus / z-index', () => {
  it('多島開啟時 focus 推到最上層', async () => {
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    uepIslands.open('concepts');
    uepIslands.open('storage');
    uepIslands.focus('history');
    expect(uepIslands.getState().focusOrder).toEqual([
      'concepts',
      'storage',
      'history',
    ]);
  });

  it('zIndexOf 依焦點序遞增，全部落在 2000 層帶', async () => {
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    uepIslands.open('concepts');
    const zHistory = uepIslands.zIndexOf('history');
    const zConcepts = uepIslands.zIndexOf('concepts');
    expect(zConcepts).toBeGreaterThan(zHistory);
    expect(zHistory).toBeGreaterThanOrEqual(ISLAND_Z_BASE);
    expect(zConcepts).toBeLessThan(3000);
  });

  it('focus 已是最上層或未開啟的島是 no-op', async () => {
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    const listener = vi.fn();
    uepIslands.subscribe(listener);
    uepIslands.focus('history'); // 已是最上層
    uepIslands.focus('echoes'); // 未開啟
    expect(listener).not.toHaveBeenCalled();
  });

  it('未在焦點序的島 z-index 落在層帶底', async () => {
    const { uepIslands } = await freshRuntime();
    expect(uepIslands.zIndexOf('visuals')).toBe(ISLAND_Z_BASE);
  });
});

describe('setPosition', () => {
  it('更新位置並持久化', async () => {
    const { uepIslands } = await freshRuntime();
    uepIslands.open('history');
    uepIslands.setPosition('history', { left: 111, top: 222 });
    expect(uepIslands.getWindow('history')?.position).toEqual({
      left: 111,
      top: 222,
    });
    const stored = JSON.parse(
      window.localStorage.getItem(islandStorageKey('history'))!
    );
    expect(stored.position).toEqual({ left: 111, top: 222 });
  });
});

describe('事件與訂閱', () => {
  it('變更時通知訂閱者並帶 source', async () => {
    const { uepIslands } = await freshRuntime();
    const listener = vi.fn();
    uepIslands.subscribe(listener);
    uepIslands.open('history');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ focusOrder: ['history'] }),
      expect.objectContaining({ source: 'open' })
    );
  });

  it('變更時 dispatch uep:island-change CustomEvent', async () => {
    const { uepIslands, ISLAND_CHANGE_EVENT } = await freshRuntime();
    const handler = vi.fn();
    window.addEventListener(ISLAND_CHANGE_EVENT, handler);
    uepIslands.open('storage');
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(ISLAND_CHANGE_EVENT, handler);
  });

  it('取消訂閱後不再收到通知', async () => {
    const { uepIslands } = await freshRuntime();
    const listener = vi.fn();
    const unsub = uepIslands.subscribe(listener);
    unsub();
    uepIslands.open('history');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('gating helpers', () => {
  it('canUseIslands：只有「已登入的探索者」可用', async () => {
    const { canUseIslands } = await freshRuntime();
    const { createInitialState } = await import('../../progress');
    const explorer = createInitialState();
    expect(canUseIslands(explorer)).toBe(true);
    expect(
      canUseIslands({ ...explorer, view: 'observer', observerEver: true })
    ).toBe(false);
    // S7-C 定案：未登入（訪客/登出後）無浮島——鏡像殘留的解鎖狀態不復活
    authMock.loggedIn = false;
    expect(canUseIslands(explorer)).toBe(false);
  });

  it('shouldMountIsland：已登入探索者 + 已解鎖', async () => {
    const { shouldMountIsland } = await freshRuntime();
    const { createInitialState } = await import('../../progress');
    const base = createInitialState();
    expect(shouldMountIsland(base, 'history')).toBe(false); // 未解鎖
    const unlocked = { ...base, islandsUnlocked: ['history'] };
    expect(shouldMountIsland(unlocked, 'history')).toBe(true);
    expect(
      shouldMountIsland(
        { ...unlocked, view: 'observer' as const, observerEver: true },
        'history'
      )
    ).toBe(false); // 觀測者無浮島
    // 登出後即使解鎖狀態殘留也不掛載
    authMock.loggedIn = false;
    expect(shouldMountIsland(unlocked, 'history')).toBe(false);
  });

  it('unlockIsland 轉呼叫 progress store', async () => {
    const { unlockIsland } = await freshRuntime();
    const { getProgressManager } = await import('../../progress');
    unlockIsland('history');
    expect(getProgressManager().getState().islandsUnlocked).toContain(
      'history'
    );
  });

  it('zoneVisitedFlag / hasVisitedZone：足跡旗標往返', async () => {
    const { zoneVisitedFlag, hasVisitedZone } = await freshRuntime();
    const { createInitialState } = await import('../../progress');
    expect(zoneVisitedFlag('history')).toBe('zone:visited:history');
    const base = createInitialState();
    expect(hasVisitedZone(base, 'history')).toBe(false);
    const visited = { ...base, flags: ['zone:visited:history'] };
    expect(hasVisitedZone(visited, 'history')).toBe(true);
    expect(hasVisitedZone(visited, 'echoes')).toBe(false);
  });

  it('shouldMountIsland：使用者停用時不掛載（解鎖仍保留）', async () => {
    const { shouldMountIsland, isIslandDisabled } = await freshRuntime();
    const { createInitialState } = await import('../../progress');
    const base = {
      ...createInitialState(),
      islandsUnlocked: ['history'],
    };
    expect(shouldMountIsland(base, 'history')).toBe(true);
    const disabled = { ...base, islandsDisabled: ['history'] };
    expect(isIslandDisabled(disabled, 'history')).toBe(true);
    expect(shouldMountIsland(disabled, 'history')).toBe(false);
    // 停用 ≠ 未解鎖
    expect(disabled.islandsUnlocked).toContain('history');
  });
});
