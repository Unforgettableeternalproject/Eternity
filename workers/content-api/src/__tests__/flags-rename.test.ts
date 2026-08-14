import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

import {
  renameFlagInHtml,
  renameFlagInMetadata,
  validateRenameTarget,
} from '../flags-rename';

/**
 * 旗標改名三段式（POST /api/flags/:name/rename）
 *
 * 改名改的是 HTML 字串，改壞等於損毀文章，所以測試分兩層：
 * - 純函式層：只動命中的屬性、正文裡的同名字串不受影響、屬性數量守恆
 * - 端點層：dryRun 不寫入、實際寫入兩種載體都改到、註冊表同步改名
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
        username: 'rename-admin',
        password: 'rename-password',
        display_name: 'Rename Admin',
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
        username: 'rename-admin',
        password: 'rename-password',
      }),
    }),
    env,
    ctx
  );
  const json = (await res.json()) as { data?: { token?: string } };
  adminToken = json.data?.token as string;
  return adminToken;
}

async function authed(
  path: string,
  options: RequestInit & { token?: string } = {}
) {
  const res = await worker.fetch(
    createRequest(path, { ...options, token: await getAdminToken() }),
    env,
    ctx
  );
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    data?: Record<string, unknown>;
  };
  return { status: res.status, json };
}

async function postJson(path: string, body: unknown) {
  return authed(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putPage(
  slug: string,
  opts: { html?: string; requiresFlags?: string[] }
) {
  return authed(`/api/content/history/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: slug,
      pageType: 'section',
      content: [{ type: 'rich_text', content: opts.html ?? '<p>內文</p>' }],
      metadata: opts.requiresFlags
        ? { gate: { requiresFlags: opts.requiresFlags } }
        : {},
    }),
  });
}

async function getPage(slug: string) {
  const { json } = await authed(`/api/content/history/${slug}`);
  return json.data as {
    content: { content: string }[];
    metadata: Record<string, unknown>;
    status: string;
  };
}

function marker(flags: string) {
  return `<div data-role="progress-marker" data-grants-flags="${flags}"></div>`;
}

describe('renameFlagInHtml — 只動命中的屬性', () => {
  it('替換清單中的完整項目，其餘旗標保持原位', () => {
    const html = marker('keep-a,old-name,keep-b');
    const { html: next, hits } = renameFlagInHtml(html, 'old-name', 'new-name');
    expect(hits).toBe(1);
    expect(next).toContain('data-grants-flags="keep-a,new-name,keep-b"');
  });

  it('正文裡提到同名字串完全不受影響（不做全文替換）', () => {
    const html = `<p>這一段提到 old-name 這個字</p>${marker('old-name')}<p>old-name 又出現</p>`;
    const { html: next, hits } = renameFlagInHtml(html, 'old-name', 'new-name');
    expect(hits).toBe(1);
    // 正文兩處原封不動
    expect(next).toContain('<p>這一段提到 old-name 這個字</p>');
    expect(next).toContain('<p>old-name 又出現</p>');
    expect(next).toContain('data-grants-flags="new-name"');
  });

  it('部分相符的旗標名不被誤改', () => {
    const html = marker('old-name-extra,prefix-old-name');
    const { html: next, hits } = renameFlagInHtml(html, 'old-name', 'new-name');
    expect(hits).toBe(0);
    expect(next).toBe(html);
  });

  it('同一個 marker 同時有舊名與新名時合併去重', () => {
    const html = marker('old-name,new-name');
    const { html: next, hits } = renameFlagInHtml(html, 'old-name', 'new-name');
    expect(hits).toBe(1);
    expect(next).toContain('data-grants-flags="new-name"');
  });

  it('屬性數量守恆（R2 緩解機制的自動化斷言）', () => {
    const html = `${marker('old-name')}<p>x</p>${marker('other,old-name')}`;
    const before = (html.match(/data-grants-flags="/g) || []).length;
    const { html: next, hits } = renameFlagInHtml(html, 'old-name', 'new-name');
    const after = (next.match(/data-grants-flags="/g) || []).length;
    expect(hits).toBe(2);
    expect(after).toBe(before);
  });

  it('marker 的其他屬性與 data-role 不被動到', () => {
    const html =
      '<div data-label="註記" data-role="progress-marker" data-grants-flags="old-name"></div>';
    const { html: next } = renameFlagInHtml(html, 'old-name', 'new-name');
    expect(next).toContain('data-label="註記"');
    expect(next).toContain('data-role="progress-marker"');
  });
});

describe('renameFlagInMetadata — 兩種 gate 形狀都要吃', () => {
  it('巢狀 gate', () => {
    const raw = JSON.stringify({ gate: { requiresFlags: ['a', 'old-name'] } });
    const { metadata, hits } = renameFlagInMetadata(raw, 'old-name', 'new');
    expect(hits).toBe(1);
    expect(JSON.parse(metadata!)).toEqual({
      gate: { requiresFlags: ['a', 'new'] },
    });
  });

  it('平鋪形狀（parseGateCondition 的相容行為）', () => {
    const raw = JSON.stringify({ requiresFlags: ['old-name'] });
    const { metadata, hits } = renameFlagInMetadata(raw, 'old-name', 'new');
    expect(hits).toBe(1);
    expect(JSON.parse(metadata!)).toEqual({ requiresFlags: ['new'] });
  });

  it('巢狀 gate 的其他欄位保留', () => {
    const raw = JSON.stringify({
      progressPage: true,
      gate: { requiresFlags: ['old-name'], pristineOnly: true },
    });
    const { metadata } = renameFlagInMetadata(raw, 'old-name', 'new');
    expect(JSON.parse(metadata!)).toEqual({
      progressPage: true,
      gate: { requiresFlags: ['new'], pristineOnly: true },
    });
  });

  it('沒命中回 null（不需要寫入）', () => {
    const raw = JSON.stringify({ gate: { requiresFlags: ['other'] } });
    expect(renameFlagInMetadata(raw, 'old-name', 'new').metadata).toBeNull();
  });

  it('壞 JSON 不炸（視為無 gate）', () => {
    expect(renameFlagInMetadata('{壞', 'old-name', 'new').hits).toBe(0);
  });
});

describe('validateRenameTarget — 會破壞序列化的字元一律拒絕', () => {
  it('空名稱', () => {
    expect(validateRenameTarget('  ')).toContain('缺少');
  });

  it('derived 形狀', () => {
    expect(validateRenameTarget('completed:history/x')).toContain('規則生成');
    expect(validateRenameTarget('foo:song')).toContain('規則生成');
  });

  it('逗號會讓旗標在序列化後裂成兩個', () => {
    expect(validateRenameTarget('a,b')).toContain('逗號');
  });

  it('雙引號會提前結束 HTML 屬性', () => {
    expect(validateRenameTarget('a"b')).toContain('雙引號');
  });

  it('合法名稱通過', () => {
    expect(validateRenameTarget('act2-betrayal')).toBeNull();
  });
});

describe('POST /api/flags/:name/rename — 端點', () => {
  it('未註冊的旗標改不了（404）', async () => {
    const { status } = await postJson('/api/flags/never-existed/rename', {
      to: 'whatever',
    });
    expect(status).toBe(404);
  });

  it('dryRun 只回預覽不寫入', async () => {
    await postJson('/api/flags', { name: 'dry-old' });
    await putPage('rename-dry', {
      html: `${marker('dry-old')}<p>內文</p>`,
      requiresFlags: ['dry-old'],
    });

    const { status, json } = await postJson('/api/flags/dry-old/rename', {
      to: 'dry-new',
      dryRun: true,
    });
    expect(status).toBe(200);
    expect(json.data?.dryRun).toBe(true);
    expect(json.data?.written).toBe(0);
    expect(json.data?.totalHits).toBe(2);
    const pages = json.data?.pages as { pageId: string }[];
    expect(pages.map((p) => p.pageId)).toContain('history/rename-dry');

    // 內容與註冊表都還是舊名
    const page = await getPage('rename-dry');
    expect(page.content[0].content).toContain('data-grants-flags="dry-old"');
    const { json: list } = await authed('/api/flags');
    const names = (list.data?.flags as { name: string }[]).map((f) => f.name);
    expect(names).toContain('dry-old');
    expect(names).not.toContain('dry-new');
  });

  it('實際寫入：兩種載體與註冊表一起改名', async () => {
    await postJson('/api/flags', { name: 'live-old', label: '舊標籤' });
    // 同批出現的旗標也得先註冊，否則 T-A4 的強制註冊會擋掉存檔
    await postJson('/api/flags', { name: 'keep' });
    await postJson('/api/flags', { name: 'other' });
    const grant = await putPage('rename-grant', {
      html: `${marker('keep,live-old')}<p>提到 live-old 的正文</p>`,
    });
    expect(grant.json.ok).toBe(true);
    const require = await putPage('rename-require', {
      requiresFlags: ['live-old', 'other'],
    });
    expect(require.json.ok).toBe(true);

    const { json } = await postJson('/api/flags/live-old/rename', {
      to: 'live-new',
    });
    expect(json.data?.dryRun).toBe(false);
    expect(json.data?.written).toBe(2);

    const granting = await getPage('rename-grant');
    expect(granting.content[0].content).toContain(
      'data-grants-flags="keep,live-new"'
    );
    // 正文的同名字串沒被動到
    expect(granting.content[0].content).toContain('提到 live-old 的正文');

    const requiring = await getPage('rename-require');
    expect(requiring.metadata).toEqual({
      gate: { requiresFlags: ['live-new', 'other'] },
    });

    const { json: list } = await authed('/api/flags');
    const flags = list.data?.flags as { name: string; label: string | null }[];
    expect(flags.find((f) => f.name === 'live-new')?.label).toBe('舊標籤');
    expect(flags.find((f) => f.name === 'live-old')).toBeUndefined();
  });

  it('改名後的頁面存得回去（新名已在註冊表，不被 409 擋）', async () => {
    await postJson('/api/flags', { name: 'save-old' });
    await putPage('rename-save', { html: marker('save-old') });
    await postJson('/api/flags/save-old/rename', { to: 'save-new' });

    const page = await getPage('rename-save');
    const { status } = await putPage('rename-save', {
      html: page.content[0].content,
    });
    expect(status).toBe(200);
  });

  it('新名稱已被註冊 → 409（不做合併）', async () => {
    await postJson('/api/flags', { name: 'clash-a' });
    await postJson('/api/flags', { name: 'clash-b' });
    const { status } = await postJson('/api/flags/clash-a/rename', {
      to: 'clash-b',
    });
    expect(status).toBe(409);
  });

  it('新舊同名 → 400', async () => {
    await postJson('/api/flags', { name: 'same-name' });
    const { status } = await postJson('/api/flags/same-name/rename', {
      to: 'same-name',
    });
    expect(status).toBe(400);
  });

  it('改成 derived 形狀 → 400', async () => {
    await postJson('/api/flags', { name: 'to-derived' });
    const { status, json } = await postJson('/api/flags/to-derived/rename', {
      to: 'something:song',
    });
    expect(status).toBe(400);
    expect(json.error).toContain('規則生成');
  });

  it('沒有任何引用時也能改名（只動註冊表）', async () => {
    await postJson('/api/flags', { name: 'lonely-old' });
    const { json } = await postJson('/api/flags/lonely-old/rename', {
      to: 'lonely-new',
    });
    expect(json.data?.totalHits).toBe(0);
    expect(json.data?.written).toBe(0);
    const { json: list } = await authed('/api/flags');
    const names = (list.data?.flags as { name: string }[]).map((f) => f.name);
    expect(names).toContain('lonely-new');
    expect(names).not.toContain('lonely-old');
  });

  it('未授權一律 401', async () => {
    const res = await worker.fetch(
      createRequest('/api/flags/x/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'y' }),
      }),
      env,
      ctx
    );
    expect(res.status).toBe(401);
  });
});
