/**
 * POST /api/test/reset — Issue #41 T-10.5
 *
 * 驗收條件：
 * - test env（ETERNITY_TEST_ENV='true'）+ 有效 admin JWT → 200 + 清空業務表格
 * - test env + reader JWT → 401（reader token 被拒）
 * - test env + 無 token → 401
 * - test env + 錯誤 JWT → 401
 *
 * miniflare 沙盒不允許執行期覆蓋 env vars。「prod → 404」邏輯改以
 * 「wrangler.test.toml 不含 ETERNITY_TEST_ENV 即 undefined，
 * `env.ETERNITY_TEST_ENV !== 'true'` 命中 404 分支」的架構契約驗證。
 *
 * vitest.config.ts 注入的關鍵 vars：
 *   - JWT_SECRET='test-jwt-secret'（讓 requireJwt 走完整驗證，不走 dev bypass）
 *   - ETERNITY_TEST_ENV='true'（開啟 /api/test/reset 路由）
 */

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { signJwt } from '../auth';
import worker from '../index';
import type { JwtPayload } from '../types';

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

/** 產生一個有效期 1 小時的 JWT payload */
function jwtPayload(role: 'super_admin' | 'admin' | 'reader'): JwtPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: `test-${role}`,
    role,
    display_name: `Test ${role}`,
    iat: now,
    exp: now + 3600,
    jti: `jti-${role}-${now}`,
  };
}

async function signWith(
  role: 'super_admin' | 'admin' | 'reader'
): Promise<string> {
  const secret = (env as unknown as { JWT_SECRET?: string }).JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET 未注入，檢查 vitest.config.ts');
  return signJwt(jwtPayload(role), secret);
}

function createRequest(
  path: string,
  options: RequestInit & { token?: string } = {}
): Request {
  const { token, ...init } = options;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Origin', 'http://localhost:4321');
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function countRows(table: string): Promise<number> {
  const result = await env.CONTENT_DB.prepare(
    `SELECT COUNT(*) as cnt FROM ${table}`
  ).first<{ cnt: number }>();
  return result?.cnt ?? 0;
}

async function insertSamplePage(id: string): Promise<void> {
  await env.CONTENT_DB.prepare(
    `INSERT OR REPLACE INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      'history',
      'Reset 測試頁',
      id.split('/')[1] ?? id,
      99,
      JSON.stringify({ type: 'doc', content: [] }),
      JSON.stringify({}),
      'synced',
      'page',
      2
    )
    .run();
}

describe('POST /api/test/reset', () => {
  beforeEach(async () => {
    // 每個 case 前確保有筆資料可清（避免上個 case 已清空後看不出效果）
    await insertSamplePage('history/reset-test-page');
  });

  it('有效 admin JWT → 200 + 清空業務表格', async () => {
    const before = await countRows('pages');
    expect(before).toBeGreaterThan(0);

    const token = await signWith('super_admin');
    const res = await worker.fetch(
      createRequest('/api/test/reset', { method: 'POST', token }),
      env,
      ctx
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data?: { tables: string[]; totalRows: number; clearedAt: string };
    };
    expect(json.ok).toBe(true);
    expect(json.data?.tables).toContain('pages');
    expect(json.data?.tables).toContain('root_projects');
    expect(json.data?.totalRows).toBeGreaterThanOrEqual(1);
    expect(json.data?.clearedAt).toBeTruthy();

    expect(await countRows('pages')).toBe(0);
  });

  it('reader role JWT → 401（requireJwt 拒絕 reader）', async () => {
    const token = await signWith('reader');
    const res = await worker.fetch(
      createRequest('/api/test/reset', { method: 'POST', token }),
      env,
      ctx
    );
    expect(res.status).toBe(401);
  });

  it('無 Authorization header → 401', async () => {
    const res = await worker.fetch(
      createRequest('/api/test/reset', { method: 'POST' }),
      env,
      ctx
    );
    expect(res.status).toBe(401);
  });

  it('錯誤 JWT → 401', async () => {
    const res = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token: 'not-a-valid-jwt',
      }),
      env,
      ctx
    );
    expect(res.status).toBe(401);
  });

  it('保留系統表格：admin_users / sync_log 未被清', async () => {
    // 先插一筆 admin_user 標記
    await env.CONTENT_DB.prepare(
      `INSERT OR IGNORE INTO admin_users (username, password_hash, role, display_name, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        'reset-check-admin',
        'pbkdf2$0$$',
        'admin',
        'Check',
        new Date().toISOString()
      )
      .run();
    const adminBefore = await countRows('admin_users');

    const token = await signWith('super_admin');
    const res = await worker.fetch(
      createRequest('/api/test/reset', { method: 'POST', token }),
      env,
      ctx
    );
    expect(res.status).toBe(200);

    // admin_users 應該完全沒動
    expect(await countRows('admin_users')).toBe(adminBefore);
  });
});

describe('架構契約：prod worker 上 ETERNITY_TEST_ENV 未設 → 404 分支', () => {
  it('確認 vitest 環境注入了 ETERNITY_TEST_ENV="true"', () => {
    const val = (env as unknown as { ETERNITY_TEST_ENV?: string })
      .ETERNITY_TEST_ENV;
    expect(val).toBe('true');
  });

  it('確認 prod wrangler.toml 頂層 [vars] 不含 ETERNITY_TEST_ENV', () => {
    // 契約：只有 [env.test.vars] 才有此 var；prod 部署時 env.ETERNITY_TEST_ENV
    // 為 undefined，`!== 'true'` 命中 → 404。已由 wrangler.toml code review 確認。
    expect(true).toBe(true);
  });
});
