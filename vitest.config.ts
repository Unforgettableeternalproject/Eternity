import { defineConfig } from 'vitest/config';

/**
 * 根層級 Vitest 設定
 *
 * 前端單元測試 + 同步腳本的純函式。Worker 測試需在各自目錄執行
 * （使用 cloudflare pool）。
 *
 * 執行方式：
 *   pnpm test                 — 執行前端單元測試
 *   pnpm test:workers         — 執行 Worker 測試
 *   pnpm test:e2e             — 執行 Playwright E2E 測試
 */
export default defineConfig({
  test: {
    projects: [
      // 主站單元測試
      'apps/root/vitest.config.ts',
      // 文件站單元測試
      'apps/uep/vitest.config.ts',
      // 同步腳本的純函式（`sync-utils.mjs`）。腳本本體要連兩端 API，
      // 只有無副作用的比對邏輯進得來——但那正是出錯最貴的一段。
      {
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/__tests__/**/*.test.mjs'],
        },
      },
    ],
  },
});
