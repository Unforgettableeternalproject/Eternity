/**
 * entityDropBridge 單元測試（S10-1 便條擴充 T-H2）
 *
 * 驗證「必須展開才能接」的判定邏輯（收合／未解鎖／未掛載一律 false），
 * 以及 dropEntityText 對收合態、空字串、cap 滿的防禦。
 *
 * progressStore / islandRuntime 皆是 module singleton，每個測試前
 * vi.resetModules() 取全新實例；islandRuntime 依賴 auth，沿
 * islandRuntime.test.ts 既有模式 mock 掉。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => ({ loggedIn: true }));
vi.mock('../../../auth', () => ({
  getReaderAuth: () => ({
    isLoggedIn: () => authMock.loggedIn,
    subscribe: () => () => {},
  }),
}));

async function freshBridge() {
  vi.resetModules();
  const progressMod = await import('../../../progress/progressStore');
  const runtimeMod = await import('../../islandRuntime');
  const bridgeMod = await import('../entityDropBridge');
  return { ...progressMod, ...runtimeMod, ...bridgeMod };
}

beforeEach(() => {
  authMock.loggedIn = true;
  window.localStorage.clear();
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1024,
  });
  delete window.__uepProgress;
  delete window.__uepIslands;
});

describe('isStorageIslandOpenAndExpanded', () => {
  it('未解鎖時回 false（即使視窗狀態被強制 open）', async () => {
    const { uepIslands, isStorageIslandOpenAndExpanded } = await freshBridge();
    uepIslands.open('storage');
    expect(isStorageIslandOpenAndExpanded()).toBe(false);
  });

  it('已解鎖但視窗未展開（未曾 open 過）時回 false', async () => {
    const { uepProgress, isStorageIslandOpenAndExpanded } = await freshBridge();
    uepProgress.unlockIsland('storage');
    expect(isStorageIslandOpenAndExpanded()).toBe(false);
  });

  it('已解鎖且視窗展開時回 true', async () => {
    const { uepProgress, uepIslands, isStorageIslandOpenAndExpanded } =
      await freshBridge();
    uepProgress.unlockIsland('storage');
    uepIslands.open('storage');
    expect(isStorageIslandOpenAndExpanded()).toBe(true);
  });

  it('展開後又收合（close）時回 false', async () => {
    const { uepProgress, uepIslands, isStorageIslandOpenAndExpanded } =
      await freshBridge();
    uepProgress.unlockIsland('storage');
    uepIslands.open('storage');
    uepIslands.close('storage');
    expect(isStorageIslandOpenAndExpanded()).toBe(false);
  });

  it('使用者主動停用該島時回 false（即使視窗仍是 open）', async () => {
    const { uepProgress, uepIslands, isStorageIslandOpenAndExpanded } =
      await freshBridge();
    uepProgress.unlockIsland('storage');
    uepIslands.open('storage');
    uepProgress.setIslandDisabled('storage', true);
    expect(isStorageIslandOpenAndExpanded()).toBe(false);
  });

  it('觀測者視角時回 false', async () => {
    const { uepProgress, uepIslands, isStorageIslandOpenAndExpanded } =
      await freshBridge();
    uepProgress.unlockIsland('storage');
    uepIslands.open('storage');
    uepProgress.setView('observer');
    expect(isStorageIslandOpenAndExpanded()).toBe(false);
  });

  it('未登入時回 false', async () => {
    authMock.loggedIn = false;
    const { uepProgress, uepIslands, isStorageIslandOpenAndExpanded } =
      await freshBridge();
    uepProgress.unlockIsland('storage');
    uepIslands.open('storage');
    expect(isStorageIslandOpenAndExpanded()).toBe(false);
  });

  it('手機寬度（< 761px）時回 false', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 400,
    });
    const { uepProgress, uepIslands, isStorageIslandOpenAndExpanded } =
      await freshBridge();
    uepProgress.unlockIsland('storage');
    uepIslands.open('storage');
    expect(isStorageIslandOpenAndExpanded()).toBe(false);
  });
});

describe('dropEntityText', () => {
  async function expandedBridge() {
    const mod = await freshBridge();
    mod.uepProgress.unlockIsland('storage');
    mod.uepIslands.open('storage');
    return mod;
  }

  it('展開態拖入合法名稱 → 建立純文字便條，回傳 true', async () => {
    const { uepProgress, dropEntityText } = await expandedBridge();
    const ok = dropEntityText('艾斯維爾');
    expect(ok).toBe(true);
    expect(uepProgress.getState().storageNotes).toHaveLength(1);
    expect(uepProgress.getState().storageNotes[0].text).toBe('艾斯維爾');
    // 純文字快速填入，不存任何 ref／額外欄位
    expect(uepProgress.getState().storageNotes[0].location).toBeUndefined();
  });

  it('收合態（未展開）直接不接，回傳 false，不建立便條', async () => {
    const { uepProgress, dropEntityText } = await freshBridge();
    // 未解鎖、未 open —— 收合態
    const ok = dropEntityText('艾斯維爾');
    expect(ok).toBe(false);
    expect(uepProgress.getState().storageNotes).toHaveLength(0);
  });

  it('trim 後為空字串時回傳 false', async () => {
    const { uepProgress, dropEntityText } = await expandedBridge();
    const ok = dropEntityText('   ');
    expect(ok).toBe(false);
    expect(uepProgress.getState().storageNotes).toHaveLength(0);
  });

  it('便條已達上限時回傳 false（委派 addStorageNote 的 cap 判斷）', async () => {
    const { uepProgress, dropEntityText } = await expandedBridge();
    for (let i = 0; i < 30; i++) {
      uepProgress.addStorageNote(`便條 ${i}`);
    }
    const ok = dropEntityText('第 31 條');
    expect(ok).toBe(false);
    expect(uepProgress.getState().storageNotes).toHaveLength(30);
  });
});
