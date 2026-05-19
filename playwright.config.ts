import { defineConfig, devices } from '@playwright/test';

/**
 * Eternity E2E 測試設定
 *
 * 針對文件站（UEP）的關鍵使用者路徑進行煙霧測試。
 *
 * 執行方式：
 *   pnpm test:e2e              — 執行全部 E2E 測試
 *   pnpm test:e2e --ui         — 開啟 Playwright UI
 *   pnpm test:e2e --headed     — 有頭模式（可視化）
 *
 * 注意：需要 content-api Worker 和文件站都在運行中。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  /* 全域超時設定 — 首頁有 lobby 動畫，mobile 需要更多時間 */
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 14'] },
    },
  ],

  /* 本地開發時自動啟動伺服器（CI 環境下使用已部署的版本）*/
  ...(process.env.CI
    ? {}
    : {
        webServer: [
          {
            command: 'pnpm --filter content-api-worker dev',
            url: 'http://localhost:8788/api/content/history',
            reuseExistingServer: true,
            timeout: 30_000,
          },
          {
            command: 'pnpm --filter @uep/uep dev',
            url: 'http://localhost:4321',
            reuseExistingServer: true,
            timeout: 60_000,
          },
        ],
      }),
});
