import { defineConfig } from 'vitest/config';

/**
 * 主站單元測試設定
 *
 * 測試範圍：工具函式、狀態管理、SSR 端邏輯
 * 環境：jsdom（模擬瀏覽器 DOM + localStorage）
 */
export default defineConfig({
  test: {
    name: 'root',
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', '.astro'],
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
});
