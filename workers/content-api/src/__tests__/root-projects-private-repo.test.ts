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

describe('root projects 私人 repo 對未授權讀者隱藏 github', () => {
  const PRIVATE_URL = 'https://github.com/example/hidden-secret';
  const PUBLIC_URL = 'https://github.com/example/open';

  async function seed() {
    await putProject('redact-private', {
      titleZh: '私人',
      isPrivateRepo: true,
      links: {
        github: PRIVATE_URL,
        demo: 'https://demo.example',
        website: 'https://site.example',
      },
    });
    await putProject('redact-public', {
      titleZh: '公開',
      links: { github: PUBLIC_URL },
    });
  }

  async function fetchRaw(path: string, token?: string) {
    return worker.fetch(createRequest(path, { token }), env, ctx);
  }

  it('未授權列表：私人專案 github 為 null，其他連結與公開專案照舊，可共用快取', async () => {
    await seed();
    const res = await fetchRaw('/api/root/projects');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('public');
    expect(res.headers.get('Vary')).toBe('Authorization');

    const json = (await res.json()) as {
      data: (ProjectJson['data'] & {
        links: { demo: string | null; website: string | null };
      })[];
    };
    const priv = json.data.find((p) => p.id === 'redact-private');
    const pub = json.data.find((p) => p.id === 'redact-public');
    expect(priv?.isPrivateRepo).toBe(true);
    expect(priv?.links.github).toBeNull();
    expect(priv?.links.demo).toBe('https://demo.example');
    expect(priv?.links.website).toBe('https://site.example');
    expect(pub?.links.github).toBe(PUBLIC_URL);
    expect(JSON.stringify(json)).not.toContain('hidden-secret');
  });

  it('未授權單筆：私人專案 github 為 null', async () => {
    await seed();
    const res = await fetchRaw('/api/root/projects/redact-private');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('public');
    expect(res.headers.get('Vary')).toBe('Authorization');
    const json = (await res.json()) as ProjectJson;
    expect(json.data.links.github).toBeNull();

    const pub = (await (
      await fetchRaw('/api/root/projects/redact-public')
    ).json()) as ProjectJson;
    expect(pub.data.links.github).toBe(PUBLIC_URL);
  });

  it('無效 token 視同未授權', async () => {
    await seed();
    const res = await fetchRaw('/api/root/projects/redact-private', 'bogus');
    const json = (await res.json()) as ProjectJson;
    expect(json.data.links.github).toBeNull();
    expect(res.headers.get('Cache-Control')).toContain('public');
  });

  it('管理員列表與單筆：完整 github，private, no-store', async () => {
    await seed();
    const token = await getAdminToken();

    const list = await fetchRaw('/api/root/projects', token);
    expect(list.headers.get('Cache-Control')).toBe('private, no-store');
    expect(list.headers.get('Vary')).toBe('Authorization');
    const listJson = (await list.json()) as { data: ProjectJson['data'][] };
    expect(
      listJson.data.find((p) => p.id === 'redact-private')?.links.github
    ).toBe(PRIVATE_URL);

    const single = await fetchRaw('/api/root/projects/redact-private', token);
    expect(single.headers.get('Cache-Control')).toBe('private, no-store');
    expect(single.headers.get('Vary')).toBe('Authorization');
    const singleJson = (await single.json()) as ProjectJson;
    expect(singleJson.data.links.github).toBe(PRIVATE_URL);
  });

  it('include_deleted 仍需認證；授權時回完整 github', async () => {
    await seed();
    const anon = await fetchRaw('/api/root/projects?include_deleted=true');
    expect(anon.status).toBe(401);

    const token = await getAdminToken();
    const authed = await fetchRaw(
      '/api/root/projects?include_deleted=true',
      token
    );
    expect(authed.status).toBe(200);
    expect(authed.headers.get('Cache-Control')).toBe('private, no-store');
    const json = (await authed.json()) as { data: ProjectJson['data'][] };
    expect(json.data.find((p) => p.id === 'redact-private')?.links.github).toBe(
      PRIVATE_URL
    );
  });

  it('404 不帶快取標頭', async () => {
    const res = await fetchRaw('/api/root/projects/no-such-project');
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});
