import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * 主站專案 isPrivateRepo 欄位的讀寫。
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

let adminToken: string | undefined;

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

async function getAdminToken() {
  if (adminToken) return adminToken;
  await worker.fetch(
    createRequest('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'private-repo-admin',
        password: 'private-repo-password',
        display_name: 'Private Repo Admin',
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
        username: 'private-repo-admin',
        password: 'private-repo-password',
      }),
    }),
    env,
    ctx
  );
  const json = (await res.json()) as { data?: { token?: string } };
  adminToken = json.data?.token;
  return adminToken;
}

interface ProjectJson {
  ok: boolean;
  data: {
    id: string;
    isPrivateRepo: boolean;
    links: { github: string | null };
  };
}

async function putProject(id: string, body: Record<string, unknown>) {
  const token = await getAdminToken();
  const res = await worker.fetch(
    createRequest(`/api/root/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      token,
    }),
    env,
    ctx
  );
  return { status: res.status, json: (await res.json()) as ProjectJson };
}

async function getProject(id: string) {
  const res = await worker.fetch(
    createRequest(`/api/root/projects/${id}`),
    env,
    ctx
  );
  return (await res.json()) as ProjectJson;
}

describe('root projects isPrivateRepo', () => {
  it('新建專案未帶欄位時預設為 false', async () => {
    const { status, json } = await putProject('repo-default', {
      titleZh: '預設',
      links: { github: 'https://github.com/example/public' },
    });
    expect(status).toBe(201);
    expect(json.data.isPrivateRepo).toBe(false);
  });

  it('新建時可直接標示私人，且 github 原值保留供後台編輯', async () => {
    const { json } = await putProject('repo-private-insert', {
      titleZh: '私人',
      isPrivateRepo: true,
      links: { github: 'https://github.com/example/secret' },
    });
    expect(json.data.isPrivateRepo).toBe(true);
    expect(json.data.links.github).toBe('https://github.com/example/secret');

    const fetched = await getProject('repo-private-insert');
    expect(fetched.data.isPrivateRepo).toBe(true);
  });

  it('更新可切換私人旗標，未帶欄位的局部更新不改動旗標', async () => {
    await putProject('repo-toggle', { titleZh: '切換' });

    const on = await putProject('repo-toggle', { isPrivateRepo: true });
    expect(on.status).toBe(200);
    expect(on.json.data.isPrivateRepo).toBe(true);

    const partial = await putProject('repo-toggle', { titleZh: '改標題' });
    expect(partial.json.data.isPrivateRepo).toBe(true);

    const off = await putProject('repo-toggle', { isPrivateRepo: false });
    expect(off.json.data.isPrivateRepo).toBe(false);
  });

  it('列表回傳包含 isPrivateRepo', async () => {
    await putProject('repo-list', { titleZh: '列表', isPrivateRepo: true });
    const res = await worker.fetch(
      createRequest('/api/root/projects'),
      env,
      ctx
    );
    const json = (await res.json()) as { data: ProjectJson['data'][] };
    const row = json.data.find((p) => p.id === 'repo-list');
    expect(row?.isPrivateRepo).toBe(true);
  });
});
