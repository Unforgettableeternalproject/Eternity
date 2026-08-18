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

    await waitFor(() => expect(result.current('entity:hero')).toBe(true));
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

    await waitFor(() => expect(result.current('entity:hero')).toBe(true));
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

    await waitFor(() => expect(result.current('entity:hero')).toBe(true));
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

  it('索引已載入後島變成不可用（停用/resize 到手機寬）→ 立即變回不可點，不是只擋 fetch（S8 手動驗收 #9 追加修復）', async () => {
    stubIndexFetch({
      echoes: [{ id: 'echoes/x/song-a', entityKey: 'hero', locked: false }],
    });
    const useChecker = await freshChecker();
    const unlocked = stateWith({ islandsUnlocked: ['echoes'] });
    const { result, rerender } = renderHook(
      ({ progress }) => useChecker(progress),
      { initialProps: { progress: unlocked } }
    );
    await waitFor(() => expect(result.current('entity:hero')).toBe(true));

    // 索引已快取在 state；使用者停用 Echoes 島，不重新 fetch，
    // 但判定當下要重驗 mounted，不能沿用舊索引誤判可點。
    const disabled = stateWith({
      islandsUnlocked: ['echoes'],
      islandsDisabled: ['echoes'],
    });
    rerender({ progress: disabled });
    expect(result.current('entity:hero')).toBe(false);
  });

  it('手機寬度視窗（<761px）→ 即使島已解鎖也不視為 mounted，不觸發索引請求', async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    });
    try {
      const fetchFn = stubIndexFetch({
        echoes: [{ id: 'echoes/x/song-a', entityKey: 'hero', locked: false }],
      });
      const useChecker = await freshChecker();
      const progress = stateWith({ islandsUnlocked: ['echoes'] });
      const { result } = renderHook(() => useChecker(progress));

      expect(result.current('entity:hero')).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: originalWidth,
      });
    }
  });
});

/**
 * 孤兒收緊開關（T-12，2026-08-15 定案）
 *
 * 這是整批改動中**唯一會拿掉現有功能**的一項：開關開啟後，沒有 dossier
 * 條目的 entityKey 其 `entity:{key}` 嵌入會從能點變成不能點。正式站目前
 * 86% 的 Echoes entity 屬於這種情況，因此預設關閉。
 *
 * 「關閉時行為與改動前完全一致」是本組最重要的回歸鎖。
 */
describe('useEntityRefUnlockChecker — 孤兒收緊開關', () => {
  /** getSetting 讀的是 window.__uepSettings（sessionStorage 只是它的來源） */
  function setOrphanGate(value: 'enabled' | 'disabled') {
    window.__uepSettings = { 'entityBinding.embedOrphanGate': value };
  }

  afterEach(() => {
    delete window.__uepSettings;
  });

  it('🔒 預設（關閉）：孤兒 entityKey 維持可點，行為與改動前一致', async () => {
    stubIndexFetch({
      // concepts 沒有這個 key = 孤兒；echoes 有 → 舊行為判可點
      echoes: [{ id: 'echoes/x/song-a', entityKey: 'orphan', locked: false }],
    });
    const useChecker = await freshChecker();
    const progress = stateWith({ islandsUnlocked: ['echoes'] });
    const { result } = renderHook(() => useChecker(progress));

    await waitFor(() => expect(result.current('entity:orphan')).toBe(true));
  });

  it('開啟：孤兒 entityKey 變不可點', async () => {
    setOrphanGate('enabled');
    stubIndexFetch({
      echoes: [{ id: 'echoes/x/song-a', entityKey: 'orphan', locked: false }],
    });
    const useChecker = await freshChecker();
    const progress = stateWith({ islandsUnlocked: ['echoes'] });
    const { result } = renderHook(() => useChecker(progress));

    // 給索引載入的時間，確認結果穩定為不可點
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current('entity:orphan')).toBe(false);
  });

  it('開啟：有 dossier 條目的 entityKey 不受影響', async () => {
    setOrphanGate('enabled');
    stubIndexFetch({
      concepts: [
        {
          name: '有檔案的角色',
          stack: 'dossier',
          pageId: 'concepts/r/chars',
          entityKey: 'hero',
        },
      ],
      echoes: [{ id: 'echoes/x/song-a', entityKey: 'hero', locked: false }],
    });
    const useChecker = await freshChecker();
    const progress = stateWith({ islandsUnlocked: ['echoes'] });
    const { result } = renderHook(() => useChecker(progress));

    await waitFor(() => expect(result.current('entity:hero')).toBe(true));
  });
});
