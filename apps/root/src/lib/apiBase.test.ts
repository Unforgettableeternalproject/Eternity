/**
 * apiBase.ts 單元測試
 *
 * 涵蓋：
 * - getApiBase() 的 cookie override / env / fallback 三層優先順序
 * - isTestMode() 的 cookie + env 兩條件聯集
 * - setTestModeOverride() 的寫入 / 清除 / 拒絕非 test worker URL
 * - SSR-safe：無 document 環境不 crash
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_URL = 'https://eternity-content-api-test.ptyc4076.workers.dev';
const MALICIOUS_URL = 'https://malicious.example.com/api';

/**
 * jsdom 環境下重置 cookie 與 stub 環境變數。
 * 每個 test case 執行前把狀態清乾淨，避免互相污染。
 */
function resetJsdomState(): void {
  document.cookie
    .split('; ')
    .filter(Boolean)
    .forEach((entry) => {
      const name = entry.split('=')[0];
      document.cookie = `${name}=; Path=/; Max-Age=0`;
    });
}

/** 動態 stub PUBLIC_CONTENT_API_URL；apiBase.ts 內部用 import.meta.env 讀取 */
function stubEnv(value: string | undefined): void {
  vi.stubEnv('PUBLIC_CONTENT_API_URL', value ?? '');
}

describe('apiBase', () => {
  beforeEach(() => {
    resetJsdomState();
    stubEnv('https://prod-worker.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('getApiBase', () => {
    it('無 cookie 時回傳環境變數 base（去尾斜線）', async () => {
      stubEnv('https://prod-worker.example.com/');
      const { getApiBase } = await import('./apiBase');
      expect(getApiBase()).toBe('https://prod-worker.example.com');
    });

    it('未設環境變數時回傳 http://localhost:8788 fallback', async () => {
      stubEnv(undefined);
      const { getApiBase } = await import('./apiBase');
      expect(getApiBase()).toBe('http://localhost:8788');
    });

    it('cookie 存在且為 test worker URL 時使用 override', async () => {
      document.cookie = `root-test-api-url=${encodeURIComponent(TEST_URL)}; Path=/`;
      const { getApiBase } = await import('./apiBase');
      expect(getApiBase()).toBe(TEST_URL);
    });

    it('cookie 存在但非 test worker URL 時忽略，回傳環境變數', async () => {
      document.cookie = `root-test-api-url=${encodeURIComponent(MALICIOUS_URL)}; Path=/`;
      const { getApiBase } = await import('./apiBase');
      expect(getApiBase()).toBe('https://prod-worker.example.com');
    });

    it('cookie 是無法 parse 的字串時忽略', async () => {
      document.cookie = `root-test-api-url=${encodeURIComponent('not a url')}; Path=/`;
      const { getApiBase } = await import('./apiBase');
      expect(getApiBase()).toBe('https://prod-worker.example.com');
    });
  });

  describe('isTestMode', () => {
    it('無 cookie 且 env 為 prod URL 時回傳 false', async () => {
      const { isTestMode } = await import('./apiBase');
      expect(isTestMode()).toBe(false);
    });

    it('cookie 為合法 test worker URL 時回傳 true', async () => {
      document.cookie = `root-test-api-url=${encodeURIComponent(TEST_URL)}; Path=/`;
      const { isTestMode } = await import('./apiBase');
      expect(isTestMode()).toBe(true);
    });

    it('env 直接指向 test worker 時回傳 true（test Pages 部署場景）', async () => {
      stubEnv(TEST_URL);
      const { isTestMode } = await import('./apiBase');
      expect(isTestMode()).toBe(true);
    });

    it('cookie 為非 test URL 時回傳 false', async () => {
      document.cookie = `root-test-api-url=${encodeURIComponent(MALICIOUS_URL)}; Path=/`;
      const { isTestMode } = await import('./apiBase');
      expect(isTestMode()).toBe(false);
    });
  });

  describe('setTestModeOverride', () => {
    it('傳入 test worker URL 時寫入 cookie 並回傳 true', async () => {
      const { setTestModeOverride, getApiBase } = await import('./apiBase');
      expect(setTestModeOverride(TEST_URL)).toBe(true);
      expect(document.cookie).toContain('root-test-api-url');
      expect(getApiBase()).toBe(TEST_URL);
    });

    it('傳入非 test URL 時拒絕寫入並回傳 false', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { setTestModeOverride, getApiBase } = await import('./apiBase');
      expect(setTestModeOverride(MALICIOUS_URL)).toBe(false);
      expect(document.cookie).not.toContain('root-test-api-url');
      expect(getApiBase()).toBe('https://prod-worker.example.com');
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('傳入 null 時清除 cookie 並回傳 true', async () => {
      document.cookie = `root-test-api-url=${encodeURIComponent(TEST_URL)}; Path=/`;
      const { setTestModeOverride, getApiBase } = await import('./apiBase');
      expect(setTestModeOverride(null)).toBe(true);
      expect(getApiBase()).toBe('https://prod-worker.example.com');
    });

    it('傳入空字串時清除 cookie', async () => {
      document.cookie = `root-test-api-url=${encodeURIComponent(TEST_URL)}; Path=/`;
      const { setTestModeOverride } = await import('./apiBase');
      expect(setTestModeOverride('')).toBe(true);
    });

    it('無法 parse 為 URL 的字串被拒', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { setTestModeOverride } = await import('./apiBase');
      expect(setTestModeOverride('not-a-url')).toBe(false);
    });
  });

  describe('SSR-safe（無 document 環境）', () => {
    // ⚠️ apiBase.ts 內部函式是 lazy 讀取 `typeof document`，不在模組頂層
    // 讀取，因此在函式呼叫前 delete globalThis.document 即可正確模擬 SSR。
    // 若未來 apiBase.ts 在頂層新增 document 讀取，這些測試會變成假安全。
    it('getApiBase 在無 document 時只讀 env，不 crash', async () => {
      // 模擬 SSR：document / location 都設為 undefined
      const originalDocument = globalThis.document;
      // @ts-expect-error 測試場景刻意刪掉 global
      delete globalThis.document;
      try {
        const { getApiBase } = await import('./apiBase');
        expect(getApiBase()).toBe('https://prod-worker.example.com');
      } finally {
        globalThis.document = originalDocument;
      }
    });

    it('isTestMode 在無 document 時只看 env', async () => {
      stubEnv(TEST_URL);
      const originalDocument = globalThis.document;
      // @ts-expect-error 測試場景刻意刪掉 global
      delete globalThis.document;
      try {
        const { isTestMode } = await import('./apiBase');
        expect(isTestMode()).toBe(true);
      } finally {
        globalThis.document = originalDocument;
      }
    });

    it('setTestModeOverride 在無 document 時回傳 false 不 crash', async () => {
      const originalDocument = globalThis.document;
      // @ts-expect-error 測試場景刻意刪掉 global
      delete globalThis.document;
      try {
        const { setTestModeOverride } = await import('./apiBase');
        expect(setTestModeOverride(TEST_URL)).toBe(false);
      } finally {
        globalThis.document = originalDocument;
      }
    });
  });

  describe('常數 export', () => {
    it('TEST_WORKER_BASE_URL 對應部署的 test worker', async () => {
      const { TEST_WORKER_BASE_URL } = await import('./apiBase');
      expect(TEST_WORKER_BASE_URL).toBe(TEST_URL);
    });

    it('TEST_MODE_COOKIE_NAME 為 root-test-api-url', async () => {
      const { TEST_MODE_COOKIE_NAME } = await import('./apiBase');
      expect(TEST_MODE_COOKIE_NAME).toBe('root-test-api-url');
    });
  });
});
