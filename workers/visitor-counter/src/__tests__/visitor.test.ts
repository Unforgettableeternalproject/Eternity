import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * Visitor Counter Worker 測試
 *
 * 在 Miniflare runtime 內執行，使用隔離的 KV namespace。
 */

// 輔助函式：建立模擬 Request
function createRequest(
  path: string,
  options: RequestInit = {},
  origin = 'http://localhost:4321'
) {
  const headers = new Headers(options.headers);
  headers.set('Origin', origin);
  headers.set('CF-Connecting-IP', '127.0.0.1');
  headers.set('User-Agent', 'test-agent');
  return new Request(`http://localhost${path}`, { ...options, headers });
}

// 模擬 ExecutionContext
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as ExecutionContext;

describe('Visitor Counter — GET /api/visitor/count', () => {
  it('初始狀態回傳 0 訪客', async () => {
    const req = createRequest('/api/visitor/count');
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    const data = (await res.json()) as { totalVisitors: number };
    expect(data.totalVisitors).toBe(0);
  });

  it('回應包含 JSON Content-Type', async () => {
    const req = createRequest('/api/visitor/count');
    const res = await worker.fetch(req, env, ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});

describe('Visitor Counter — POST /api/visitor/track', () => {
  it('追蹤訪客後計數增加', async () => {
    // 追蹤一個訪客
    const trackReq = createRequest('/api/visitor/track', { method: 'POST' });
    const trackRes = await worker.fetch(trackReq, env, ctx);
    expect(trackRes.status).toBe(200);

    // 確認計數增加
    const countReq = createRequest('/api/visitor/count');
    const countRes = await worker.fetch(countReq, env, ctx);
    const data = (await countRes.json()) as { totalVisitors: number };
    expect(data.totalVisitors).toBeGreaterThanOrEqual(1);
  });
});

describe('Visitor Counter — CORS', () => {
  it('OPTIONS 預檢回傳 CORS 標頭', async () => {
    const req = createRequest('/api/visitor/count', { method: 'OPTIONS' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
  });

  it('不允許的 Origin 不會收到 Access-Control-Allow-Origin', async () => {
    const req = createRequest(
      '/api/visitor/count',
      {},
      'https://evil-site.com'
    );
    const res = await worker.fetch(req, env, ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeFalsy();
  });
});

describe('Visitor Counter — 404', () => {
  it('未知路徑回傳 404', async () => {
    const req = createRequest('/api/unknown');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(404);
  });
});
