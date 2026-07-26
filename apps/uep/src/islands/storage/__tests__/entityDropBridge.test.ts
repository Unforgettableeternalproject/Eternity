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

import type { TerminalIndexEntry } from '../../concepts/terminalCore';

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

describe('findCanonicalEntityName', () => {
  /** 造一筆索引條目（只填判定會用到的欄位） */
  function entry(
    partial: Partial<TerminalIndexEntry> & { name: string }
  ): TerminalIndexEntry {
    return {
      stack: 'dossier',
      pageId: 'concepts/records/character_list',
      pageTitle: '人物列表',
      ...partial,
    };
  }

  async function progressState() {
    const { uepProgress } = await freshBridge();
    return uepProgress.getState();
  }

  it('dossier 有已解鎖條目 → 回該條目的 name', async () => {
    const { findCanonicalEntityName } = await freshBridge();
    const progress = await progressState();
    const name = findCanonicalEntityName(
      [entry({ name: '艾斯維爾·科索諾', entityKey: 'xavier-colsono' })],
      'xavier-colsono',
      progress
    );
    expect(name).toBe('艾斯維爾·科索諾');
  });

  it('同一 key 只在 browser／chrono／diff 定義 → 不可拖（回 null）', async () => {
    const { findCanonicalEntityName } = await freshBridge();
    const progress = await progressState();
    const entries: TerminalIndexEntry[] = [
      entry({
        name: '艾斯維爾',
        entityKey: 'xavier-colsono',
        stack: 'browser',
      }),
      entry({ name: '艾斯維爾', entityKey: 'xavier-colsono', stack: 'diff' }),
    ];
    expect(
      findCanonicalEntityName(entries, 'xavier-colsono', progress)
    ).toBeNull();
  });

  it('dossier 條目未解鎖 → 回 null（不讓拖曳繞過條目級進度閘漏名字）', async () => {
    const { findCanonicalEntityName } = await freshBridge();
    const progress = await progressState();
    const locked = entry({
      name: '尚未登場的人',
      entityKey: 'unknown-one',
      baseGate: { requiresFlags: ['met:someone'] },
    });
    expect(
      findCanonicalEntityName([locked], 'unknown-one', progress)
    ).toBeNull();
  });

  it('群組 gate 未過 → 整組隱藏，同樣不可拖', async () => {
    const { findCanonicalEntityName } = await freshBridge();
    const progress = await progressState();
    const hidden = entry({
      name: '密會成員',
      entityKey: 'secret-one',
      groupGate: { requiresFlags: ['met:secret'] },
    });
    expect(
      findCanonicalEntityName([hidden], 'secret-one', progress)
    ).toBeNull();
  });

  it('同 key 跨 variant 多條 → 取第一個已解鎖的', async () => {
    const { findCanonicalEntityName } = await freshBridge();
    const progress = await progressState();
    const entries: TerminalIndexEntry[] = [
      entry({
        name: '鎖住的版本',
        entityKey: 'xavier-colsono',
        variantId: 'u',
        baseGate: { requiresFlags: ['never'] },
      }),
      entry({
        name: '艾斯維爾·科索諾',
        entityKey: 'xavier-colsono',
        variantId: 'e',
      }),
    ];
    expect(findCanonicalEntityName(entries, 'xavier-colsono', progress)).toBe(
      '艾斯維爾·科索諾'
    );
  });

  it('索引尚未載入（null）→ 安全預設不可拖', async () => {
    const { findCanonicalEntityName } = await freshBridge();
    const progress = await progressState();
    expect(
      findCanonicalEntityName(null, 'xavier-colsono', progress)
    ).toBeNull();
  });

  it('空白 key → 回 null，不去比對', async () => {
    const { findCanonicalEntityName } = await freshBridge();
    const progress = await progressState();
    expect(
      findCanonicalEntityName(
        [entry({ name: 'X', entityKey: '' })],
        '  ',
        progress
      )
    ).toBeNull();
  });

  it('條目 name 只有空白 → 視為沒有名字可用', async () => {
    const { findCanonicalEntityName } = await freshBridge();
    const progress = await progressState();
    expect(
      findCanonicalEntityName(
        [entry({ name: '   ', entityKey: 'blank-one' })],
        'blank-one',
        progress
      )
    ).toBeNull();
  });
});

describe('isEntityDropTarget', () => {
  // jsdom 不實作 elementFromPoint，直接補一個假的（同 dragToPin 的
  // 「純函式 + stubbed elementFromPoint」測試模式）
  function stubElementAt(el: Element | null): () => void {
    // 經 unknown 轉型：與 Document 交集會讓 elementFromPoint 變成必填，
    // delete 就過不了型別檢查
    const doc = document as unknown as {
      elementFromPoint?: (x: number, y: number) => Element | null;
    };
    doc.elementFromPoint = () => el;
    return () => {
      delete doc.elementFromPoint;
    };
  }

  it('放開點落在展開的便條島上 → true', async () => {
    const { isEntityDropTarget } = await freshBridge();
    const island = document.createElement('div');
    island.className = 'uep-island uep-island--storage';
    document.body.appendChild(island);
    const restore = stubElementAt(island);
    expect(isEntityDropTarget(10, 10)).toBe(true);
    island.remove();
    restore();
  });

  it('放開點落在別處 → false', async () => {
    const { isEntityDropTarget } = await freshBridge();
    const other = document.createElement('div');
    document.body.appendChild(other);
    const restore = stubElementAt(other);
    expect(isEntityDropTarget(10, 10)).toBe(false);
    other.remove();
    restore();
  });

  it('環境沒有 elementFromPoint → false（不當成落在島上）', async () => {
    const { isEntityDropTarget } = await freshBridge();
    expect(isEntityDropTarget(10, 10)).toBe(false);
  });
});
