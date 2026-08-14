import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * 主站 R2 資產上傳的型別白名單測試。
 *
 * 白名單是安全邊界：擋掉可執行內容與任意檔案，只放行內容編輯真正需要的媒體型別。
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

let adminToken: string | undefined;

async function getAdminToken() {
  if (adminToken) return adminToken;

  await worker.fetch(
    createRequest('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'asset-admin',
        password: 'asset-password',
        display_name: 'Asset Admin',
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
        username: 'asset-admin',
        password: 'asset-password',
      }),
    }),
    env,
    ctx
  );
  const json = (await res.json()) as { data?: { token?: string } };
  adminToken = json.data?.token;
  return adminToken;
}

function createRequest(
  path: string,
  options: RequestInit & { token?: string } = {}
) {
  const { token, ...init } = options;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Origin', 'http://localhost:4320');
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function upload(name: string, type: string, key?: string) {
  const token = await getAdminToken();
  const form = new FormData();
  form.set('file', new File([new Uint8Array([1, 2, 3, 4])], name, { type }));
  if (key) form.set('key', key);
  const res = await worker.fetch(
    createRequest('/api/root/assets', { method: 'POST', body: form, token }),
    env,
    ctx
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, any>,
  };
}

describe('POST /api/root/assets — 型別白名單', () => {
  beforeAll(async () => {
    await getAdminToken();
  });

  it('放行 image/webp', async () => {
    const { status, body } = await upload('shot.webp', 'image/webp');
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
  });

  it('放行 video/mp4', async () => {
    const { status, body } = await upload(
      'clip.mp4',
      'video/mp4',
      'images/projects/demo/clip.mp4'
    );
    expect(status).toBe(201);
    expect(body.data.key).toBe('images/projects/demo/clip.mp4');
  });

  it('放行 video/webm', async () => {
    const { status } = await upload('clip.webm', 'video/webm');
    expect(status).toBe(201);
  });

  it('擋下不在白名單的型別', async () => {
    const { status, body } = await upload('payload.html', 'text/html');
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it('未帶認證一律 401', async () => {
    const form = new FormData();
    form.set(
      'file',
      new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    );
    const res = await worker.fetch(
      createRequest('/api/root/assets', { method: 'POST', body: form }),
      env,
      ctx
    );
    expect(res.status).toBe(401);
  });
});
