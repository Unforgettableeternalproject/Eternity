import { test, expect } from '@playwright/test';

/**
 * 主站效能門檻測試
 *
 * 驗證頁面載入時間和 API 回應時間在可接受範圍內。
 * 用於 release 前的效能回歸檢測。
 */

test.use({ baseURL: 'http://localhost:4320' });

// ── 效能門檻（毫秒）──────────────────────────────────
const THRESHOLDS = {
  /** SSR 頁面回應時間（含 D1 查詢）*/
  ssrResponse: 3000,
  /** API 端點回應時間 */
  apiResponse: 1000,
  /** 頁面 DOM 準備就緒 */
  domReady: 5000,
  /** 暖快取 SSR 回應（第二次請求同頁面）*/
  warmSsrResponse: 2000,
};

// ── SSR 回應時間 ──────────────────────────────────

test.describe('SSR 回應時間', () => {
  const pages = [
    { path: '/zh-tw/', label: '首頁' },
    { path: '/zh-tw/about', label: '關於' },
    { path: '/zh-tw/projects', label: '專案' },
    { path: '/zh-tw/updates', label: '動態' },
    { path: '/zh-tw/links', label: '連結' },
    { path: '/zh-tw/contact', label: '聯絡' },
  ];

  for (const { path, label } of pages) {
    test(`${label} SSR 回應 < ${THRESHOLDS.ssrResponse}ms`, async ({
      request,
    }) => {
      const start = Date.now();
      const res = await request.get(`http://localhost:4320${path}`, {
        headers: { Accept: 'text/html' },
      });
      const elapsed = Date.now() - start;

      expect(res.status()).toBeLessThan(500);
      expect(
        elapsed,
        `${label} SSR 回應 ${elapsed}ms 超過門檻 ${THRESHOLDS.ssrResponse}ms`
      ).toBeLessThan(THRESHOLDS.ssrResponse);
    });
  }

  test('暖快取下 SSR 回應更快', async ({ request }) => {
    // 第一次請求（暖快取）
    await request.get('http://localhost:4320/zh-tw/', {
      headers: { Accept: 'text/html' },
    });

    // 第二次請求（應命中 TTL 快取）
    const start = Date.now();
    const res = await request.get('http://localhost:4320/zh-tw/', {
      headers: { Accept: 'text/html' },
    });
    const elapsed = Date.now() - start;

    expect(res.status()).toBe(200);
    expect(
      elapsed,
      `暖快取 SSR ${elapsed}ms 超過門檻 ${THRESHOLDS.warmSsrResponse}ms`
    ).toBeLessThan(THRESHOLDS.warmSsrResponse);
  });
});

// ── API 回應時間 ──────────────────────────────────

test.describe('API 回應時間', () => {
  const endpoints = [
    { path: '/api/root/projects', label: 'Projects' },
    { path: '/api/root/links', label: 'Links' },
    { path: '/api/root/updates', label: 'Updates' },
    { path: '/api/root/singletons/about-zh', label: 'Singleton' },
    { path: '/api/root/cards/card-quote', label: 'Card' },
  ];

  for (const { path, label } of endpoints) {
    test(`${label} API < ${THRESHOLDS.apiResponse}ms`, async ({ request }) => {
      const start = Date.now();
      const res = await request.get(`http://localhost:8788${path}`);
      const elapsed = Date.now() - start;

      expect(res.status()).toBe(200);
      expect(
        elapsed,
        `${label} API ${elapsed}ms 超過門檻 ${THRESHOLDS.apiResponse}ms`
      ).toBeLessThan(THRESHOLDS.apiResponse);
    });
  }
});

// ── 頁面載入效能 ──────────────────────────────────

test.describe('頁面載入效能', () => {
  test('首頁 DOM 就緒時間 < 門檻', async ({ page }) => {
    const start = Date.now();
    await page.goto('/zh-tw/');
    await page.waitForLoadState('domcontentloaded');
    const elapsed = Date.now() - start;

    expect(
      elapsed,
      `首頁 DOM 就緒 ${elapsed}ms 超過門檻 ${THRESHOLDS.domReady}ms`
    ).toBeLessThan(THRESHOLDS.domReady);
  });

  test('首頁沒有佈局偏移 (CLS ≈ 0)', async ({ page }) => {
    await page.goto('/zh-tw/');
    await page.waitForLoadState('networkidle');

    // 用 Performance Observer 測量 CLS
    const cls = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!(entry as any).hadRecentInput) {
              clsValue += (entry as any).value;
            }
          }
        });
        observer.observe({ type: 'layout-shift', buffered: true });

        // 等一下收集完畢
        setTimeout(() => {
          observer.disconnect();
          resolve(clsValue);
        }, 2000);
      });
    });

    expect(cls, `CLS ${cls} 超過 0.1`).toBeLessThan(0.1);
  });
});

// ── 並行 API 壓力 ──────────────────────────────────

test.describe('並行 API 壓力', () => {
  test('同時 20 個 API 請求不超時', async ({ request }) => {
    const endpoints = [
      '/api/root/projects',
      '/api/root/links',
      '/api/root/updates',
      '/api/root/singletons/about-zh',
      '/api/root/cards/card-quote',
      '/api/root/cards/card-music',
      '/api/root/cards/card-status',
      '/api/root/cards/card-uep',
      '/api/root/cards/card-portal',
      '/api/root/cards/card-visitor-counter',
    ];

    // 每個端點請求 2 次 = 20 個並行請求
    const start = Date.now();
    const promises = endpoints.flatMap((path) => [
      request.get(`http://localhost:8788${path}`),
      request.get(`http://localhost:8788${path}`),
    ]);

    const results = await Promise.all(promises);
    const elapsed = Date.now() - start;

    // 全部回應正常（200 OK 或 404 尚未建立的 card 都可接受，不能 500）
    for (const res of results) {
      expect(res.status()).toBeLessThan(500);
    }

    // 20 個並行請求應在合理時間內完成
    expect(elapsed, `20 個並行 API 請求耗時 ${elapsed}ms`).toBeLessThan(10000);
  });
});
