/**
 * 浮島 dev 測試 bridge 測試（S6-3）
 *
 * store 是 module singleton，每個測試前 vi.resetModules() 取得全新實例
 * （bridge 內部走 getProgressManager()，必須與 store 同一批模組）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* status() 讀 auth 的登入狀態（浮島限已登入探索者）——mock auth */
const authMock = vi.hoisted(() => ({ loggedIn: true }));
vi.mock('../../auth', () => ({
  getReaderAuth: () => ({
    isLoggedIn: () => authMock.loggedIn,
    subscribe: () => () => {}, // islandRuntime 登入收合監聽用
  }),
}));

async function freshModules() {
  vi.resetModules();
  const store = await import('../../progress/progressStore');
  const bridge = await import('../testBridge');
  return { store: store.uepProgress, bridge };
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.__uepProgress;
  delete window.__uepIslandsTest;
});

describe('mountIslandsTestBridge', () => {
  it('掛上 window.__uepIslandsTest，cleanup 後移除', async () => {
    const { bridge } = await freshModules();
    const cleanup = bridge.mountIslandsTestBridge();
    expect(window.__uepIslandsTest).toBeTruthy();
    cleanup();
    expect(window.__uepIslandsTest).toBeUndefined();
  });

  it('unlock / relock 往返操作解鎖清單', async () => {
    const { store, bridge } = await freshModules();
    const cleanup = bridge.mountIslandsTestBridge();
    const t = window.__uepIslandsTest!;

    t.unlock('history');
    expect(store.getState().islandsUnlocked).toEqual(['history']);
    t.relock('history');
    expect(store.getState().islandsUnlocked).toEqual([]);
    cleanup();
  });

  it('visit / unvisit 補授與撤銷 zone 足跡旗標', async () => {
    const { store, bridge } = await freshModules();
    const cleanup = bridge.mountIslandsTestBridge();
    const t = window.__uepIslandsTest!;

    t.visit('history');
    expect(store.getState().flags).toContain('zone:visited:history');
    expect(t.status().visitedZones).toEqual(['history']);

    t.unvisit('history');
    expect(store.getState().flags).not.toContain('zone:visited:history');
    expect(t.status().visitedZones).toEqual([]);
    cleanup();
  });

  it('無效 id 警告且不動狀態', async () => {
    const { store, bridge } = await freshModules();
    const cleanup = bridge.mountIslandsTestBridge();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // @ts-expect-error 蓄意餵無效 id 驗證防呆
    window.__uepIslandsTest!.unlock('atlantis');
    expect(store.getState().islandsUnlocked).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
    cleanup();
  });

  it('status 彙整視角/解鎖/停用/足跡', async () => {
    const { store, bridge } = await freshModules();
    const cleanup = bridge.mountIslandsTestBridge();
    const t = window.__uepIslandsTest!;

    t.unlock('history');
    store.setIslandDisabled('history', true);
    t.visit('concepts');

    expect(t.status()).toEqual({
      view: 'explorer',
      loggedIn: true,
      unlocked: ['history'],
      disabled: ['history'],
      visitedZones: ['concepts'],
    });

    // 登出狀態如實反映（浮島前置條件的除錯資訊）
    authMock.loggedIn = false;
    expect(t.status().loggedIn).toBe(false);
    authMock.loggedIn = true;
    cleanup();
  });
});
