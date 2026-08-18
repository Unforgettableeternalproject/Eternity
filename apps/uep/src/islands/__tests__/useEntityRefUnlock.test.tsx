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

/**
 * 各 entity-index 端點的假回應（無 gate + 非 locked = 天生解鎖）。
 *
 * ⚠️ concepts 索引若有 dossier 條目，可點判定會**預先抓那些整頁 JSON**
 * （綁定指向藏在 `bindings` 與 revision patch，索引不帶）。頁面抓不到會被
 * 判成 partial → fail closed → 不可點，所以測到 dossier 時 `pages` 要一起給。
 */
function stubIndexFetch(routes: {
  concepts?: unknown[];
  echoes?: unknown[];
  visuals?: unknown[];
  /** pageId → dossier 整頁結構（省略時回一個沒有任何條目的空頁） */
  pages?: Record<string, unknown>;
  /** zone tree 節點（省略時回空樹＝無父層 gate） */
  tree?: unknown[];
}): ReturnType<typeof vi.fn> {
  const emptyDossier = { variants: [] };
  const fetchFn = vi.fn((input: string) => {
    const url = String(input);
    // zone tree 要排在 page 之前——路徑同前綴，會被 page regex 吃掉。
    // 可點判定改走 tree-aware 求值後，沒有 tree 一律 fail closed
    if (url.match(/\/api\/content\/(echoes|visuals)\/tree$/)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: routes.tree ?? [] }),
      });
    }
    const pageMatch = url.match(/\/api\/content\/(.+)$/);
    if (pageMatch) {
      const data = routes.pages?.[pageMatch[1]] ?? emptyDossier;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: {
              content: [{ type: 'dossier', content: JSON.stringify(data) }],
            },
          }),
      });
    }
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
/**
 * 可點判定與求值結論必須一致（2026-08-18）
 *
 * entityKey 開放一對多之後，「同 key 有任一筆已解鎖」不再等於「浮島查得到
 * 內容」——多筆而 dossier 沒指明時求值回 unbound，浮島什麼都不顯示。
 * 可點判定若還停在 `.some()`，嵌入就會變成看得到、點了沒反應。
 */
describe('useEntityRefUnlockChecker — 與綁定求值一致', () => {
  it('🔒 同 key 多筆又沒有綁定 → 不可點（求值回 unbound）', async () => {
    stubIndexFetch({
      echoes: [
        { id: 'echoes/x/song-a', entityKey: 'hero', locked: false },
        { id: 'echoes/x/song-b', entityKey: 'hero', locked: false },
      ],
    });
    const useChecker = await freshChecker();
    const progress = stateWith({ islandsUnlocked: ['echoes'] });
    const { result } = renderHook(() => useChecker(progress));

    // 給預載時間，確認結果穩定為不可點
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current('entity:hero')).toBe(false);
  });

  it('同 key 多筆但 dossier 指明了其中一筆 → 可點', async () => {
    stubIndexFetch({
      concepts: [
        {
          name: '轉正角色',
          stack: 'dossier',
          pageId: 'concepts/r/chars',
          entityKey: 'hero',
        },
      ],
      echoes: [
        { id: 'echoes/x/song-a', entityKey: 'hero', locked: false },
        { id: 'echoes/x/song-b', entityKey: 'hero', locked: false },
      ],
      pages: {
        'concepts/r/chars': {
          variants: [
            {
              id: 'u',
              subcategories: [
                {
                  label: '人物',
                  groups: [
                    {
                      label: '',
                      entries: [
                        {
                          name: '轉正角色',
                          entityKey: 'hero',
                          bindings: { echoes: 'echoes/x/song-b' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    const useChecker = await freshChecker();
    const progress = stateWith({ islandsUnlocked: ['echoes'] });
    const { result } = renderHook(() => useChecker(progress));

    await waitFor(() => expect(result.current('entity:hero')).toBe(true));
  });

  it('🔒 指向的那一筆被鎖住 → 不可點（就算同 key 另一筆是解鎖的）', async () => {
    stubIndexFetch({
      concepts: [
        {
          name: '轉正角色',
          stack: 'dossier',
          pageId: 'concepts/r/chars',
          entityKey: 'hero',
        },
      ],
      echoes: [
        { id: 'echoes/x/song-a', entityKey: 'hero', locked: false },
        { id: 'echoes/x/song-b', entityKey: 'hero', locked: true },
      ],
      pages: {
        'concepts/r/chars': {
          variants: [
            {
              id: 'u',
              subcategories: [
                {
                  label: '人物',
                  groups: [
                    {
                      label: '',
                      entries: [
                        {
                          name: '轉正角色',
                          entityKey: 'hero',
                          bindings: { echoes: 'echoes/x/song-b' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    const useChecker = await freshChecker();
    const progress = stateWith({ islandsUnlocked: ['echoes'] });
    const { result } = renderHook(() => useChecker(progress));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current('entity:hero')).toBe(false);
  });
});

it('🔒 明確綁定 hidden 內容 → 仍可點（by-id 消費路徑不排除 hidden）', async () => {
  // 轉正後把前期曲從列表隱藏是常態設計。排除 hidden 的清單只該用來
  // 「數候選」，拿去驗證 dossier 的明確指向就會讓這種綁定永遠不可點
  stubIndexFetch({
    concepts: [
      {
        name: '轉正角色',
        stack: 'dossier',
        pageId: 'concepts/r/chars',
        entityKey: 'hero',
      },
    ],
    echoes: [
      { id: 'echoes/x/song-a', entityKey: 'hero', locked: false },
      {
        id: 'echoes/x/song-hidden',
        entityKey: 'hero',
        locked: false,
        hidden: true,
      },
    ],
    pages: {
      'concepts/r/chars': {
        variants: [
          {
            id: 'u',
            subcategories: [
              {
                label: '人物',
                groups: [
                  {
                    label: '',
                    entries: [
                      {
                        name: '轉正角色',
                        entityKey: 'hero',
                        bindings: { echoes: 'echoes/x/song-hidden' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
  const useChecker = await freshChecker();
  const progress = stateWith({ islandsUnlocked: ['echoes'] });
  const { result } = renderHook(() => useChecker(progress));

  await waitFor(() => expect(result.current('entity:hero')).toBe(true));
});

it('hidden 不影響唯一候選的計數（隱藏那筆不算一個候選）', async () => {
  // 一筆公開 + 一筆隱藏 → 候選仍是「恰好一筆」，走唯一候選即可點
  stubIndexFetch({
    echoes: [
      { id: 'echoes/x/song-a', entityKey: 'hero', locked: false },
      {
        id: 'echoes/x/song-hidden',
        entityKey: 'hero',
        locked: false,
        hidden: true,
      },
    ],
  });
  const useChecker = await freshChecker();
  const progress = stateWith({ islandsUnlocked: ['echoes'] });
  const { result } = renderHook(() => useChecker(progress));

  await waitFor(() => expect(result.current('entity:hero')).toBe(true));
});

it('🔒 zone tree 拿不到 → 不可點（fail closed，與消費端同一套求值）', async () => {
  // 消費端一律以 tree-aware 求值判定解鎖（tree 取不到就拒絕顯示）。
  // 可點判定若在沒有 tree 時退回單頁判定，就會比消費端寬鬆——
  // progressPage 鏈條件全部落空，變成可點卻推不出提示卡
  const fetchFn = vi.fn((input: string) => {
    const url = String(input);
    if (url.includes('/tree')) return Promise.reject(new Error('tree down'));
    const entries = url.includes('/api/echoes/entity-index')
      ? [{ id: 'echoes/x/song-a', entityKey: 'hero', locked: false }]
      : [];
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, data: { entries } }),
    });
  });
  vi.stubGlobal('fetch', fetchFn);

  const useChecker = await freshChecker();
  const progress = stateWith({ islandsUnlocked: ['echoes'] });
  const { result } = renderHook(() => useChecker(progress));

  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(result.current('entity:hero')).toBe(false);
});

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
