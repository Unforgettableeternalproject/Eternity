import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * 站台行為設定（/api/settings*，S10-3b T-B3）
 *
 * 重點契約：空表回完整預設值（不因缺列報錯或回 null）、局部更新不動
 * 其餘鍵、整批驗證失敗不寫入一半、/public 匿名可讀。
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

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
        username: 'settings-admin',
        password: 'settings-password',
        display_name: 'Settings Admin',
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
        username: 'settings-admin',
        password: 'settings-password',
      }),
    }),
    env,
    ctx
  );
  const json = (await res.json()) as { data?: { token?: string } };
  adminToken = json.data?.token as string;
  return adminToken;
}

async function api(
  path: string,
  options: RequestInit & { token?: string } = {}
) {
  const res = await worker.fetch(createRequest(path, options), env, ctx);
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    data?: { settings?: Record<string, unknown> };
  };
  return { status: res.status, json, headers: res.headers };
}

async function putSettings(body: unknown) {
  return api('/api/settings', {
    method: 'PUT',
    token: await getAdminToken(),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/settings', () => {
  it('未授權 → 401；/public 匿名可讀', async () => {
    expect((await api('/api/settings')).status).toBe(401);

    const pub = await api('/api/settings/public');
    expect(pub.status).toBe(200);
    expect(pub.json.data?.settings).toBeDefined();
  });

  it('表為空時回完整四項預設值，不報錯不回 null', async () => {
    await env.CONTENT_DB.prepare('DELETE FROM uep_settings').run();
    const { status, json, headers } = await api('/api/settings', {
      token: await getAdminToken(),
    });
    expect(status).toBe(200);
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(json.data?.settings).toEqual({
      'protection.mode': 'env',
      'bookmark.baseChancePct': 20,
      'note.max': 30,
      'note.textMax': 200,
    });
  });

  it('PUT 局部更新一項，其餘三項不受影響', async () => {
    await env.CONTENT_DB.prepare('DELETE FROM uep_settings').run();
    const { status, json } = await putSettings({ 'note.max': 12 });
    expect(status).toBe(200);
    expect(json.data?.settings).toMatchObject({
      'note.max': 12,
      'note.textMax': 200,
      'protection.mode': 'env',
    });

    // 再更新另一項，先前的值保留
    const second = await putSettings({ 'protection.mode': 'never' });
    expect(second.json.data?.settings).toMatchObject({
      'note.max': 12,
      'protection.mode': 'never',
    });
  });

  it('驗證整批進行：任何一鍵壞掉整批拒絕，不寫入一半', async () => {
    await env.CONTENT_DB.prepare('DELETE FROM uep_settings').run();
    const { status } = await putSettings({
      'note.max': 5,
      'protection.mode': 'sometimes',
    });
    expect(status).toBe(400);

    const after = await api('/api/settings', { token: await getAdminToken() });
    // note.max 沒有被順手寫進去
    expect(after.json.data?.settings?.['note.max']).toBe(30);
  });

  it('未知鍵與壞型別 → 400', async () => {
    expect((await putSettings({ 'fog.ratio': 0.5 })).status).toBe(400);
    expect((await putSettings({ 'note.max': '十二' })).status).toBe(400);
    expect((await putSettings({ 'bookmark.baseChancePct': 130 })).status).toBe(
      400
    );
    expect((await putSettings({})).status).toBe(400);
  });

  it('表裡的壞 JSON 靜默退回預設，不讓端點 500', async () => {
    await env.CONTENT_DB.prepare(
      `INSERT OR REPLACE INTO uep_settings (key, value, updated_at)
       VALUES ('note.max', '{broken', datetime('now'))`
    ).run();
    const { status, json } = await api('/api/settings', {
      token: await getAdminToken(),
    });
    expect(status).toBe(200);
    expect(json.data?.settings?.['note.max']).toBe(30);
  });
});
