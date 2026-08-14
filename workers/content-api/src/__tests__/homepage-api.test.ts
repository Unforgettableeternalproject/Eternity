import { describe, it, expect, afterAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * 首頁區塊（/api/homepage*）
 *
 * 這個端點在 2026-08-02 之前是全部寫入端點裡**唯一**在 isWriteMethod 的
 * isAuthorized 之外還額外要求 admin JWT 的。代價很具體：seed 腳本用
 * API_TOKEN 跑時其他表全成功、只有 site_homepage 整批 401，test 環境首頁
 * 因此空了兩個多月。
 *
 * 端點沒有任何測試是它能潛伏那麼久的另一半原因，所以這裡把授權契約釘死：
 * **API_TOKEN 與 admin JWT 都可寫，匿名一律 401。**
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

const API_TOKEN = 'homepage-test-token';
const originalApiToken = (env as { API_TOKEN?: string }).API_TOKEN;
(env as { API_TOKEN?: string }).API_TOKEN = API_TOKEN;

afterAll(() => {
  (env as { API_TOKEN?: string }).API_TOKEN = originalApiToken;
});

function createRequest(
  path: string,
  options: RequestInit & { token?: string } = {}
) {
  const { token, ...init } = options;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return new Request(`https://example.com${path}`, { ...init, headers });
}

let adminToken: string | undefined;

async function getAdminToken(): Promise<string> {
  if (adminToken) return adminToken;
  await worker.fetch(
    createRequest('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'homepage-admin',
        password: 'homepage-password',
        display_name: 'Homepage Admin',
      }),
    }),
    env,
    ctx
  );
  const res = await worker.fetch(
    createRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'homepage-admin',
        password: 'homepage-password',
      }),
    }),
    env,
    ctx
  );
  const json = (await res.json()) as { data?: { token?: string } };
  adminToken = json.data?.token as string;
  return adminToken;
}

async function putSection(sectionId: string, content: unknown, token?: string) {
  const res = await worker.fetch(
    createRequest(`/api/homepage/${sectionId}`, {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
    env,
    ctx
  );
  return { status: res.status, json: await res.json() };
}

describe('/api/homepage', () => {
  it('匿名寫入一律 401', async () => {
    const { status } = await putSection('hero', { title: '匿名' });
    expect(status).toBe(401);
  });

  it('亂數 token 也是 401', async () => {
    const { status } = await putSection(
      'hero',
      { title: 'x' },
      'not-the-token'
    );
    expect(status).toBe(401);
  });

  it('API_TOKEN 可寫——CLI／seed 腳本走的就是這條', async () => {
    const { status } = await putSection(
      'hero',
      { title: '用 API_TOKEN 寫的' },
      API_TOKEN
    );
    expect(status).toBe(200);

    const res = await worker.fetch(createRequest('/api/homepage'), env, ctx);
    const json = (await res.json()) as {
      data?: Record<string, { content?: { title?: string } }>;
    };
    expect(json.data?.hero?.content?.title).toBe('用 API_TOKEN 寫的');
  });

  it('admin JWT 一樣可寫（admin 面板走的路徑）', async () => {
    const { status } = await putSection(
      'atlas',
      { title: '用 JWT 寫的' },
      await getAdminToken()
    );
    expect(status).toBe(200);
  });

  it('content 缺漏 → 400，不是靜默寫入空區塊', async () => {
    const res = await worker.fetch(
      createRequest('/api/homepage/verse', {
        method: 'PUT',
        token: API_TOKEN,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
      ctx
    );
    expect(res.status).toBe(400);
  });

  it('GET 匿名可讀（首頁 SSR 不帶授權）', async () => {
    const res = await worker.fetch(createRequest('/api/homepage'), env, ctx);
    expect(res.status).toBe(200);
  });
});
