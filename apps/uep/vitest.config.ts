import { defineConfig } from 'vitest/config';
import react from '@astrojs/react';

/**
 * UEP 文件站單元測試設定
 *
 * 測試範圍：React hooks、工具函式、元件邏輯
 * 環境：jsdom（模擬瀏覽器 DOM）
 *
 * ## testTimeout 為什麼要調高
 *
 * 不少測試用 `vi.resetModules()` + 動態 import 取得乾淨的模組單例
 * （progressStore／islandRuntime／entityDropBridge 等），那等於在測試內
 * 重新 transform 一整張模組圖。全量跑一百多個檔案時 I/O 會飽和，這些
 * 測試就會撞破 vitest 預設的 5 秒上限——**症狀是每次失敗的檔案都不一樣**，
 * 看起來像隨機的測試污染，實際上只是誰排到最塞的那一刻。
 *
 * 2026-08-03 追查：失敗訊息是 `Test timed out in 5000ms` 而不是斷言失敗，
 * 且單獨重跑一律全綠。這不是邏輯問題，調高上限才是對症的修法——縮短
 * 模組重載成本要動到那些測試取得乾淨單例的方式，不值得為此重寫。
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
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      // 對齊 Astro 的路徑別名（如果有需要可以擴充）
    },
  },
});
