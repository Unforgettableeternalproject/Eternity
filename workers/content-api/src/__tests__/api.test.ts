import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * Content API Worker 整合測試
 *
 * 在 Miniflare runtime 內執行，使用真實的 D1 資料庫（已套用 migrations）。
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as ExecutionContext;

// 輔助函式：建立模擬 Request
function createRequest(
  path: string,
  options: RequestInit & { token?: string } = {}
) {
  const { token, ...init } = options;
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers.set('Origin', 'http://localhost:4321');
  return new Request(`http://localhost${path}`, { ...init, headers });
}

describe('Content API — 內容讀取', () => {
  // 先插入測試資料
  beforeAll(async () => {
    await env.CONTENT_DB.prepare(
      `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        'history/test-page',
        'history',
        '測試頁面',
        'test-page',
        1,
        JSON.stringify({ type: 'doc', content: [] }),
        JSON.stringify({ icon: '📜' }),
        'synced',
        'page',
        0
      )
      .run();
  });

  it('GET /api/content/history 列出 history 區域的頁面', async () => {
    const req = createRequest('/api/content/history');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { data: unknown[] };
    expect(data.data).toBeDefined();
    expect(data.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/content/history/tree 回傳樹狀結構', async () => {
    const req = createRequest('/api/content/history/tree');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { data: unknown[] };
    expect(data.data).toBeDefined();
  });

  it('GET /api/content/history/test-page 取得單頁內容', async () => {
    const req = createRequest('/api/content/history/test-page');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      data: { title: string; slug: string };
    };
    expect(data.data.title).toBe('測試頁面');
    expect(data.data.slug).toBe('test-page');
  });

  it('GET /api/content/history/nonexistent 回傳 404', async () => {
    const req = createRequest('/api/content/history/nonexistent');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(404);
  });
});

describe('Content API — CORS', () => {
  it('OPTIONS 預檢回傳 CORS 標頭', async () => {
    const req = createRequest('/api/content/history', { method: 'OPTIONS' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('允許的 Origin 得到正確的 CORS 回應', async () => {
    const req = createRequest('/api/content/history');
    const res = await worker.fetch(req, env, ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:4321'
    );
  });
});

describe('Content API — 未知路徑', () => {
  it('不存在的路徑回傳 404', async () => {
    const req = createRequest('/nonexistent');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(404);
  });
});
