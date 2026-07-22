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
        lostBookmark: { chancePct: 20, visible: false },
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
        lostBookmark: { chancePct: 20, visible: false },
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

  it('hydrate（setAdapter）→ 場上釘選清空（切帳號同語意）', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepStoragePins.pin(makePinned({ noteId: 'x' }));
    await uepProgress.setAdapter({
      load: async () => null, // 遠端無資料
      save: async () => {},
    });
    // setAdapter 遠端無資料時走 persist 分支不派 hydrate；但遠端有資料時派 hydrate
    // 這裡驗有資料版
    const { uepStoragePins: pins2 } = await freshStores();
    pins2.pin(makePinned({ noteId: 'y' }));
    const initialProgress = (
      await import('../../../progress/progressStore')
    ).uepProgress.getState();
    await (
      await import('../../../progress/progressStore')
    ).uepProgress.setAdapter({
      load: async () => ({ ...initialProgress, flags: ['remote'] }),
      save: async () => {},
    });
    expect(pins2.getAll()).toEqual([]);
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
