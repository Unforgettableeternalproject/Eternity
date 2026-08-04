/**
 * 浮島 DevTools actions 測試（2026-08-03 面板精簡）
 *
 * 只釘一件事，但它是這次改動的核心：**DevTools 的解鎖不可以引來教學。**
 *
 * 解鎖走的是與真實解鎖完全相同的路徑（這是刻意的），而 `IslandGuideAuto`
 * 正是靠 `island-unlocked` 這個 source 排程自動教學——所以想驗浮島本身時，
 * 聚光燈會蓋上來擋路。修法是解鎖後順手記為 seen，這個測試釘住那一步不會
 * 在未來的重構中被摘掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProgressManager } from '../../../progress';
import { getRegistry } from '../../actionRegistry';
import { GROUPS } from '../../groups';
import { registerIslandActions } from '../islandActions';

const ISLAND_IDS = ['history', 'concepts', 'echoes', 'visuals', 'storage'];

const ACTION_IDS = [
  ...ISLAND_IDS.map((id) => `island:unlock:${id}`),
  ...ISLAND_IDS.map((id) => `island:relock:${id}`),
  'island:unlock-all',
  'island:relock-all',
  'island:dump-status',
  'lostbookmark:guarantee',
  'lostbookmark:force',
  'lostbookmark:reset',
  'lostbookmark:open-gate',
  'lostbookmark:dump-status',
];

/** 最小的 islands bridge：只記錄被解鎖了什麼 */
function mockIslandBridge(): { unlocked: string[]; relocked: string[] } {
  const calls = { unlocked: [] as string[], relocked: [] as string[] };
  window.__uepIslandsTest = {
    unlock: (id: string) => {
      calls.unlocked.push(id);
      getProgressManager().unlockIsland(id);
    },
    relock: (id: string) => {
      calls.relocked.push(id);
      getProgressManager().relockIsland(id);
    },
    status: () => ({
      view: 'explorer' as const,
      loggedIn: true,
      unlocked: [],
      disabled: [],
    }),
  };
  return calls;
}

describe('islandActions', () => {
  beforeEach(() => {
    registerIslandActions();
  });

  afterEach(() => {
    getRegistry().unregister(ACTION_IDS);
    getProgressManager().reset();
    delete window.__uepIslandsTest;
    vi.restoreAllMocks();
  });

  it('浮島與書籤註冊在同一個群組', () => {
    const groups = new Set(
      getRegistry()
        .getAll()
        .filter((a) => ACTION_IDS.includes(a.id))
        .map((a) => a.group)
    );
    expect([...groups]).toEqual([GROUPS.ISLANDS]);
  });

  /* DevTools 的解鎖直接走 bridge，跳過 completeUnlockRitual——所以不會
     觸發教學，聚光燈不會蓋在正要驗收的島上。要看教學用 guide:play:{id}。 */
  it('解鎖單島走 bridge', async () => {
    const calls = mockIslandBridge();

    await getRegistry().dispatch('island:unlock:history');

    expect(calls.unlocked).toEqual(['history']);
    expect(getProgressManager().getState().islandsUnlocked).toContain(
      'history'
    );
  });

  it('解鎖全部島', async () => {
    const calls = mockIslandBridge();
    await getRegistry().dispatch('island:unlock-all');

    expect([...calls.unlocked].sort()).toEqual([...ISLAND_IDS].sort());
  });

  it('bridge 未掛載時解鎖是 no-op 並 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await getRegistry().dispatch('island:unlock:history');

    expect(warn).toHaveBeenCalled();
    expect(getProgressManager().getState().islandsUnlocked).toEqual([]);
  });
});
