import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * Visitor Counter Worker 測試設定
 *
 * 使用 cloudflareTest plugin 在 Workers runtime 內執行測試。
 * KV namespace 自動提供隔離的測試實例。
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          ALLOWED_ORIGINS:
            'http://localhost:4321,http://localhost:4320,https://uep.unforgettableeternalproject.com,https://*.eternity-uep.pages.dev',
        },
      },
    }),
  ],
  test: {
    name: 'visitor-counter',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
