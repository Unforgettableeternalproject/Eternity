/**
 * Cloudflare Workers 環境綁定型別宣告
 *
 * 透過介面合併（interface merging）將專案自訂的 binding 注入 `Cloudflare.Env`，
 * 使 `import { env } from 'cloudflare:workers'` 在測試中具有正確型別。
 *
 * 參考：@cloudflare/workers-types 的 `Cloudflare.Env` 預設為空介面，
 * 設計上就是要用戶在此擴充。
 */

/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    // ===== D1 資料庫 =====
    CONTENT_DB: D1Database;

    // ===== R2 存儲桶 =====
    ASSETS_BUCKET: R2Bucket;
    ROOT_ASSETS_BUCKET: R2Bucket;

    // ===== Vars =====
    ALLOWED_ORIGINS: string;
    API_TOKEN?: string;
    JWT_SECRET?: string;
    BOOTSTRAP_TOKEN?: string;
    VISITOR_API_URL?: string;

    // ===== Service Bindings =====
    VISITOR_COUNTER?: Fetcher;

    // ===== Test env 旗標 =====
    ETERNITY_TEST_ENV?: string;

    // ===== Vitest 測試用（vitest.config.ts 注入） =====
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TEST_MIGRATIONS?: any;
  }
}
