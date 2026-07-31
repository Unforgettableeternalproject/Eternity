/**
 * pinnedStore 測試（S9-A.4）
 *
 * module singleton：vi.resetModules() 取全新實例，並清 localStorage
 * 與 window bridge。同 progressStore.test 慣例。
 *
 * 覆蓋：pin/unpin/覆蓋語意、getForPage/isPinned/getPinnedMeta 查詢、
 * localStorage 持久化 + normalizePins 容錯、reset 清空、便條刪除自動 unpin。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PinnedNote } from '../pinnedStore';

async function freshStores() {
  vi.resetModules();
  const progressMod = await import('../../../progress/progressStore');
  const pinnedMod = await import('../pinnedStore');
  return { ...progressMod, ...pinnedMod };
}

function makePinned(overrides: Partial<PinnedNote> = {}): PinnedNote {
  return {
    noteId: 'note-1',
    pagePath: '/history',
    pageSearch: '',
    zone: 'history',
    pageLabel: '歷史典藏庫 - 邊際世界',
    anchorKind: 'element',
    anchorId: 'p-3',
    offsetX: 10,
    offsetY: 20,
    createdAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.__uepProgress;
  delete window.__uepStoragePins;
});

afterEach(() => {
  window.localStorage.clear();
});

describe('bootstrap', () => {
  it('無 localStorage 資料時初始為空陣列', async () => {
    const { uepStoragePins } = await freshStores();
    expect(uepStoragePins.getAll()).toEqual([]);
  });

  it('從 localStorage 還原既有釘選', async () => {
    const stored = [makePinned({ noteId: 'a' }), makePinned({ noteId: 'b' })];
    window.localStorage.setItem(
      'uep.storage.pinned.v1',
      JSON.stringify(stored)
    );
    // progress 也要有對應便條，否則 boot 時被掃孤兒清掉
    window.localStorage.setItem(
      'uep.progress.v1',
      JSON.stringify({
        version: 1,
        view: 'explorer',
        observerEver: false,
        flags: [],
        completedPageIds: [],
        islandsUnlocked: [],
        islandsDisabled: [],
        pageMarkers: {},
        lastVisitedPageId: null,
        lastVisitedAt: null,
        lostBookmark: { missCount: 0, visible: false },
        readingStats: { totalMs: 0 },
        conceptsReadLevel: {},
        storageNotes: [
          {
            id: 'a',
            text: 'A',
            tilt: 0,
            createdAt: '2026-07-21T00:00:00.000Z',
            updatedAt: '2026-07-21T00:00:00.000Z',
          },
          {
            id: 'b',
            text: 'B',
            tilt: 0,
            createdAt: '2026-07-21T00:00:00.000Z',
            updatedAt: '2026-07-21T00:00:00.000Z',
          },
        ],
        updatedAt: '2026-07-21T00:00:00.000Z',
      })
    );
    const { uepStoragePins } = await freshStores();
    expect(uepStoragePins.getAll()).toHaveLength(2);
  });

  it('localStorage 資料毀損時回到空陣列', async () => {
    window.localStorage.setItem('uep.storage.pinned.v1', 'not-json');
    const { uepStoragePins } = await freshStores();
    expect(uepStoragePins.getAll()).toEqual([]);
  });

  it('normalizePins 剔除壞值（欄位缺失、型別不對）', async () => {
    const bad = [
      makePinned({ noteId: 'ok' }),
      { noteId: 'no-path' }, // 缺 pagePath
      { ...makePinned(), offsetX: NaN }, // NaN
      { ...makePinned(), anchorKind: 'invalid' }, // 未知 anchorKind
    ];
    window.localStorage.setItem('uep.storage.pinned.v1', JSON.stringify(bad));
    // 給 progress 也塞一張對應便條，避免 boot 掃孤兒把 'ok' 一併清掉
    window.localStorage.setItem(
      'uep.progress.v1',
      JSON.stringify({
        version: 1,
        view: 'explorer',
        observerEver: false,
        flags: [],
        completedPageIds: [],
        islandsUnlocked: [],
        islandsDisabled: [],
        pageMarkers: {},
        lastVisitedPageId: null,
        lastVisitedAt: null,
        lostBookmark: { missCount: 0, visible: false },
        readingStats: { totalMs: 0 },
        conceptsReadLevel: {},
        storageNotes: [
          {
            id: 'ok',
            text: 'X',
            tilt: 0,
            createdAt: '2026-07-21T00:00:00.000Z',
            updatedAt: '2026-07-21T00:00:00.000Z',
          },
        ],
        updatedAt: '2026-07-21T00:00:00.000Z',
      })
    );
    const { uepStoragePins } = await freshStores();
    expect(uepStoragePins.getAll()).toHaveLength(1);
    expect(uepStoragePins.getAll()[0].noteId).toBe('ok');
  });
});

describe('pin / unpin / getForPage', () => {
  it('pin 新增，unpin 移除', async () => {
    const { uepStoragePins } = await freshStores();
    uepStoragePins.pin(makePinned({ noteId: 'a' }));
    expect(uepStoragePins.getAll()).toHaveLength(1);
    expect(uepStoragePins.isPinned('a')).toBe(true);
    uepStoragePins.unpin('a');
    expect(uepStoragePins.getAll()).toEqual([]);
  });

  it('同 noteId pin 兩次 → 覆蓋（不重複）', async () => {
    const { uepStoragePins } = await freshStores();
    uepStoragePins.pin(makePinned({ noteId: 'a', offsetX: 10 }));
    uepStoragePins.pin(makePinned({ noteId: 'a', offsetX: 99 }));
    expect(uepStoragePins.getAll()).toHaveLength(1);
    expect(uepStoragePins.getAll()[0].offsetX).toBe(99);
  });

  it('unpin 不存在的 noteId → no-op、不觸發 listener', async () => {
    const { uepStoragePins } = await freshStores();
    const listener = vi.fn();
    uepStoragePins.subscribe(listener);
    uepStoragePins.unpin('nope');
    expect(listener).not.toHaveBeenCalled();
  });

  it('getForPage 只回該 pathname 的釘選', async () => {
    const { uepStoragePins } = await freshStores();
    uepStoragePins.pin(makePinned({ noteId: 'h', pagePath: '/history' }));
    uepStoragePins.pin(makePinned({ noteId: 'e', pagePath: '/echoes' }));
    expect(uepStoragePins.getForPage('/history')).toHaveLength(1);
    expect(uepStoragePins.getForPage('/history')[0].noteId).toBe('h');
    expect(uepStoragePins.getForPage('/visuals')).toEqual([]);
  });

  // 【回歸：S9-A Codex #1】各 Reader 用 query string 切子頁，
  // 只靠 pathname 會把同 zone 別文章的釘選誤顯示。
  it('getForPage 同 pathname 不同 search → 只回對應子頁的釘選', async () => {
    const { uepStoragePins } = await freshStores();
    uepStoragePins.pin(
      makePinned({
        noteId: 'a',
        pagePath: '/history',
        pageSearch: '?page=one',
      })
    );
    uepStoragePins.pin(
      makePinned({
        noteId: 'b',
        pagePath: '/history',
        pageSearch: '?page=two',
      })
    );
    expect(uepStoragePins.getForPage('/history', '?page=one')).toHaveLength(1);
    expect(uepStoragePins.getForPage('/history', '?page=one')[0].noteId).toBe(
      'a'
    );
    expect(uepStoragePins.getForPage('/history', '?page=two')[0].noteId).toBe(
      'b'
    );
    expect(uepStoragePins.getForPage('/history')).toEqual([]); // 無 search 精確比對
  });

  it('normalizePins 對舊資料補 pageSearch 空字串', async () => {
    const legacy = [
      {
        noteId: 'legacy',
        pagePath: '/history',
        // pageSearch 缺席
        zone: 'history',
        pageLabel: 'X',
        anchorKind: 'element',
        anchorId: 'p-0',
        offsetX: 0,
        offsetY: 0,
        createdAt: '2026-07-21T00:00:00.000Z',
      },
    ];
    window.localStorage.setItem(
      'uep.storage.pinned.v1',
      JSON.stringify(legacy)
    );
    window.localStorage.setItem(
      'uep.progress.v1',
      JSON.stringify({
        version: 1,
        view: 'explorer',
        observerEver: false,
        flags: [],
        completedPageIds: [],
        islandsUnlocked: [],
        islandsDisabled: [],
        pageMarkers: {},
        lastVisitedPageId: null,
        lastVisitedAt: null,
        lostBookmark: { missCount: 0, visible: false },
        readingStats: { totalMs: 0 },
        conceptsReadLevel: {},
        storageNotes: [
          {
            id: 'legacy',
            text: 'X',
            tilt: 0,
            createdAt: '2026-07-21T00:00:00.000Z',
            updatedAt: '2026-07-21T00:00:00.000Z',
          },
        ],
        updatedAt: '2026-07-21T00:00:00.000Z',
      })
    );
    const { uepStoragePins } = await freshStores();
    const all = uepStoragePins.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].pageSearch).toBe('');
  });

  it('getPinnedMeta 回釘選詳細，找不到回 null', async () => {
    const { uepStoragePins } = await freshStores();
    uepStoragePins.pin(makePinned({ noteId: 'a', pageLabel: 'X' }));
    expect(uepStoragePins.getPinnedMeta('a')?.pageLabel).toBe('X');
    expect(uepStoragePins.getPinnedMeta('none')).toBeNull();
  });
});

describe('persistence', () => {
  it('pin 後寫入 localStorage', async () => {
    const { uepStoragePins } = await freshStores();
    uepStoragePins.pin(makePinned({ noteId: 'a' }));
    const raw = window.localStorage.getItem('uep.storage.pinned.v1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toHaveLength(1);
  });

  it('unpin 後 localStorage 也更新', async () => {
    const { uepStoragePins } = await freshStores();
    uepStoragePins.pin(makePinned({ noteId: 'a' }));
    uepStoragePins.unpin('a');
    expect(
      JSON.parse(window.localStorage.getItem('uep.storage.pinned.v1')!)
    ).toEqual([]);
  });
});

describe('生命週期接線', () => {
  it('progress reset → 場上釘選清空', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    // 先讓便條存在（reset 只擋 storage-note 的孤兒清理不影響）
    uepProgress.addStorageNote('先建立一張便條');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));
    expect(uepStoragePins.getAll()).toHaveLength(1);

    uepProgress.reset();
    expect(uepStoragePins.getAll()).toEqual([]);
  });

  it('便條被刪 → 對應釘選自動 unpin（掃孤兒）', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('X');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));

    uepProgress.removeStorageNote(noteId);
    expect(uepStoragePins.getAll()).toEqual([]);
  });

  it('更新便條內容不影響釘選（noteId 沒變）', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('原文');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId, offsetX: 42 }));

    uepProgress.updateStorageNote(noteId, '新文');
    expect(uepStoragePins.getAll()).toHaveLength(1);
    expect(uepStoragePins.getPinnedMeta(noteId)?.offsetX).toBe(42);
  });

  /**
   * 【回歸 2026-07-26】真實登出必須清空釘選。
   *
   * 本檔頭部一直寫著「登出/reset 會 clearAll」，但實作只監聽了
   * PROGRESS_CHANGE 的 `source:'reset'`，而生產環境唯一發出 reset 的
   * 路徑是 DevTools——真實使用者從識別證登出永遠不會觸發，釘選就
   * 原地殘留給共用瀏覽器的下一個人看。islandRuntime 與 audioStore
   * 兩個姊妹子系統都是直接訂閱 auth，這裡補齊以保持一致。
   */
  it('真實登出（auth session → null）→ 釘選清空', async () => {
    vi.resetModules();
    const { uepReaderAuth } = await import('../../../auth/readerAuth');
    const { uepProgress } = await import('../../../progress/progressStore');
    const { uepStoragePins } = await import('../pinnedStore');

    uepProgress.addStorageNote('登出前的便條');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));
    expect(uepStoragePins.getAll()).toHaveLength(1);

    await uepReaderAuth.logout();

    expect(uepStoragePins.getAll()).toHaveLength(0);
  });

  // 【回歸：S9-A 驗收根因 A】setAdapter 每次整頁載入都派 hydrate，
  // 若 hydrate 走 clearAll，釘選撐不過任何一次換頁/F5。
  it('hydrate（同帳號重載）→ 便條仍在的釘選存活', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('同步中的便條');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));

    // 模擬同帳號整頁重載：remote 回傳含同一張便條的 state
    const current = uepProgress.getState();
    await uepProgress.setAdapter({
      load: async () => ({ ...current, flags: ['remote'] }),
      save: async () => {},
    });
    expect(uepStoragePins.getAll()).toHaveLength(1);
    expect(uepStoragePins.isPinned(noteId)).toBe(true);
  });

  it('hydrate（切帳號）→ 新帳號沒有的便條釘選被掃掉', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepStoragePins.pin(makePinned({ noteId: 'old-account-note' }));

    // 模擬切帳號：remote state 的 storageNotes 是另一組 id
    const current = uepProgress.getState();
    await uepProgress.setAdapter({
      load: async () => ({
        ...current,
        flags: ['remote'],
        storageNotes: [
          {
            id: 'new-account-note',
            text: 'B 帳號的便條',
            tilt: 0,
            createdAt: '2026-07-24T00:00:00.000Z',
            updatedAt: '2026-07-24T00:00:00.000Z',
          },
        ],
      }),
      save: async () => {},
    });
    expect(uepStoragePins.getAll()).toEqual([]);
  });
});

describe('跨區事件合約（S9-A.7）', () => {
  it('pin 派 uep:storage-pin-change source=pin，帶 pinned 快照', async () => {
    const { uepStoragePins } = await freshStores();
    const details: unknown[] = [];
    const handler = (e: Event) => {
      details.push((e as CustomEvent).detail);
    };
    window.addEventListener('uep:storage-pin-change', handler);
    try {
      uepStoragePins.pin(makePinned({ noteId: 'a' }));
      expect(details).toHaveLength(1);
      const d = details[0] as {
        source: string;
        noteId: string;
        pinned: unknown;
      };
      expect(d.source).toBe('pin');
      expect(d.noteId).toBe('a');
      expect(d.pinned).not.toBeNull();
    } finally {
      window.removeEventListener('uep:storage-pin-change', handler);
    }
  });

  it('unpin 派 source=unpin', async () => {
    const { uepStoragePins } = await freshStores();
    uepStoragePins.pin(makePinned({ noteId: 'a' }));
    let source = '';
    const handler = (e: Event) => {
      source = (e as CustomEvent).detail.source;
    };
    window.addEventListener('uep:storage-pin-change', handler);
    try {
      uepStoragePins.unpin('a');
      expect(source).toBe('unpin');
    } finally {
      window.removeEventListener('uep:storage-pin-change', handler);
    }
  });

  it('clearAll 派 source=clear', async () => {
    const { uepStoragePins } = await freshStores();
    uepStoragePins.pin(makePinned({ noteId: 'a' }));
    let source = '';
    const handler = (e: Event) => {
      source = (e as CustomEvent).detail.source;
    };
    window.addEventListener('uep:storage-pin-change', handler);
    try {
      uepStoragePins.clearAll();
      expect(source).toBe('clear');
    } finally {
      window.removeEventListener('uep:storage-pin-change', handler);
    }
  });

  it('sweepOrphans（便條被刪 → 對應釘選一併清）派 source=sweep', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('X');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));
    let source = '';
    const handler = (e: Event) => {
      source = (e as CustomEvent).detail.source;
    };
    window.addEventListener('uep:storage-pin-change', handler);
    try {
      uepProgress.removeStorageNote(noteId);
      expect(source).toBe('sweep');
    } finally {
      window.removeEventListener('uep:storage-pin-change', handler);
    }
  });
});

describe('subscribe', () => {
  it('pin/unpin 觸發 listener', async () => {
    const { uepStoragePins } = await freshStores();
    const listener = vi.fn();
    const unsub = uepStoragePins.subscribe(listener);
    uepStoragePins.pin(makePinned({ noteId: 'a' }));
    expect(listener).toHaveBeenCalledTimes(1);
    uepStoragePins.unpin('a');
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    uepStoragePins.pin(makePinned({ noteId: 'b' }));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
