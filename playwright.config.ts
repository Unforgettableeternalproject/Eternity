import { defineConfig, devices } from '@playwright/test';

/**
 * Eternity E2E 測試設定
 *
 * 覆蓋兩站（主站 + 文件站）的關鍵使用者路徑。
 *
 * 執行方式：
 *   pnpm test:e2e              — 執行全部 E2E 測試
 *   pnpm test:e2e --ui         — 開啟 Playwright UI
 *   pnpm test:e2e --headed     — 有頭模式（可視化）
 *
 * 注意：需要 content-api Worker、主站、文件站都在運行中。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /* 本地固定 4 個 worker，不吃預設的「核心數一半」。
     瓶頸不在 CPU 而在單一 Vite dev server：它要同時 SSR + transform 所有
     context，而 uep 首頁是全站最重的一頁（3D 地圖 + 粒子背景都是常駐 rAF）。
     20 核機器上預設會開 10 個 worker，dev server 被打到 hydration 與導航
     雙雙拖過 timeout，失敗會隨機遊走到任何一支等待寫得比較鬆的測試上。 */
  workers: process.env.CI ? 1 : 4,
  reporter: process.env.CI ? 'github' : 'html',

  /* 全域超時設定 — 首頁有 lobby 動畫，mobile 需要更多時間 */
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: 30_000,
    /* 預埋入站儀式標記——否則每個全新 context 都會被身分選擇視窗擋住。
       要測試儀式本身的 spec 可自行覆寫 storageState。 */
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4321',
          localStorage: [{ name: 'uep.onboarded.v1', value: 'e2e' }],
        },
      ],
    },
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
            command: 'pnpm --filter @uep/root dev',
            url: 'http://localhost:4320',
            reuseExistingServer: true,
            timeout: 60_000,
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
