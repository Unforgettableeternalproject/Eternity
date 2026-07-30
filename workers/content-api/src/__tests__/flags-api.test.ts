import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * 自訂旗標註冊表的 CRUD 與全站巡查（/api/flags*）
 *
 * 巡查的重點不在「掃得到」而在**分類正確**：規則生成的旗標沒有內容裡的
 * 授予點（掃描線與 echo spot 是程式授予），若把它們算進孤兒判定，每一個
 * gate 用的 `completed:*` 都會變成假警報，清單直接失去可讀性。
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
        username: 'flags-admin',
        password: 'flags-password',
        display_name: 'Flags Admin',
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
        username: 'flags-admin',
        password: 'flags-password',
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
    data?: Record<string, unknown>;
  };
  return { status: res.status, json };
}

async function authed(
  path: string,
  options: RequestInit & { token?: string } = {}
) {
  return api(path, { ...options, token: await getAdminToken() });
}

async function postJson(path: string, body: unknown) {
  return authed(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 建一頁 History，content 可帶 FlagMarker、metadata 可帶 gate */
async function putPage(
  slug: string,
  opts: { markerFlags?: string[]; requiresFlags?: string[] }
) {
  const html = opts.markerFlags
    ? `<div data-role="progress-marker" data-grants-flags="${opts.markerFlags.join(',')}"></div><p>內文</p>`
    : '<p>內文</p>';
  return authed(`/api/content/history/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: slug,
      pageType: 'section',
      content: [{ type: 'rich_text', content: html }],
      metadata: opts.requiresFlags
        ? { gate: { requiresFlags: opts.requiresFlags } }
        : {},
    }),
  });
}

interface AuditRow {
  name: string;
  source: string;
  grantedBy: { pageId: string }[];
  requiredBy: { pageId: string }[];
  orphan: boolean;
  unused: boolean;
}

async function audit(): Promise<AuditRow[]> {
  const { json } = await authed('/api/flags/audit');
  return (json.data?.flags as AuditRow[]) || [];
}

describe('/api/flags — 註冊表 CRUD', () => {
  it('POST 註冊新旗標 → 201', async () => {
    const { status, json } = await postJson('/api/flags', {
      name: 'act1-truth-revealed',
      label: '真相揭露',
      category: 'story',
    });
    expect(status).toBe(201);
    expect(json.data?.flag).toMatchObject({
      name: 'act1-truth-revealed',
      label: '真相揭露',
      category: 'story',
      description: null,
    });
  });

  it('POST 重複名稱 → 409', async () => {
    const { status } = await postJson('/api/flags', {
      name: 'act1-truth-revealed',
    });
    expect(status).toBe(409);
  });

  /**
   * 規則生成形狀的名稱由程式依 key 推導，註冊它等於在 key 定義之外
   * 開第二個事實來源。
   */
  it('POST 規則生成形狀 → 400', async () => {
    for (const name of ['completed:history/x', 'foo:song', 'met:novia']) {
      const { status } = await postJson('/api/flags', { name });
      expect(status, name).toBe(400);
    }
  });

  it('POST 缺名稱 → 400', async () => {
    const { status } = await postJson('/api/flags', { label: '沒有名字' });
    expect(status).toBe(400);
  });

  it('GET 清單可依 category 過濾', async () => {
    await postJson('/api/flags', { name: 'debug-skip', category: 'debug' });
    const all = await authed('/api/flags');
    expect((all.json.data?.flags as unknown[]).length).toBeGreaterThanOrEqual(
      2
    );
    const debugOnly = await authed('/api/flags?category=debug');
    expect(debugOnly.json.data?.flags).toEqual([
      expect.objectContaining({ name: 'debug-skip', category: 'debug' }),
    ]);
  });

  it('PUT 更新 label／description／category', async () => {
    const { status, json } = await authed('/api/flags/act1-truth-revealed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: '改過的標籤', description: '說明' }),
    });
    expect(status).toBe(200);
    expect(json.data?.flag).toMatchObject({
      label: '改過的標籤',
      description: '說明',
      // PUT 是整份替換：沒帶的欄位收斂成 NULL，不是保持原值
      category: null,
    });
  });

  it('PUT 不存在的旗標 → 404', async () => {
    const { status } = await authed('/api/flags/never-registered', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'x' }),
    });
    expect(status).toBe(404);
  });

  it('全段未授權 → 401', async () => {
    expect((await api('/api/flags')).status).toBe(401);
    expect((await api('/api/flags/audit')).status).toBe(401);
    expect(
      (
        await api('/api/flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'sneaky' }),
        })
      ).status
    ).toBe(401);
  });

  /**
   * `audit` 若被 `/flags/:name` 的正規式吃掉，就會被當成一個名為 audit
   * 的旗標，PUT/DELETE 打上去會改到不存在的東西。
   */
  it('/flags/audit 不被 /flags/:name 路由吃掉', async () => {
    const { status, json } = await authed('/api/flags/audit');
    expect(status).toBe(200);
    expect(Array.isArray(json.data?.flags)).toBe(true);
  });
});

describe('/api/flags/audit — 全站巡查', () => {
  beforeAll(async () => {
    await postJson('/api/flags', { name: 'audit-registered-both' });
    await postJson('/api/flags', { name: 'audit-orphan' });
    await postJson('/api/flags', { name: 'audit-unused' });
    await postJson('/api/flags', { name: 'audit-never-used' });

    // 授予端 + 需求端都有
    await putPage('audit/grants-both', {
      markerFlags: ['audit-registered-both', 'audit-unused'],
    });
    await putPage('audit/requires-both', {
      requiresFlags: ['audit-registered-both', 'audit-orphan'],
    });
    // 內容裡在用但沒註冊
    await putPage('audit/unregistered', {
      markerFlags: ['audit-unregistered'],
    });
    // 規則生成旗標被 gate 要求（授予端在程式裡，內容裡找不到）
    await putPage('audit/derived-required', {
      requiresFlags: ['completed:history/audit/grants-both'],
    });
  });

  it('授予端與需求端都掃到，且分類為 registered', async () => {
    const row = (await audit()).find((f) => f.name === 'audit-registered-both');
    expect(row?.source).toBe('registered');
    expect(row?.grantedBy.map((g) => g.pageId)).toContain(
      'history/audit/grants-both'
    );
    expect(row?.requiredBy.map((r) => r.pageId)).toContain(
      'history/audit/requires-both'
    );
    expect(row).toMatchObject({ orphan: false, unused: false });
  });

  it('有人要求但沒人授予 → orphan', async () => {
    const row = (await audit()).find((f) => f.name === 'audit-orphan');
    expect(row).toMatchObject({ orphan: true, unused: false });
  });

  it('有授予但沒人要求 → unused', async () => {
    const row = (await audit()).find((f) => f.name === 'audit-unused');
    expect(row).toMatchObject({ orphan: false, unused: true });
  });

  it('內容在用但註冊表沒有 → unregistered', async () => {
    const row = (await audit()).find((f) => f.name === 'audit-unregistered');
    expect(row?.source).toBe('unregistered');
  });

  it('註冊了但完全沒用到也會列出', async () => {
    const row = (await audit()).find((f) => f.name === 'audit-never-used');
    expect(row).toMatchObject({
      source: 'registered',
      orphan: false,
      unused: false,
    });
    expect(row?.grantedBy).toEqual([]);
    expect(row?.requiredBy).toEqual([]);
  });

  /**
   * 這是本端點最容易寫錯的地方：`completed:*` 的授予端是掃描線（程式），
   * 內容裡永遠找不到 grants，若照一般規則判定就會全部變孤兒。
   */
  it('規則生成旗標標為 derived，且不因無授予端被誤判成 orphan', async () => {
    const row = (await audit()).find(
      (f) => f.name === 'completed:history/audit/grants-both'
    );
    expect(row?.source).toBe('derived');
    expect(row?.requiredBy.length).toBeGreaterThan(0);
    expect(row?.grantedBy).toEqual([]);
    expect(row?.orphan).toBe(false);
  });
});

describe('DELETE /api/flags/:name — 引用檢查', () => {
  beforeAll(async () => {
    await postJson('/api/flags', { name: 'del-referenced' });
    await postJson('/api/flags', { name: 'del-free' });
    await putPage('del/holder', { markerFlags: ['del-referenced'] });
  });

  it('有引用時 → 409 並列出引用清單', async () => {
    const { status, json } = await authed('/api/flags/del-referenced', {
      method: 'DELETE',
    });
    expect(status).toBe(409);
    const refs = json.data?.references as {
      grantedBy: { pageId: string }[];
    };
    expect(refs.grantedBy.map((g) => g.pageId)).toContain('history/del/holder');
  });

  it('無引用時直接刪除', async () => {
    const { status } = await authed('/api/flags/del-free', {
      method: 'DELETE',
    });
    expect(status).toBe(200);
    const { status: again } = await authed('/api/flags/del-free', {
      method: 'DELETE',
    });
    expect(again).toBe(404);
  });

  /**
   * 強制刪除只移除註冊列、不動內容——所以那個旗標會在下次巡查以
   * unregistered 出現，而不是靜默消失。
   */
  it('?force=true 強制刪除後，該旗標於巡查顯示 unregistered', async () => {
    const { status } = await authed('/api/flags/del-referenced?force=true', {
      method: 'DELETE',
    });
    expect(status).toBe(200);
    const row = (await audit()).find((f) => f.name === 'del-referenced');
    expect(row?.source).toBe('unregistered');
    expect(row?.grantedBy.length).toBeGreaterThan(0);
  });
});
