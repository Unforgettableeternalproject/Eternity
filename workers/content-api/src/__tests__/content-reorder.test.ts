import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';
import { signJwt } from '../auth';

/**
 * PUT /api/content/:area/reorder — 同層子頁批次排序
 *
 * 逐筆 PUT sortOrder 會觸發 reindexChildren，中間暫態同號被 created_at
 * tie-break 拉回原順序；批次端點一次寫入最終順序。
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

const SECRET = 'test-jwt-secret';
const PARENT = 'echoes/rd-cat';
const SONGS = ['echoes/rd-cat/a', 'echoes/rd-cat/b', 'echoes/rd-cat/c'];

async function adminToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      sub: 'rd-admin',
      role: 'super_admin',
      display_name: 'admin',
      iat: now,
      exp: now + 3600,
      jti: 'rd-admin',
    },
    SECRET
  );
}

async function put(
  path: string,
  body: unknown,
  token?: string
): Promise<Response> {
  const headers = new Headers({
    Origin: 'http://localhost:4321',
    'Content-Type': 'application/json',
  });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    }),
    env,
    ctx
  );
}

async function insertPage(p: {
  id: string;
  parentId: string | null;
  sortOrder: number;
  pageType?: string;
  createdAt: string;
  deletedAt?: string | null;
}) {
  const [area, ...rest] = p.id.split('/');
  await env.CONTENT_DB.prepare(
    `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, parent_id, depth, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '[]', '{}', 'synced', ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      p.id,
      area,
      p.id,
      rest.join('/'),
      p.sortOrder,
      p.pageType ?? 'song',
      p.parentId,
      p.id.split('/').length - 1,
      p.deletedAt ?? null,
      p.createdAt,
      '2020-01-01T00:00:00.000Z'
    )
    .run();
}

async function childRows(parentId: string) {
  const result = await env.CONTENT_DB.prepare(
    'SELECT id, sort_order, status, updated_at FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC'
  )
    .bind(parentId)
    .all<{
      id: string;
      sort_order: number;
      status: string;
      updated_at: string;
    }>();
  return result.results;
}

beforeEach(async () => {
  await env.CONTENT_DB.prepare("DELETE FROM pages WHERE id LIKE 'echoes/rd-%'")
    .bind()
    .run();
  await insertPage({
    id: PARENT,
    parentId: null,
    sortOrder: 0,
    pageType: 'subcategory',
    createdAt: '2020-01-01T00:00:00.000Z',
  });
  for (const [i, id] of SONGS.entries()) {
    await insertPage({
      id,
      parentId: PARENT,
      sortOrder: i,
      createdAt: `2020-01-0${i + 1}T00:00:00.000Z`,
    });
  }
});

describe('PUT /api/content/:area/reorder', () => {
  it('一次寫入最終順序（末項移到最前，created_at tie-break 不再拉回）', async () => {
    const order = [SONGS[2], SONGS[0], SONGS[1]];
    const res = await put(
      '/api/content/echoes/reorder',
      { parentId: PARENT, order },
      await adminToken()
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { order: string[]; updated: number };
    };
    expect(json.ok).toBe(true);
    expect(json.data.order).toEqual(order);
    expect(json.data.updated).toBe(3);

    const rows = await childRows(PARENT);
    expect(rows.map((r) => r.id)).toEqual(order);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2]);
    // updated_at 前進供 sync 判方向；status 不動
    for (const r of rows) {
      expect(r.updated_at > '2020-01-01T00:00:00.000Z').toBe(true);
      expect(r.status).toBe('synced');
    }
  });

  it('只更新 sort_order 有變的列', async () => {
    const res = await put(
      '/api/content/echoes/reorder',
      { parentId: PARENT, order: [SONGS[1], SONGS[0], SONGS[2]] },
      await adminToken()
    );
    expect(res.status).toBe(200);
    const rows = await childRows(PARENT);
    const c = rows.find((r) => r.id === SONGS[2]);
    expect(c?.updated_at).toBe('2020-01-01T00:00:00.000Z');
  });

  it('子集合：列出的頁填回原位置，其他頁不動', async () => {
    // 同層夾一個非 song 子頁（編輯器清單會過濾掉）
    await insertPage({
      id: 'echoes/rd-cat/other',
      parentId: PARENT,
      sortOrder: 1,
      pageType: 'page',
      createdAt: '2020-01-01T12:00:00.000Z',
    });
    // 現況：a(0) other(1) b(1) c(2) → a other b c
    const res = await put(
      '/api/content/echoes/reorder',
      { parentId: PARENT, order: [SONGS[2], SONGS[1], SONGS[0]] },
      await adminToken()
    );
    expect(res.status).toBe(200);
    const rows = await childRows(PARENT);
    expect(rows.map((r) => r.id)).toEqual([
      SONGS[2],
      'echoes/rd-cat/other',
      SONGS[1],
      SONGS[0],
    ]);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3]);
  });

  it('軟刪除的子頁不必列入，也不影響排序', async () => {
    await insertPage({
      id: 'echoes/rd-cat/gone',
      parentId: PARENT,
      sortOrder: 0,
      createdAt: '2019-01-01T00:00:00.000Z',
      deletedAt: '2020-02-01T00:00:00.000Z',
    });
    const order = [SONGS[1], SONGS[2], SONGS[0]];
    const res = await put(
      '/api/content/echoes/reorder',
      { parentId: PARENT, order },
      await adminToken()
    );
    expect(res.status).toBe(200);
    expect((await childRows(PARENT)).map((r) => r.id)).toEqual(order);
  });

  it('parentId null 重排根層', async () => {
    await insertPage({
      id: 'echoes/rd-root2',
      parentId: null,
      sortOrder: 1,
      pageType: 'subcategory',
      createdAt: '2020-01-02T00:00:00.000Z',
    });
    const res = await put(
      '/api/content/echoes/reorder',
      { parentId: null, order: ['echoes/rd-root2', PARENT] },
      await adminToken()
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { order: string[] } };
    expect(json.data.order.indexOf('echoes/rd-root2')).toBeLessThan(
      json.data.order.indexOf(PARENT)
    );
  });

  it('未授權 → 401，資料不變', async () => {
    const res = await put('/api/content/echoes/reorder', {
      parentId: PARENT,
      order: [SONGS[2], SONGS[0], SONGS[1]],
    });
    expect(res.status).toBe(401);
    expect((await childRows(PARENT)).map((r) => r.id)).toEqual(SONGS);
  });

  it.each([
    ['其他 parent 的頁', ['echoes/rd-cat', SONGS[0]]],
    ['其他 area 的同名 id', ['visuals/rd-cat/a']],
    ['不存在的 id', ['echoes/rd-cat/nope']],
    ['重複 id', [SONGS[0], SONGS[0]]],
    ['空陣列', []],
  ])('%s → 400，資料不變', async (_label, order) => {
    const res = await put(
      '/api/content/echoes/reorder',
      { parentId: PARENT, order },
      await adminToken()
    );
    expect(res.status).toBe(400);
    expect((await childRows(PARENT)).map((r) => r.id)).toEqual(SONGS);
  });

  it('已軟刪除的 id → 400', async () => {
    await insertPage({
      id: 'echoes/rd-cat/gone',
      parentId: PARENT,
      sortOrder: 3,
      createdAt: '2020-01-05T00:00:00.000Z',
      deletedAt: '2020-02-01T00:00:00.000Z',
    });
    const res = await put(
      '/api/content/echoes/reorder',
      { parentId: PARENT, order: ['echoes/rd-cat/gone', SONGS[0]] },
      await adminToken()
    );
    expect(res.status).toBe(400);
  });

  it('parentId 型別錯誤 → 400', async () => {
    const res = await put(
      '/api/content/echoes/reorder',
      { parentId: 1, order: [SONGS[0]] },
      await adminToken()
    );
    expect(res.status).toBe(400);
  });

  it('回應不可快取（成功與驗證失敗皆 private, no-store）', async () => {
    const token = await adminToken();
    const ok = await put(
      '/api/content/echoes/reorder',
      { parentId: PARENT, order: SONGS },
      token
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, no-store');
    const bad = await put(
      '/api/content/echoes/reorder',
      { parentId: PARENT, order: ['echoes/x'] },
      token
    );
    expect(bad.status).toBe(400);
    expect(bad.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('reorder 不會被當成 slug 建立頁面', async () => {
    await put(
      '/api/content/echoes/reorder',
      { parentId: PARENT, order: SONGS },
      await adminToken()
    );
    const row = await env.CONTENT_DB.prepare(
      "SELECT id FROM pages WHERE id = 'echoes/reorder'"
    ).first();
    expect(row).toBeNull();
  });
});
