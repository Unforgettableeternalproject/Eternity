import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * 便條儲存拆分整合測試（S11 C 段，blob 瘦身）
 *
 * 契約：客戶端協定完全不變（progress GET/PUT 整包含 storageNotes），
 * worker 內部把便條剝到 uep_user_notes 表、回傳時組裝回去。
 * 單一 progress_rev CAS 繼續罩住便條。
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

function createRequest(
  path: string,
  options: RequestInit & { token?: string; rev?: number } = {}
) {
  const { token, rev, ...init } = options;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (rev !== undefined) headers.set('X-Progress-Rev', String(rev));
  headers.set('Origin', 'http://localhost:4321');
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function fetchJson<T = Record<string, unknown>>(
  path: string,
  options: RequestInit & { token?: string; rev?: number } = {}
): Promise<{
  status: number;
  body: {
    ok: boolean;
    data?: T;
    error?: string;
    meta?: { rev?: number; observerEver?: boolean };
  };
}> {
  const res = await worker.fetch(createRequest(path, options), env, ctx);
  return {
    status: res.status,
    body: (await res.json()) as {
      ok: boolean;
      data?: T;
      error?: string;
      meta?: { rev?: number; observerEver?: boolean };
    },
  };
}

async function registerUser(username: string): Promise<{ token: string }> {
  const { status, body } = await fetchJson<{ token: string }>(
    '/api/uep/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: 'test-password-123' }),
    }
  );
  expect(status).toBe(201);
  return { token: body.data!.token };
}

async function getAdminToken(): Promise<string> {
  await worker.fetch(
    createRequest('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify({
        username: 'notes-admin',
        password: 'notes-password',
        display_name: 'Notes Admin',
      }),
    }),
    env,
    ctx
  );
  const { body } = await fetchJson<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'notes-admin',
      password: 'notes-password',
    }),
  });
  return body.data!.token;
}

function note(id: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    text,
    tilt: -1.5,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...extra,
  };
}

function progressWith(notes: unknown[], extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    view: 'explorer',
    observerEver: false,
    flags: [],
    completedPageIds: [],
    islandsUnlocked: ['storage'],
    storageNotes: notes,
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...extra,
  };
}

async function dbUser(username: string) {
  return env.CONTENT_DB.prepare(
    'SELECT id, progress, progress_rev FROM uep_users WHERE username = ?'
  )
    .bind(username)
    .first<{ id: number; progress: string | null; progress_rev: number }>();
}

async function dbNotes(userId: number) {
  const { results } = await env.CONTENT_DB.prepare(
    'SELECT note_id, text, location, captured_at FROM uep_user_notes WHERE user_id = ? ORDER BY note_id'
  )
    .bind(userId)
    .all<{
      note_id: string;
      text: string;
      location: string | null;
      captured_at: string | null;
    }>();
  return results;
}

describe('便條儲存拆分（progress ↔ uep_user_notes）', () => {
  it('PUT 剝離便條入表、blob 欄不存便條、GET 組裝回完整 state', async () => {
    const { token } = await registerUser('notes-roundtrip');
    const notes = [
      note('note-1', '第一張', {
        location: { zone: 'history', pageLabel: '第一章' },
        capturedAt: '2026-08-06T08:00:00.000+08:00',
      }),
      note('note-2', '第二張'),
    ];
    const put = await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify(progressWith(notes)),
    });
    expect(put.status).toBe(200);

    // DB blob 欄位不含便條
    const row = await dbUser('notes-roundtrip');
    expect(row!.progress).not.toContain('storageNotes');
    expect(row!.progress).not.toContain('第一張');

    // 便條在獨立表
    const rows = await dbNotes(row!.id);
    expect(rows.map((r) => r.note_id)).toEqual(['note-1', 'note-2']);
    expect(rows[0].location).toContain('第一章');
    expect(rows[0].captured_at).toBe('2026-08-06T08:00:00.000+08:00');

    // GET 組裝回完整 state（含 location/capturedAt 逐欄位還原）
    const get = await fetchJson<{ storageNotes: unknown[] }>(
      '/api/uep/progress',
      { token }
    );
    expect(get.body.data!.storageNotes).toEqual(notes);
  });

  it('差分同步：編輯＋刪除＋新增各自落地', async () => {
    const { token } = await registerUser('notes-diff');
    await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify(
        progressWith([note('a', '甲'), note('b', '乙'), note('c', '丙')])
      ),
    });
    // a 改文字、b 刪除、d 新增
    const put = await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      rev: 1,
      body: JSON.stringify(
        progressWith([
          note('a', '甲改', { updatedAt: '2026-08-06T01:00:00.000Z' }),
          note('c', '丙'),
          note('d', '丁'),
        ])
      ),
    });
    expect(put.status).toBe(200);

    const row = await dbUser('notes-diff');
    const rows = await dbNotes(row!.id);
    expect(rows.map((r) => [r.note_id, r.text])).toEqual([
      ['a', '甲改'],
      ['c', '丙'],
      ['d', '丁'],
    ]);
  });

  it('body 沒帶 storageNotes 陣列時不動表（防缺欄位資料清空便條）', async () => {
    const { token } = await registerUser('notes-nofield');
    await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify(progressWith([note('keep', '留著')])),
    });
    const { storageNotes: _omit, ...withoutNotes } = progressWith([]);
    const put = await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      rev: 1,
      body: JSON.stringify(withoutNotes),
    });
    expect(put.status).toBe(200);

    const row = await dbUser('notes-nofield');
    expect((await dbNotes(row!.id)).map((r) => r.note_id)).toEqual(['keep']);
    // 但之後的 GET 仍組裝得回來
    const get = await fetchJson<{ storageNotes: { id: string }[] }>(
      '/api/uep/progress',
      { token }
    );
    expect(get.body.data!.storageNotes.map((n) => n.id)).toEqual(['keep']);
  });

  it('lazy migration：既存 blob 內的便條在 GET 時搬進表並清欄位，rev 不變', async () => {
    const { token } = await registerUser('notes-legacy');
    // 直接把「遷移前形狀」的 blob 塞進 DB（模擬 0026 之前的存量）
    const legacy = progressWith([note('old-1', '存量便條')]);
    await env.CONTENT_DB.prepare(
      "UPDATE uep_users SET progress = ?, progress_rev = 5 WHERE username = 'notes-legacy'"
    )
      .bind(JSON.stringify(legacy))
      .run();

    const get = await fetchJson<{ storageNotes: { id: string }[] }>(
      '/api/uep/progress',
      { token }
    );
    expect(get.status).toBe(200);
    expect(get.body.data!.storageNotes.map((n) => n.id)).toEqual(['old-1']);
    expect(get.body.meta!.rev).toBe(5);

    const row = await dbUser('notes-legacy');
    expect(row!.progress_rev).toBe(5); // 遷移不遞增 rev
    expect(row!.progress).not.toContain('storageNotes');
    expect((await dbNotes(row!.id)).map((r) => r.note_id)).toEqual(['old-1']);
  });

  it('409 衝突回應的 data 含組裝後的便條（客戶端收斂基準不可缺便條）', async () => {
    const { token } = await registerUser('notes-conflict');
    await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify(progressWith([note('n1', '衝突前')])),
    });
    // 帶過期 rev 的 PUT（模擬另一台裝置的舊快照）
    const stale = await fetchJson<{ storageNotes: { id: string }[] }>(
      '/api/uep/progress',
      {
        method: 'PUT',
        token,
        rev: 0,
        body: JSON.stringify(progressWith([])),
      }
    );
    expect(stale.status).toBe(409);
    expect(stale.body.data!.storageNotes.map((n) => n.id)).toEqual(['n1']);

    // 輸家的空便條清單沒有寫進表（rev 守門讓整批 no-op）
    const row = await dbUser('notes-conflict');
    expect((await dbNotes(row!.id)).map((r) => r.note_id)).toEqual(['n1']);
  });

  it('sanitize：超長文字截 400、壞形狀丟棄、id 去重', async () => {
    const { token } = await registerUser('notes-sanitize');
    const put = await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify(
        progressWith([
          note('long', '記'.repeat(500)),
          { id: 'broken' }, // 欄位不全 → 丟棄
          note('long', '重複 id → 丟棄'),
          note('loc-bad', '地點型別不符只丟小標', {
            location: 'not-an-object',
          }),
        ])
      ),
    });
    expect(put.status).toBe(200);

    const row = await dbUser('notes-sanitize');
    const rows = await dbNotes(row!.id);
    expect(rows.map((r) => r.note_id)).toEqual(['loc-bad', 'long']);
    expect(rows.find((r) => r.note_id === 'long')!.text).toHaveLength(400);
    expect(rows.find((r) => r.note_id === 'loc-bad')!.location).toBeNull();
  });

  it('admin 重置進度（progress: null）連帶清空便條', async () => {
    const { token } = await registerUser('notes-admin-reset');
    await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify(progressWith([note('doomed', '要被重置')])),
    });
    const row = await dbUser('notes-admin-reset');
    expect(await dbNotes(row!.id)).toHaveLength(1);

    const adminToken = await getAdminToken();
    const reset = await fetchJson(`/api/uep/admin/users/${row!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ progress: null }),
    });
    expect(reset.status).toBe(200);
    expect(await dbNotes(row!.id)).toHaveLength(0);
  });

  it('admin 進度檢視組裝便條、整包寫回走 replace-all', async () => {
    const { token } = await registerUser('notes-admin-edit');
    await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify(progressWith([note('a', '甲'), note('b', '乙')])),
    });
    const row = await dbUser('notes-admin-edit');
    const adminToken = await getAdminToken();

    // 檢視端點回組裝後的 state
    const view = await fetchJson<{ storageNotes: { id: string }[] }>(
      `/api/uep/admin/users/${row!.id}/progress`,
      { token: adminToken }
    );
    expect(view.body.data!.storageNotes.map((n) => n.id)).toEqual(['a', 'b']);

    // admin 整包寫回：刪 b、改 a
    const edited = {
      ...view.body.data!,
      storageNotes: [note('a', '甲（admin 改）')],
    };
    const put = await fetchJson(`/api/uep/admin/users/${row!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ progress: edited }),
    });
    expect(put.status).toBe(200);

    const rows = await dbNotes(row!.id);
    expect(rows.map((r) => [r.note_id, r.text])).toEqual([
      ['a', '甲（admin 改）'],
    ]);
    // 寫回後 blob 欄仍不存便條
    const after = await dbUser('notes-admin-edit');
    expect(after!.progress).not.toContain('storageNotes');
  });
});
