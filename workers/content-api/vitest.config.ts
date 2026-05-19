import { defineConfig } from 'vitest/config';
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Content API Worker 測試設定
 *
 * 使用 cloudflareTest plugin 在 Workers runtime 內執行測試。
 * D1 migrations 在 Node.js 層讀取後傳入 miniflare。
 */
export default defineConfig(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            API_TOKEN: 'test-token-for-testing',
            ALLOWED_ORIGINS: 'http://localhost:4321',
            TEST_MIGRATIONS: JSON.stringify(migrations),
          },
        },
      }),
    ],
    test: {
      name: 'content-api',
      include: ['src/**/*.{test,spec}.ts'],
      setupFiles: ['./vitest.setup.ts'],
    },
  };
});
