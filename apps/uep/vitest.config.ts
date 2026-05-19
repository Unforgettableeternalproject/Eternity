import { defineConfig } from 'vitest/config';
import react from '@astrojs/react';

/**
 * UEP 文件站單元測試設定
 *
 * 測試範圍：React hooks、工具函式、元件邏輯
 * 環境：jsdom（模擬瀏覽器 DOM）
 */
export default defineConfig({
  // @ts-expect-error — Astro React plugin 與 Vitest 的 Vite plugin 型別不完全相容
  plugins: [react()],
  test: {
    name: 'uep',
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', '.astro'],
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
  resolve: {
    alias: {
      // 對齊 Astro 的路徑別名（如果有需要可以擴充）
    },
  },
});
