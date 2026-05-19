import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

/**
 * Content API 測試設定
 *
 * 從 binding 讀取 migrations 資料（由 vitest.config.ts 注入），
 * 然後套用到 D1 資料庫。
 */

// @ts-expect-error — TEST_MIGRATIONS 是測試用的自訂 binding
const migrationsJson = env.TEST_MIGRATIONS as string;
const migrations = JSON.parse(migrationsJson);
await applyD1Migrations(env.CONTENT_DB, migrations);
