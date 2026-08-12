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

  it('表為空時回完整預設值，不報錯不回 null', async () => {
    await env.CONTENT_DB.prepare('DELETE FROM uep_settings').run();
    const { status, json, headers } = await api('/api/settings', {
      token: await getAdminToken(),
    });
    expect(status).toBe(200);
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(json.data?.settings).toEqual({
      'protection.mode': 'env',
      'protection.noChancePct': 10,
      'home.lobbyArtChancePct': 40,
      'bookmark.baseChancePct': 20,
      'bookmark.stepChancePct': 20,
      'echoes.lostOrbChancePct': 6,
      'visuals.phantomEnterChancePct': 8,
      'visuals.phantomSwitchChancePct': 18,
      'storage.loneNoteDustSteps': 10,
      'note.max': 30,
      'note.textMax': 200,
      'reader.activityIdleThresholdSec': 180,
      'reader.idleNudgeMode': 'enabled',
      'reader.restActiveMinutes': 75,
      'reader.restPageCount': 8,
      'reader.restWindowMinutes': 30,
      'reader.restCooldownMinutes': 90,
      'reader.teaInviteChancePct': 10,
    });
  });

  it('機率鍵共用 0-100，兩端皆合法（0 = 關掉該項）', async () => {
    const keys = [
      'bookmark.stepChancePct',
      'echoes.lostOrbChancePct',
      'visuals.phantomEnterChancePct',
      'visuals.phantomSwitchChancePct',
      'protection.noChancePct',
      'home.lobbyArtChancePct',
      'reader.teaInviteChancePct',
    ];
    for (const key of keys) {
      expect((await putSettings({ [key]: 0 })).status).toBe(200);
      expect((await putSettings({ [key]: 100 })).status).toBe(200);
      expect((await putSettings({ [key]: -1 })).status).toBe(400);
      expect((await putSettings({ [key]: 101 })).status).toBe(400);
    }
  });

  it('機率只收整數——契約是整數百分比，小數會讓填的數字與行為對不上', async () => {
    for (const key of [
      'bookmark.baseChancePct',
      'bookmark.stepChancePct',
      'echoes.lostOrbChancePct',
      'visuals.phantomEnterChancePct',
      'visuals.phantomSwitchChancePct',
      'protection.noChancePct',
      'home.lobbyArtChancePct',
      'reader.teaInviteChancePct',
    ]) {
      expect((await putSettings({ [key]: 6.5 })).status).toBe(400);
      expect((await putSettings({ [key]: 6 })).status).toBe(200);
    }
  });

  it('紙條拍打次數下限是 1——0 等於一進頁面就自動解鎖，那不是儀式', async () => {
    expect((await putSettings({ 'storage.loneNoteDustSteps': 0 })).status).toBe(
      400
    );
    expect((await putSettings({ 'storage.loneNoteDustSteps': 1 })).status).toBe(
      200
    );
    expect(
      (await putSettings({ 'storage.loneNoteDustSteps': 50 })).status
    ).toBe(200);
    expect(
      (await putSettings({ 'storage.loneNoteDustSteps': 51 })).status
    ).toBe(400);
    // 非整數不收——抖半下沒有意義
    expect(
      (await putSettings({ 'storage.loneNoteDustSteps': 3.5 })).status
    ).toBe(400);
  });

  it('PUT 局部更新一項，其餘不受影響', async () => {
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

  it('便條上限不可超過前台載入 sanitize 的硬上限（60／400）', async () => {
    expect((await putSettings({ 'note.max': 61 })).status).toBe(400);
    expect((await putSettings({ 'note.textMax': 401 })).status).toBe(400);
    expect((await putSettings({ 'note.max': 60 })).status).toBe(200);
    expect((await putSettings({ 'note.textMax': 400 })).status).toBe(200);
  });

  it('閒置閾值沒有停用值——它是統計與休息提醒的共同事實來源', async () => {
    const key = 'reader.activityIdleThresholdSec';
    expect((await putSettings({ [key]: 0 })).status).toBe(400);
    expect((await putSettings({ [key]: 29 })).status).toBe(400);
    expect((await putSettings({ [key]: 30 })).status).toBe(200);
    expect((await putSettings({ [key]: 3600 })).status).toBe(200);
    expect((await putSettings({ [key]: 3601 })).status).toBe(400);
    expect((await putSettings({ [key]: 180.5 })).status).toBe(400);
  });

  it('idleNudgeMode 是字串 enum，只收 enabled / disabled', async () => {
    const key = 'reader.idleNudgeMode';
    expect((await putSettings({ [key]: 'enabled' })).status).toBe(200);
    expect((await putSettings({ [key]: 'disabled' })).status).toBe(200);
    expect((await putSettings({ [key]: 'sometimes' })).status).toBe(400);
    // 不是數字鍵——0 曾是其他停用開關的慣例值，這裡不能被誤收
    expect((await putSettings({ [key]: 0 })).status).toBe(400);
  });

  it('休息提醒的兩條觸發線收 0 = 停用，計算參數不收 0', async () => {
    for (const [key, max] of [
      ['reader.restActiveMinutes', 480],
      ['reader.restPageCount', 100],
    ] as const) {
      expect((await putSettings({ [key]: 0 })).status).toBe(200);
      expect((await putSettings({ [key]: max })).status).toBe(200);
      expect((await putSettings({ [key]: max + 1 })).status).toBe(400);
      expect((await putSettings({ [key]: -1 })).status).toBe(400);
    }

    for (const [key, max] of [
      ['reader.restWindowMinutes', 240],
      ['reader.restCooldownMinutes', 1440],
    ] as const) {
      expect((await putSettings({ [key]: 0 })).status).toBe(400);
      expect((await putSettings({ [key]: 1 })).status).toBe(200);
      expect((await putSettings({ [key]: max })).status).toBe(200);
      expect((await putSettings({ [key]: max + 1 })).status).toBe(400);
      expect((await putSettings({ [key]: 30.5 })).status).toBe(400);
    }
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
