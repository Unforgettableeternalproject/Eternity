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
  origin = 'http://localhost:4321',
  fingerprintSuffix = ''
) {
  const headers = new Headers(options.headers);
  headers.set('Origin', origin);
  headers.set('CF-Connecting-IP', `127.0.0.1${fingerprintSuffix}`);
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
    const data = (await res.json()) as { totalVisitors: number; site: string };
    expect(data.totalVisitors).toBe(0);
    expect(data.site).toBe('root');
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

  it('uep 網域被視為合法來源', async () => {
    const req = createRequest(
      '/api/visitor/count',
      {},
      'https://uep.unforgettableeternalproject.com'
    );
    const res = await worker.fetch(req, env, ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://uep.unforgettableeternalproject.com'
    );
  });

  it('*.eternity-uep.pages.dev 通配符匹配', async () => {
    const req = createRequest(
      '/api/visitor/count',
      {},
      'https://staging-uep.eternity-uep.pages.dev'
    );
    const res = await worker.fetch(req, env, ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://staging-uep.eternity-uep.pages.dev'
    );
  });
});

describe('Visitor Counter — 404', () => {
  it('未知路徑回傳 404', async () => {
    const req = createRequest('/api/unknown');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(404);
  });
});

describe('Visitor Counter — Site 分站計數', () => {
  it('無 ?site 參數視為 root', async () => {
    const req = createRequest('/api/visitor/count');
    const res = await worker.fetch(req, env, ctx);
    const data = (await res.json()) as { site: string };
    expect(data.site).toBe('root');
  });

  it('?site=root 與無參數同一計數桶', async () => {
    // 先用 ?site=root 追蹤一次
    const trackReq = createRequest(
      '/api/visitor/track?site=root',
      { method: 'POST' },
      'http://localhost:4321',
      '-alias'
    );
    await worker.fetch(trackReq, env, ctx);

    // 用無參數讀取，應該看到累計計數（含歷史 + 剛才 track 的 -alias fingerprint）
    const countA = await worker.fetch(
      createRequest('/api/visitor/count'),
      env,
      ctx
    );
    const dataA = (await countA.json()) as { totalVisitors: number };

    // 用 ?site=root 讀取，應該完全相同
    const countB = await worker.fetch(
      createRequest('/api/visitor/count?site=root'),
      env,
      ctx
    );
    const dataB = (await countB.json()) as { totalVisitors: number };

    expect(dataB.totalVisitors).toBe(dataA.totalVisitors);
  });

  it('?site=uep 是獨立計數桶，不受 root track 影響', async () => {
    // uep 初始應為 0（獨立桶）
    const uepCountInitial = await worker.fetch(
      createRequest('/api/visitor/count?site=uep'),
      env,
      ctx
    );
    const uepInitial = (await uepCountInitial.json()) as {
      totalVisitors: number;
      site: string;
    };
    expect(uepInitial.site).toBe('uep');
    // 前面 root 追蹤沒動 uep 桶
    const uepBefore = uepInitial.totalVisitors;

    // 對 uep 追蹤一次
    const trackReq = createRequest(
      '/api/visitor/track?site=uep',
      { method: 'POST' },
      'http://localhost:4321',
      '-uepfp'
    );
    const trackRes = await worker.fetch(trackReq, env, ctx);
    const trackData = (await trackRes.json()) as {
      totalVisitors: number;
      tracked: boolean;
      site: string;
    };
    expect(trackData.site).toBe('uep');
    expect(trackData.tracked).toBe(true);
    expect(trackData.totalVisitors).toBe(uepBefore + 1);

    // 再讀 uep 應是 +1，root 不受影響
    const uepAfter = (await (
      await worker.fetch(createRequest('/api/visitor/count?site=uep'), env, ctx)
    ).json()) as { totalVisitors: number };
    expect(uepAfter.totalVisitors).toBe(uepBefore + 1);
  });

  it('同一 fingerprint 分別對 root 和 uep 追蹤都能各計一次（分桶 dedup）', async () => {
    // 用相同 fingerprint（同 CF-Connecting-IP 尾綴）分別打 root/uep
    const rootBefore = (await (
      await worker.fetch(
        createRequest('/api/visitor/count?site=root'),
        env,
        ctx
      )
    ).json()) as { totalVisitors: number };
    const uepBefore = (await (
      await worker.fetch(createRequest('/api/visitor/count?site=uep'), env, ctx)
    ).json()) as { totalVisitors: number };

    const rootReq = createRequest(
      '/api/visitor/track?site=root',
      { method: 'POST' },
      'http://localhost:4321',
      '-shared'
    );
    await worker.fetch(rootReq, env, ctx);

    const uepReq = createRequest(
      '/api/visitor/track?site=uep',
      { method: 'POST' },
      'http://localhost:4321',
      '-shared'
    );
    await worker.fetch(uepReq, env, ctx);

    // 兩邊應該都 +1（同 fingerprint 但分桶 dedup，不會互相封鎖）
    const rootAfter = (await (
      await worker.fetch(
        createRequest('/api/visitor/count?site=root'),
        env,
        ctx
      )
    ).json()) as { totalVisitors: number };
    const uepAfter = (await (
      await worker.fetch(createRequest('/api/visitor/count?site=uep'), env, ctx)
    ).json()) as { totalVisitors: number };

    expect(rootAfter.totalVisitors).toBe(rootBefore.totalVisitors + 1);
    expect(uepAfter.totalVisitors).toBe(uepBefore.totalVisitors + 1);
  });

  it('非法 ?site 值 fallback 到 root', async () => {
    const req = createRequest('/api/visitor/count?site=hack');
    const res = await worker.fetch(req, env, ctx);
    const data = (await res.json()) as { site: string };
    expect(data.site).toBe('root');
  });
});
