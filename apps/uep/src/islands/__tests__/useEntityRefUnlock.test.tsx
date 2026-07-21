/**
 * useEntityRefUnlockChecker 測試 — 跨 entity 浮島聯集（S8 驗收 #2）
 *
 * 驗證：
 * - 只掛載 Echoes 島時，僅 Echoes 索引被載入，且該島有的 entityKey 判為可點
 * - 只掛載 Visuals 島時，Visuals 索引接手判定
 * - 三島皆未掛載 → 一律不可點（安全預設），且不發任何索引請求
 * - 判定為「任一相應浮島解鎖」的聯集（OR）
 *
 * 模組級索引快取跨測試會污染 → 每個 test 以 vi.resetModules + 動態 import
 * 取得全新模組實例。
 */

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInitialState } from '../../progress/types';
import type { ProgressState } from '../../progress/types';

/* 浮島掛載守門經 shouldMountIsland → canUseIslands 含登入判定；預設已登入 */
const authMock = vi.hoisted(() => ({ loggedIn: true }));
vi.mock('../../auth', () => ({
  getReaderAuth: () => ({
    isLoggedIn: () => authMock.loggedIn,
    subscribe: () => () => {},
  }),
}));

/** 各 entity-index 端點的假回應（無 gate + 非 locked = 天生解鎖） */
function stubIndexFetch(routes: {
  concepts?: unknown[];
  echoes?: unknown[];
  visuals?: unknown[];
}): ReturnType<typeof vi.fn> {
  const fetchFn = vi.fn((input: string) => {
    const url = String(input);
    let entries: unknown[] = [];
    if (url.includes('/api/concepts/entity-index'))
      entries = routes.concepts ?? [];
    else if (url.includes('/api/echoes/entity-index'))
      entries = routes.echoes ?? [];
    else if (url.includes('/api/visuals/entity-index'))
      entries = routes.visuals ?? [];
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, data: { entries } }),
    });
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

function stateWith(partial: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...partial };
}

async function freshChecker() {
  const mod = await import('../useEntityRefUnlock');
  return mod.useEntityRefUnlockChecker;
}

beforeEach(() => {
  authMock.loggedIn = true;
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useEntityRefUnlockChecker — 跨島聯集', () => {
  it('只掛載 Echoes：Echoes 有的 entityKey 判為可點', async () => {
    stubIndexFetch({
      echoes: [{ id: 'echoes/x/song-a', entityKey: 'hero', locked: false }],
    });
    const useChecker = await freshChecker();
    const progress = stateWith({ islandsUnlocked: ['echoes'] });
    const { result } = renderHook(() => useChecker(progress));

    await waitFor(() =>
      expect(result.current('entity:hero')).toBe(true)
    );
    // Echoes 沒有的 key 仍不可點
    expect(result.current('entity:ghost')).toBe(false);
  });

  it('只掛載 Visuals：Visuals 有的 entityKey 判為可點', async () => {
    stubIndexFetch({
      visuals: [{ id: 'visuals/p/gal-a', entityKey: 'hero', locked: false }],
    });
    const useChecker = await freshChecker();
    const progress = stateWith({ islandsUnlocked: ['visuals'] });
    const { result } = renderHook(() => useChecker(progress));

    await waitFor(() =>
      expect(result.current('entity:hero')).toBe(true)
    );
  });

  it('聯集：Echoes 有、Concepts/Visuals 無 → 仍可點', async () => {
    stubIndexFetch({
      concepts: [],
      echoes: [{ id: 'echoes/x/song-a', entityKey: 'hero', locked: false }],
      visuals: [],
    });
    const useChecker = await freshChecker();
    const progress = stateWith({
      islandsUnlocked: ['concepts', 'echoes', 'visuals'],
    });
    const { result } = renderHook(() => useChecker(progress));

    await waitFor(() =>
      expect(result.current('entity:hero')).toBe(true)
    );
  });

  it('三島皆未掛載 → 一律不可點，且不發索引請求', async () => {
    const fetchFn = stubIndexFetch({
      echoes: [{ id: 'echoes/x/song-a', entityKey: 'hero', locked: false }],
    });
    const useChecker = await freshChecker();
    const progress = stateWith({}); // islandsUnlocked 為空
    const { result } = renderHook(() => useChecker(progress));

    expect(result.current('entity:hero')).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('static locked 的 Echoes 條目不算解鎖', async () => {
    stubIndexFetch({
      echoes: [{ id: 'echoes/x/song-a', entityKey: 'hero', locked: true }],
    });
    const useChecker = await freshChecker();
    const progress = stateWith({ islandsUnlocked: ['echoes'] });
    const { result } = renderHook(() => useChecker(progress));

    // 給 async 載入落地的機會後仍不可點
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current('entity:hero')).toBe(false);
  });
});
