/**
 * 進度／讀者 session 的環境隔離測試（正式 ↔ 測試模式切換）
 *
 * 情境：同 origin 下用 test-mode cookie 切換正式／測試 API 時，
 * localStorage 的進度與讀者 session 不得跨環境殘留——
 * 否則 ServerAdapter 的「遠端空則上傳本地」初始合併會把正式環境
 * 的進度寫進 test 帳號（兩 worker 共用 JWT_SECRET，token 互通）。
 *
 * key 在 module 載入時依 isTestMode() 計算一次（mode 切換必伴隨
 * reload），因此測試以 vi.resetModules() + 動態 import 模擬 reload。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInitialState } from '../types';

const TEST_URL = 'https://eternity-content-api-test.ptyc4076.workers.dev';
const TEST_COOKIE = 'uep-test-api-url';

const PROD_PROGRESS_KEY = 'uep.progress.v1';
const TEST_PROGRESS_KEY = 'uep.progress.v1:test';
const PROD_SESSION_KEY = 'uep.reader.session.v1';
const TEST_SESSION_KEY = 'uep.reader.session.v1:test';
const PROD_PINNED_KEY = 'uep.storage.pinned.v1';
const TEST_PINNED_KEY = 'uep.storage.pinned.v1:test';

function enterTestMode(): void {
  document.cookie = `${TEST_COOKIE}=${encodeURIComponent(TEST_URL)}; Path=/`;
}

function exitTestMode(): void {
  document.cookie = `${TEST_COOKIE}=; Path=/; Max-Age=0`;
}

/** 模擬 mode 切換後的 reload：重置 module cache 再重新載入 adapters */
async function reloadAdapters() {
  vi.resetModules();
  return await import('../adapters');
}

async function reloadReaderAuth() {
  vi.resetModules();
  return await import('../../auth/readerAuth');
}

describe('環境隔離（正式 ↔ 測試模式）', () => {
  beforeEach(() => {
    exitTestMode();
    window.localStorage.clear();
    vi.stubEnv('PUBLIC_CONTENT_API_URL', 'https://prod-worker.example.com');
  });

  afterEach(() => {
    exitTestMode();
    window.localStorage.clear();
    vi.unstubAllEnvs();
  });

  describe('storage key 依環境 namespace', () => {
    it('正式模式使用基底 key', async () => {
      const { PROGRESS_STORAGE_KEY } = await reloadAdapters();
      expect(PROGRESS_STORAGE_KEY).toBe(PROD_PROGRESS_KEY);
      const { READER_SESSION_KEY } = await reloadReaderAuth();
      expect(READER_SESSION_KEY).toBe(PROD_SESSION_KEY);
    });

    it('測試模式使用 :test 後綴 key', async () => {
      enterTestMode();
      const { PROGRESS_STORAGE_KEY } = await reloadAdapters();
      expect(PROGRESS_STORAGE_KEY).toBe(TEST_PROGRESS_KEY);
      const { READER_SESSION_KEY } = await reloadReaderAuth();
      expect(READER_SESSION_KEY).toBe(TEST_SESSION_KEY);
    });
  });

  describe('進度不跨環境殘留', () => {
    it('prod 建立進度 → 切 test 應空白 → 切回 prod 應復原', async () => {
      // 1. 正式模式建立進度
      let mod = await reloadAdapters();
      const prodState = {
        ...createInitialState(),
        completedPageIds: ['history/prod-only-page'],
      };
      await new mod.LocalStorageAdapter().save(prodState);
      expect(window.localStorage.getItem(PROD_PROGRESS_KEY)).not.toBeNull();

      // 2. 切換測試模式（reload）：進度必須是空白，不得看到 prod 進度
      enterTestMode();
      mod = await reloadAdapters();
      expect(new mod.LocalStorageAdapter().loadSync()).toBeNull();

      // 3. 測試模式寫入自己的進度，不得動到 prod blob
      const testState = {
        ...createInitialState(),
        completedPageIds: ['history/test-only-page'],
      };
      await new mod.LocalStorageAdapter().save(testState);
      const prodRaw = window.localStorage.getItem(PROD_PROGRESS_KEY)!;
      expect(JSON.parse(prodRaw).completedPageIds).toEqual([
        'history/prod-only-page',
      ]);

      // 4. 切回正式模式（reload）：原進度完整復原
      exitTestMode();
      mod = await reloadAdapters();
      const restored = new mod.LocalStorageAdapter().loadSync();
      expect(restored?.completedPageIds).toEqual(['history/prod-only-page']);
    });

    it('test 模式下 ServerAdapter 的本地鏡像不含 prod 進度（防初始上傳污染）', async () => {
      // prod 先有進度
      let mod = await reloadAdapters();
      await new mod.LocalStorageAdapter().save({
        ...createInitialState(),
        completedPageIds: ['history/prod-only-page'],
      });

      // 切 test 後，ServerAdapter 離線 fallback 讀到的鏡像必須是空——
      // progressStore「遠端空則上傳本地」時才不會把 prod 進度傳進 test 帳號
      enterTestMode();
      vi.resetModules();
      const { ServerAdapter } = await import('../serverAdapter');
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);
      try {
        const adapter = new ServerAdapter({
          apiBase: TEST_URL,
          getToken: () => 'reader-token',
        });
        expect(await adapter.load()).toBeNull();
        adapter.destroy();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('讀者 session 不跨環境殘留', () => {
    it('prod 登入的 session 在 test 模式下讀不到', async () => {
      window.localStorage.setItem(
        PROD_SESSION_KEY,
        JSON.stringify({
          token: 'prod-token',
          username: 'prod-user',
          alias: '正式讀者',
          observerEver: false,
        })
      );

      enterTestMode();
      const { uepReaderAuth } = await reloadReaderAuth();
      expect(uepReaderAuth.getSession()).toBeNull();
    });
  });

  // 【回歸：S9-A Codex #2】pinned localStorage key 也要 test-mode 隔離，
  // 否則切到 test reload 後，boot orphan sweep 會拿 test storageNotes 掃
  // production pins，ID 不符時直接持久化刪除；切回正式便條已失去。
  describe('釘選 pinned key 不跨環境殘留', () => {
    async function reloadPinned() {
      // 真實環境中 mode 切換伴隨整頁 reload，window bridge 也全新；
      // 測試以 vi.resetModules() 模擬 module reload，須手動清 bridge。
      vi.resetModules();
      delete (window as unknown as { __uepProgress?: unknown }).__uepProgress;
      delete (window as unknown as { __uepStoragePins?: unknown })
        .__uepStoragePins;
      return await import('../../islands/storage/pinnedStore');
    }

    it('正式模式使用基底 key', async () => {
      const { PINNED_STORAGE_KEY } = await reloadPinned();
      expect(PINNED_STORAGE_KEY).toBe(PROD_PINNED_KEY);
    });

    it('測試模式使用 :test 後綴 key', async () => {
      enterTestMode();
      const { PINNED_STORAGE_KEY } = await reloadPinned();
      expect(PINNED_STORAGE_KEY).toBe(TEST_PINNED_KEY);
    });

    it('prod 釘選存在 → 切 test 讀不到 → prod blob 不被 test 掃孤兒動到', async () => {
      // 1. prod 釘選存在（跟對應便條）
      window.localStorage.setItem(
        PROD_PINNED_KEY,
        JSON.stringify([
          {
            noteId: 'prod-note',
            pagePath: '/history',
            pageSearch: '',
            zone: 'history',
            pageLabel: 'X',
            anchorKind: 'element',
            anchorId: 'p-0',
            offsetX: 0,
            offsetY: 0,
            createdAt: '2026-07-21T00:00:00.000Z',
          },
        ])
      );
      window.localStorage.setItem(
        PROD_PROGRESS_KEY,
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
              id: 'prod-note',
              text: 'A',
              tilt: 0,
              createdAt: '2026-07-21T00:00:00.000Z',
              updatedAt: '2026-07-21T00:00:00.000Z',
            },
          ],
          updatedAt: '2026-07-21T00:00:00.000Z',
        })
      );

      // 2. 切 test，pinned key 應切換為 :test → prod 釘選讀不到
      enterTestMode();
      const { uepStoragePins, PINNED_STORAGE_KEY } = await reloadPinned();
      expect(PINNED_STORAGE_KEY).toBe(TEST_PINNED_KEY);
      expect(uepStoragePins.getAll()).toEqual([]);

      // 3. 而且 prod key 的原始資料不能被 test 環境動到
      //    （若 pinned 沒隔離，test boot 掃孤兒會拿 test storageNotes 空集掃
      //    prod pins，把 prod-note 刪掉）
      const prodPinnedRaw = window.localStorage.getItem(PROD_PINNED_KEY);
      expect(prodPinnedRaw).not.toBeNull();
      expect(JSON.parse(prodPinnedRaw!)).toHaveLength(1);

      // 4. 切回 prod 應能讀到原釘選
      exitTestMode();
      const back = await reloadPinned();
      expect(back.PINNED_STORAGE_KEY).toBe(PROD_PINNED_KEY);
      expect(back.uepStoragePins.getAll()).toHaveLength(1);
      expect(back.uepStoragePins.getAll()[0].noteId).toBe('prod-note');
    });
  });
});
