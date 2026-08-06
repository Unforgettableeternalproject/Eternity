import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';
import { isValidAlias, rollAlias, GUEST_ALIAS } from '../uep-alias';

/**
 * UEP 讀者帳號 + 進度同步整合測試（Epic 2 S5）
 *
 * 涵蓋：註冊/登入/me、代稱 roll 與驗證、進度 GET/PUT、
 * observerEver 單向遞增、reader/admin token 雙向權限隔離。
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
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers.set('Origin', 'http://localhost:4321');
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function fetchJson<T = Record<string, unknown>>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<{
  status: number;
  body: { ok: boolean; data?: T; error?: string };
}> {
  const res = await worker.fetch(createRequest(path, options), env, ctx);
  return {
    status: res.status,
    body: (await res.json()) as { ok: boolean; data?: T; error?: string },
  };
}

async function registerUser(
  username: string,
  password = 'test-password-123'
): Promise<{ token: string; alias: string }> {
  const { status, body } = await fetchJson<{ token: string; alias: string }>(
    '/api/uep/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }
  );
  expect(status).toBe(201);
  return { token: body.data!.token, alias: body.data!.alias };
}

describe('代稱系統', () => {
  it('rollAlias 產生詞庫合法組合', () => {
    for (let i = 0; i < 20; i++) {
      expect(isValidAlias(rollAlias())).toBe(true);
    }
  });

  it('isValidAlias 拒絕任意字串', () => {
    expect(isValidAlias('管理員')).toBe(false);
    expect(isValidAlias('')).toBe(false);
    expect(isValidAlias(GUEST_ALIAS)).toBe(false);
    expect(isValidAlias('拾光的')).toBe(false); // 只有前綴
    expect(isValidAlias('旅人')).toBe(false); // 只有名詞
  });

  it('GET /api/uep/alias/roll 回傳合法代稱', async () => {
    const { status, body } = await fetchJson<{ alias: string }>(
      '/api/uep/alias/roll'
    );
    expect(status).toBe(200);
    expect(isValidAlias(body.data!.alias)).toBe(true);
  });
});

describe('註冊', () => {
  it('成功註冊回傳 token 與代稱', async () => {
    const { status, body } = await fetchJson<{
      token: string;
      alias: string;
      username: string;
      observerEver: boolean;
      hasProgress: boolean;
    }>('/api/uep/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'reader-one',
        password: 'password-123',
        email: 'reader@example.com',
      }),
    });
    expect(status).toBe(201);
    expect(body.data!.token).toBeTruthy();
    expect(body.data!.username).toBe('reader-one');
    expect(isValidAlias(body.data!.alias)).toBe(true);
    expect(body.data!.observerEver).toBe(false);
    expect(body.data!.hasProgress).toBe(false);
  });

  it('接受客戶端 roll 過的合法代稱', async () => {
    const alias = rollAlias();
    const { status, body } = await fetchJson<{ alias: string }>(
      '/api/uep/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({
          username: 'reader-alias',
          password: 'password-123',
          alias,
        }),
      }
    );
    expect(status).toBe(201);
    expect(body.data!.alias).toBe(alias);
  });

  it('非法代稱被忽略並由伺服器重 roll', async () => {
    const { status, body } = await fetchJson<{ alias: string }>(
      '/api/uep/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({
          username: 'reader-badalias',
          password: 'password-123',
          alias: '至高無上的管理員',
        }),
      }
    );
    expect(status).toBe(201);
    expect(body.data!.alias).not.toBe('至高無上的管理員');
    expect(isValidAlias(body.data!.alias)).toBe(true);
  });

  it('帳號格式錯誤回傳 400', async () => {
    const { status } = await fetchJson('/api/uep/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'a', password: 'password-123' }),
    });
    expect(status).toBe(400);
  });

  it('密碼太短回傳 400', async () => {
    const { status } = await fetchJson('/api/uep/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'reader-shortpw', password: 'short' }),
    });
    expect(status).toBe(400);
  });

  it('email 格式錯誤回傳 400', async () => {
    const { status } = await fetchJson('/api/uep/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'reader-bademail',
        password: 'password-123',
        email: 'not-an-email',
      }),
    });
    expect(status).toBe(400);
  });

  it('重複帳號回傳 409（含大小寫不敏感）', async () => {
    await registerUser('reader-dup');
    const { status } = await fetchJson('/api/uep/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: 'READER-DUP',
        password: 'password-123',
      }),
    });
    expect(status).toBe(409);
  });
});

describe('登入與 me', () => {
  it('正確帳密登入成功', async () => {
    await registerUser('reader-login', 'login-password-1');
    const { status, body } = await fetchJson<{
      token: string;
      alias: string;
    }>('/api/uep/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'reader-login',
        password: 'login-password-1',
      }),
    });
    expect(status).toBe(200);
    expect(body.data!.token).toBeTruthy();
  });

  it('錯誤密碼回傳 401', async () => {
    await registerUser('reader-wrongpw');
    const { status } = await fetchJson('/api/uep/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'reader-wrongpw',
        password: 'wrong-password',
      }),
    });
    expect(status).toBe(401);
  });

  it('不存在的帳號回傳 401', async () => {
    const { status } = await fetchJson('/api/uep/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'ghost', password: 'password-123' }),
    });
    expect(status).toBe(401);
  });

  /* 信箱是登入識別名的替代路徑。識別名不允許 `@`（USERNAME_RE），
     所以兩者不會互撞，同一格輸入不必先問使用者是哪一種。 */
  describe('用信箱登入', () => {
    async function registerWithEmail(username: string, email: string) {
      const { status } = await fetchJson('/api/uep/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password: 'test-password-123',
          email,
        }),
      });
      expect(status).toBe(201);
    }

    it('填過信箱的帳號可以用信箱登入', async () => {
      /* 刻意不用 reader@example.com——上面的註冊測試已經佔用了它，
         共用會變成「同一信箱兩個帳號」而撞到歧義分支 */
      await registerWithEmail('mail-login', 'mail-login@example.com');
      const { status, body } = await fetchJson<{ username: string }>(
        '/api/uep/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username: 'mail-login@example.com',
            password: 'test-password-123',
          }),
        }
      );
      expect(status).toBe(200);
      expect(body.data!.username).toBe('mail-login');
    });

    it('信箱比對不分大小寫——沒人會記得當初怎麼打的', async () => {
      await registerWithEmail('mail-case', 'Mixed.Case@Example.com');
      const { status } = await fetchJson('/api/uep/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'mixed.case@example.com',
          password: 'test-password-123',
        }),
      });
      expect(status).toBe(200);
    });

    /* 信箱沒有 unique 約束，兩個帳號填同一個是合法的。無從得知要登入
       哪一個，但也不能回「憑證錯誤」讓人反覆試密碼。 */
    it('同一信箱掛多個帳號時回 409 並要求改用識別名', async () => {
      await registerWithEmail('dup-mail-a', 'shared@example.com');
      await registerWithEmail('dup-mail-b', 'shared@example.com');
      const { status, body } = await fetchJson('/api/uep/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'shared@example.com',
          password: 'test-password-123',
        }),
      });
      expect(status).toBe(409);
      expect(body.error).toContain('識別名');
    });

    it('識別名仍然優先——就算它剛好也是別人的信箱值', async () => {
      await registerWithEmail('collide-name', 'collide-name@example.com');
      const { status, body } = await fetchJson<{ username: string }>(
        '/api/uep/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username: 'collide-name',
            password: 'test-password-123',
          }),
        }
      );
      expect(status).toBe(200);
      expect(body.data!.username).toBe('collide-name');
    });
  });

  /* 被停用的帳號要讓讀者知道「有東西擋著」而不是以為自己記錯密碼，
     但這件事只能在密碼驗過之後說——先擋的話等於不用知道密碼就能
     問出「這個帳號存在且被停用」。 */
  describe('被停用的帳號', () => {
    async function deactivate(username: string) {
      await env.CONTENT_DB.prepare(
        'UPDATE uep_users SET is_active = 0 WHERE username = ?'
      )
        .bind(username)
        .run();
    }

    it('密碼正確時回 403，訊息是世界裡的阻力而非系統狀態', async () => {
      await registerUser('inactive-ok');
      await deactivate('inactive-ok');
      const { status, body } = await fetchJson('/api/uep/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'inactive-ok',
          password: 'test-password-123',
        }),
      });
      expect(status).toBe(403);
      expect(body.error).toContain('未知的力量');
      expect(body.error).not.toContain('停用');
    });

    it('密碼錯誤時仍是 401——不知道密碼就問不出帳號被停用', async () => {
      await registerUser('inactive-bad');
      await deactivate('inactive-bad');
      const { status, body } = await fetchJson('/api/uep/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'inactive-bad',
          password: 'wrong-password',
        }),
      });
      expect(status).toBe(401);
      expect(body.error).not.toContain('未知的力量');
    });
  });

  it('me 回傳使用者資訊', async () => {
    const { token, alias } = await registerUser('reader-me');
    const { status, body } = await fetchJson<{
      username: string;
      alias: string;
      observerEver: boolean;
    }>('/api/uep/auth/me', { token });
    expect(status).toBe(200);
    expect(body.data!.username).toBe('reader-me');
    expect(body.data!.alias).toBe(alias);
  });

  it('無 token 的 me 回傳 401', async () => {
    const { status } = await fetchJson('/api/uep/auth/me');
    expect(status).toBe(401);
  });
});

describe('進度同步', () => {
  const sampleProgress = {
    version: 1,
    view: 'explorer',
    observerEver: false,
    flags: ['completed:history/1-1'],
    completedPageIds: ['history/1-1'],
    islandsUnlocked: [],
    pageMarkers: {
      'history/1-1': {
        maxMarkerIdx: 3,
        lastMarkerIdx: 3,
        totalMarkers: 3,
        updatedAt: '2026-07-03T00:00:00.000Z',
      },
    },
    // S11 C 段拆分後 GET 一律回組裝過的 storageNotes 欄位（空帳號為 []），
    // sample 對齊真實 ProgressState 的形狀（該欄位必定存在）
    storageNotes: [],
    updatedAt: '2026-07-03T00:00:00.000Z',
  };

  it('初始進度為 null', async () => {
    const { token } = await registerUser('reader-prog-empty');
    const { status, body } = await fetchJson('/api/uep/progress', { token });
    expect(status).toBe(200);
    expect(body.data).toBeNull();
  });

  it('PUT 後 GET 取回相同進度', async () => {
    const { token } = await registerUser('reader-prog-rt');
    const put = await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify(sampleProgress),
    });
    expect(put.status).toBe(200);

    const { body } = await fetchJson<typeof sampleProgress>(
      '/api/uep/progress',
      { token }
    );
    expect(body.data).toEqual(sampleProgress);
  });

  it('observerEver 單向遞增：標記後上傳 false 不會復原', async () => {
    const { token } = await registerUser('reader-prog-observer');
    // 先上傳有印記的進度
    await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify({ ...sampleProgress, observerEver: true }),
    });
    // 再上傳無印記的進度（模擬竄改/舊資料）
    const put = await fetchJson<{ observerEver: boolean }>(
      '/api/uep/progress',
      {
        method: 'PUT',
        token,
        body: JSON.stringify({ ...sampleProgress, observerEver: false }),
      }
    );
    expect(put.body.data!.observerEver).toBe(true);

    const { body } = await fetchJson<{ observerEver: boolean }>(
      '/api/uep/progress',
      { token }
    );
    expect(body.data!.observerEver).toBe(true);

    // me 也反映印記
    const me = await fetchJson<{ observerEver: boolean }>('/api/uep/auth/me', {
      token,
    });
    expect(me.body.data!.observerEver).toBe(true);
  });

  it('非物件 body 回傳 400', async () => {
    const { token } = await registerUser('reader-prog-invalid');
    const { status } = await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify([1, 2, 3]),
    });
    expect(status).toBe(400);
  });

  it('過大的進度回傳 413', async () => {
    const { token } = await registerUser('reader-prog-huge');
    const { status } = await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify({
        ...sampleProgress,
        flags: Array.from(
          { length: 10000 },
          (_, i) => `spam:flag-${i}-padding-padding`
        ),
      }),
    });
    expect(status).toBe(413);
  });

  it('無 token 的進度存取回傳 401', async () => {
    const get = await fetchJson('/api/uep/progress');
    expect(get.status).toBe(401);
    const put = await fetchJson('/api/uep/progress', {
      method: 'PUT',
      body: JSON.stringify(sampleProgress),
    });
    expect(put.status).toBe(401);
  });
});

describe('Admin 使用者管理（/api/uep/admin/users）', () => {
  // 與「權限隔離」describe 共用同一組 admin——bootstrap 只允許建立第一位 admin，
  // 兩個 describe 用同帳號才能各自獨立取得 token
  async function getAdminToken(): Promise<string> {
    await worker.fetch(
      createRequest('/api/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          username: 'sec-admin',
          password: 'sec-password',
          display_name: 'Sec Admin',
        }),
      }),
      env,
      ctx
    );
    const { body } = await fetchJson<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'sec-admin', password: 'sec-password' }),
    });
    return body.data!.token;
  }

  interface AdminUser {
    id: number;
    username: string;
    alias: string;
    email: string | null;
    observerEver: boolean;
    hasProgress: boolean;
    isActive: boolean;
    adminNote: string | null;
    deletedAt: string | null;
  }

  /** 以 admin token 取得指定 username 的使用者（含已刪除） */
  async function findUser(
    adminToken: string,
    username: string
  ): Promise<AdminUser | undefined> {
    const { body } = await fetchJson<AdminUser[]>(
      '/api/uep/admin/users?include_deleted=true',
      { token: adminToken }
    );
    return body.data!.find((u) => u.username === username);
  }

  it('無 token 一律 401', async () => {
    const list = await fetchJson('/api/uep/admin/users');
    expect(list.status).toBe(401);
    const put = await fetchJson('/api/uep/admin/users/1', {
      method: 'PUT',
      body: JSON.stringify({ adminNote: 'x' }),
    });
    expect(put.status).toBe(401);
    const del = await fetchJson('/api/uep/admin/users/1', {
      method: 'DELETE',
    });
    expect(del.status).toBe(401);
  });

  it('reader token 一律 401（安全邊界）', async () => {
    const { token } = await registerUser('um-reader-sec');
    const list = await fetchJson('/api/uep/admin/users', { token });
    expect(list.status).toBe(401);
    const del = await fetchJson('/api/uep/admin/users/1', {
      method: 'DELETE',
      token,
    });
    expect(del.status).toBe(401);
  });

  it('admin token 可列出使用者，欄位不含敏感資料', async () => {
    const adminToken = await getAdminToken();
    await registerUser('um-list-user');
    const user = await findUser(adminToken, 'um-list-user');
    expect(user).toBeDefined();
    expect(user!.isActive).toBe(true);
    expect(user!.hasProgress).toBe(false);
    expect(user!.deletedAt).toBeNull();
    expect(user).not.toHaveProperty('password_hash');
    expect(user).not.toHaveProperty('progress');
  });

  it('search 過濾 username（含 LIKE 萬用字元 escape）', async () => {
    const adminToken = await getAdminToken();
    await registerUser('um-search-target');
    await registerUser('um-search-other');

    const { body } = await fetchJson<AdminUser[]>(
      '/api/uep/admin/users?search=um-search-target',
      { token: adminToken }
    );
    expect(body.data!.some((u) => u.username === 'um-search-target')).toBe(
      true
    );
    expect(body.data!.some((u) => u.username === 'um-search-other')).toBe(
      false
    );

    // % 不能被當成萬用字元吞掉全部
    const wild = await fetchJson<AdminUser[]>('/api/uep/admin/users?search=%', {
      token: adminToken,
    });
    expect(wild.body.data!.length).toBe(0);
  });

  it('PUT 更新 adminNote / alias / email', async () => {
    const adminToken = await getAdminToken();
    await registerUser('um-update-user');
    const user = await findUser(adminToken, 'um-update-user');
    const newAlias = rollAlias();

    const { status, body } = await fetchJson<AdminUser>(
      `/api/uep/admin/users/${user!.id}`,
      {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({
          adminNote: '測試備註',
          alias: newAlias,
          email: 'updated@example.com',
        }),
      }
    );
    expect(status).toBe(200);
    expect(body.data!.adminNote).toBe('測試備註');
    expect(body.data!.alias).toBe(newAlias);
    expect(body.data!.email).toBe('updated@example.com');
  });

  it('PUT observerEver 雙向覆寫並同步 progress blob（S7 驗收加碼）', async () => {
    const adminToken = await getAdminToken();
    const { token } = await registerUser('um-mark-user');
    // 使用者先上傳一份帶印記的進度（走讀者端單向升級路徑）
    await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token,
      body: JSON.stringify({
        view: 'observer',
        observerEver: true,
        flags: ['met:a'],
      }),
    });
    const user = await findUser(adminToken, 'um-mark-user');
    expect(user!.observerEver).toBe(true);

    // admin 清除印記（讀者端單向規則不適用 admin 覆寫）
    const cleared = await fetchJson<AdminUser>(
      `/api/uep/admin/users/${user!.id}`,
      {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ observerEver: false }),
      }
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.data!.observerEver).toBe(false);

    // blob 內 observerEver 必須一併同步——否則讀者下次 PUT 會升回去
    const prog = await fetchJson<Record<string, unknown>>(
      `/api/uep/admin/users/${user!.id}/progress`,
      { token: adminToken }
    );
    expect(prog.status).toBe(200);
    expect(prog.body.data!.observerEver).toBe(false);
    expect(prog.body.data!.flags).toEqual(['met:a']); // 其他欄位不動

    // 再烙回去
    const granted = await fetchJson<AdminUser>(
      `/api/uep/admin/users/${user!.id}`,
      {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ observerEver: true }),
      }
    );
    expect(granted.body.data!.observerEver).toBe(true);
  });

  it('PUT progress 物件/字串皆可；欄位跟隨 blob、明確 toggle 優先', async () => {
    const adminToken = await getAdminToken();
    await registerUser('um-prog-user');
    const user = await findUser(adminToken, 'um-prog-user');

    // 物件形式 + blob 標 observerEver=true → 欄位跟隨 blob
    const res = await fetchJson<AdminUser>(`/api/uep/admin/users/${user!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({
        progress: { view: 'observer', observerEver: true, flags: ['met:a'] },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body.data!.hasProgress).toBe(true);
    expect(res.body.data!.observerEver).toBe(true);

    // 字串形式（合法 JSON）
    const res2 = await fetchJson<AdminUser>(
      `/api/uep/admin/users/${user!.id}`,
      {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({
          progress: JSON.stringify({
            view: 'explorer',
            observerEver: false,
            flags: [],
          }),
        }),
      }
    );
    expect(res2.status).toBe(200);
    expect(res2.body.data!.observerEver).toBe(false);

    // 明確 toggle 與 blob 同時給：toggle 優先、blob 被改寫一致
    const res3 = await fetchJson<AdminUser>(
      `/api/uep/admin/users/${user!.id}`,
      {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({
          progress: { view: 'explorer', observerEver: true, flags: [] },
          observerEver: false,
        }),
      }
    );
    expect(res3.body.data!.observerEver).toBe(false);
    const prog = await fetchJson<Record<string, unknown>>(
      `/api/uep/admin/users/${user!.id}/progress`,
      { token: adminToken }
    );
    expect(prog.body.data!.observerEver).toBe(false);
  });

  it('PUT progress: null 重置；非法 JSON / 非物件 400', async () => {
    const adminToken = await getAdminToken();
    await registerUser('um-prog-reset');
    const user = await findUser(adminToken, 'um-prog-reset');

    await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ progress: { view: 'explorer', flags: [] } }),
    });

    // 重置
    const reset = await fetchJson<AdminUser>(
      `/api/uep/admin/users/${user!.id}`,
      {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ progress: null }),
      }
    );
    expect(reset.status).toBe(200);
    expect(reset.body.data!.hasProgress).toBe(false);
    const prog = await fetchJson(`/api/uep/admin/users/${user!.id}/progress`, {
      token: adminToken,
    });
    expect(prog.body.data).toBeNull();

    // 非法 JSON 字串 / 陣列 → 400
    const bad = await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ progress: '{broken' }),
    });
    expect(bad.status).toBe(400);
    const arr = await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ progress: [1, 2] }),
    });
    expect(arr.status).toBe(400);
  });

  /* ── Admin 重置的樂觀鎖 ──────────────────────────────
   * admin 把 progress 設為 NULL 之後，若該使用者當下還開著分頁，
   * ServerAdapter 的 debounce PUT／pagehide flush 會把重置前的本地鏡像
   * 整包寫回來，admin 的重置被悄悄復原且雙方都不知情。
   * 靠 progress_reset_at 戳記擋掉所有更早的快照。
   */
  describe('admin 重置後的過期快照防護', () => {
    /**
     * 明確早於重置時刻的時間戳。
     * ⚠️ 不可用「今天」——測試執行當下的 UTC 時鐘可能還沒跨到那一天，
     * 快照反而會比 progress_reset_at 新而被放行（第一版就踩了這個坑）。
     */
    const STALE_STAMP = '2020-01-01T00:00:00.000Z';

    it('重置前的快照被 409 拒收，重置後的新快照放行', async () => {
      const adminToken = await getAdminToken();
      const { token } = await registerUser('um-stale-put');
      const user = await findUser(adminToken, 'um-stale-put');

      // 使用者先正常同步一次
      const early = await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        body: JSON.stringify({
          view: 'explorer',
          flags: ['before-reset'],
          updatedAt: STALE_STAMP,
        }),
      });
      expect(early.status).toBe(200);

      // admin 重置
      const resetRes = await fetchJson(`/api/uep/admin/users/${user!.id}`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ progress: null }),
      });
      expect(resetRes.status).toBe(200);

      // 還開著的分頁把重置前的鏡像 flush 上來 → 必須被擋
      const stale = await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        body: JSON.stringify({
          view: 'explorer',
          flags: ['before-reset'],
          updatedAt: STALE_STAMP,
        }),
      });
      expect(stale.status).toBe(409);

      // 重置仍然有效——沒有被那份過期快照復原
      const after = await fetchJson(
        `/api/uep/admin/users/${user!.id}/progress`,
        { token: adminToken }
      );
      expect(after.body.data).toBeNull();

      // 客戶端 reset() 後帶著新的 updatedAt 重送 → 放行
      const fresh = await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        body: JSON.stringify({
          view: 'explorer',
          flags: [],
          updatedAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      });
      expect(fresh.status).toBe(200);
    });

    it('沒有 updatedAt 的 payload 在重置後一律拒收', async () => {
      const adminToken = await getAdminToken();
      const { token } = await registerUser('um-stale-noupdated');
      const user = await findUser(adminToken, 'um-stale-noupdated');

      await fetchJson(`/api/uep/admin/users/${user!.id}`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ progress: null }),
      });

      const res = await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        body: JSON.stringify({ view: 'explorer', flags: ['no-stamp'] }),
      });
      expect(res.status).toBe(409);
    });

    it('從未被 admin 動過的帳號不受影響（向後相容）', async () => {
      const { token } = await registerUser('um-never-reset');
      const res = await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        body: JSON.stringify({ view: 'explorer', flags: ['fine'] }),
      });
      expect(res.status).toBe(200);
    });

    /**
     * 【回歸】時間戳不是版本鎖。
     *
     * 舊分頁只要再發生任何 mutation（滑一下觸發 marker-update 就夠），
     * blob 的 updatedAt 就刷新成當下、比 progress_reset_at 新而直接通過，
     * 整份舊 state 照樣覆蓋 admin 的編輯。這是 compare-and-swap 存在的
     * 全部理由——沒有它，0020 的樂觀鎖只擋得住完全沒動作的過期分頁。
     */
    it('帶舊 rev 的分頁即使更新了 updatedAt 也必須被擋下', async () => {
      const adminToken = await getAdminToken();
      const { token } = await registerUser('um-cas-stale-rev');
      const user = await findUser(adminToken, 'um-cas-stale-rev');

      // 使用者同步一次，記下當時的 rev
      const first = await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        body: JSON.stringify({ view: 'explorer', flags: ['mine'] }),
      });
      expect(first.status).toBe(200);
      const staleRev = (first.body as { meta?: { rev: number } }).meta!.rev;

      // admin 在後台存入自己的版本
      await fetchJson(`/api/uep/admin/users/${user!.id}`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({
          progress: { view: 'explorer', flags: ['admin-authored'] },
        }),
      });

      // 舊分頁帶著**全新的** updatedAt（模擬使用者又動了一下）+ 舊 rev
      const stale = await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        headers: { 'X-Progress-Rev': String(staleRev) },
        body: JSON.stringify({
          view: 'explorer',
          flags: ['mine'],
          updatedAt: new Date(Date.now() + 600_000).toISOString(),
        }),
      });
      expect(stale.status).toBe(409);

      // admin 的版本必須毫髮無傷
      const after = await fetchJson<{ flags: string[] }>(
        `/api/uep/admin/users/${user!.id}/progress`,
        { token: adminToken }
      );
      expect(after.body.data!.flags).toEqual(['admin-authored']);
    });

    it('rev 正確時放行並回傳遞增後的 rev', async () => {
      const { token } = await registerUser('um-cas-happy');
      const get = await fetchJson('/api/uep/progress', { token });
      const rev0 = (get.body as { meta?: { rev: number } }).meta!.rev;

      const put = await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        headers: { 'X-Progress-Rev': String(rev0) },
        body: JSON.stringify({ view: 'explorer', flags: ['ok'] }),
      });
      expect(put.status).toBe(200);
      expect((put.body as { meta?: { rev: number } }).meta!.rev).toBe(rev0 + 1);

      // 同一個 rev 不能用第二次
      const replay = await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        headers: { 'X-Progress-Rev': String(rev0) },
        body: JSON.stringify({ view: 'explorer', flags: ['replay'] }),
      });
      expect(replay.status).toBe(409);
    });

    it('rev 格式非法回 400', async () => {
      const { token } = await registerUser('um-cas-badrev');
      const res = await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        headers: { 'X-Progress-Rev': 'abc' },
        body: JSON.stringify({ view: 'explorer', flags: [] }),
      });
      expect(res.status).toBe(400);
    });

    /**
     * 【回歸】內容洩漏防線。
     * admin 清空 progress 時 blob 變 NULL 但 observer_ever 保留；
     * GET 必須把 canonical 的 observerEver 帶回去，否則客戶端會把印記
     * 歸零，讓 pristineOnly（純潔者限定）內容對印記者顯示出來。
     */
    it('GET 在 progress 為 null 時仍回傳 canonical observerEver', async () => {
      const adminToken = await getAdminToken();
      const { token } = await registerUser('um-meta-observer');
      const user = await findUser(adminToken, 'um-meta-observer');

      // 使用者成為觀測者
      await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        body: JSON.stringify({ view: 'observer', observerEver: true }),
      });

      // admin 只清 progress，不動印記
      await fetchJson(`/api/uep/admin/users/${user!.id}`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ progress: null }),
      });

      const get = await fetchJson('/api/uep/progress', { token });
      expect(get.body.data).toBeNull();
      expect(
        (get.body as { meta?: { observerEver: boolean } }).meta!.observerEver
      ).toBe(true);
    });

    /**
     * 【回歸】
     * 凡是改變讀者 canonical 狀態的 admin 操作都必須遞增 rev，**即使
     * blob 為 null**。
     *
     * 舊條件是 `hasProgressEdit || (hasObserverEdit && progressObj)`：
     * progress 已是 null 時單獨清除印記，DB 欄位改了但 rev 沒動。客戶端
     * 手上的同 rev 快照仍會通過 CAS，而讀者端 PUT 的印記是單向 OR，
     * 於是印記被升回 true——admin 的清除被復原。
     */
    it('progress 為 null 時單獨切 observerEver 也必須遞增 rev', async () => {
      const adminToken = await getAdminToken();
      const { token } = await registerUser('um-observer-only-rev');
      const user = await findUser(adminToken, 'um-observer-only-rev');

      // 使用者成為觀測者，然後 admin 清空進度（blob → null，印記保留）
      await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        body: JSON.stringify({ view: 'observer', observerEver: true }),
      });
      await fetchJson(`/api/uep/admin/users/${user!.id}`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ progress: null }),
      });

      // 客戶端此刻手上的 rev
      const before = await fetchJson('/api/uep/progress', { token });
      const heldRev = (before.body as { meta?: { rev: number } }).meta!.rev;

      // admin 在 progress 已是 null 的狀態下單獨清除印記
      const cleared = await fetchJson(`/api/uep/admin/users/${user!.id}`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ observerEver: false }),
      });
      expect(cleared.status).toBe(200);

      // rev 必須已遞增 → 舊快照失效
      const after = await fetchJson('/api/uep/progress', { token });
      const newRev = (after.body as { meta?: { rev: number } }).meta!.rev;
      expect(newRev).toBeGreaterThan(heldRev);
      expect(
        (after.body as { meta?: { observerEver: boolean } }).meta!.observerEver
      ).toBe(false);

      // 客戶端拿舊 rev 帶著 observerEver=true 重送 → 必須被擋
      const stale = await fetchJson('/api/uep/progress', {
        method: 'PUT',
        token,
        headers: { 'X-Progress-Rev': String(heldRev) },
        body: JSON.stringify({ view: 'observer', observerEver: true }),
      });
      expect(stale.status).toBe(409);

      // 印記維持被清除的狀態——沒有被讀者端的單向 OR 升回去
      const final = await fetchJson('/api/uep/progress', { token });
      expect(
        (final.body as { meta?: { observerEver: boolean } }).meta!.observerEver
      ).toBe(false);
    });
  });

  it('GET /users/:id/progress 需 admin token；不存在 404', async () => {
    const noToken = await fetchJson('/api/uep/admin/users/1/progress');
    expect(noToken.status).toBe(401);

    const adminToken = await getAdminToken();
    const missing = await fetchJson('/api/uep/admin/users/999999/progress', {
      token: adminToken,
    });
    expect(missing.status).toBe(404);
  });

  it('PUT 驗證與註冊同規則：非法代稱/信箱/過長備註回傳 400', async () => {
    const adminToken = await getAdminToken();
    await registerUser('um-validate-user');
    const user = await findUser(adminToken, 'um-validate-user');

    const badAlias = await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ alias: '至高無上的管理員' }),
    });
    expect(badAlias.status).toBe(400);

    const badEmail = await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(badEmail.status).toBe(400);

    const longNote = await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ adminNote: 'x'.repeat(5000) }),
    });
    expect(longNote.status).toBe(400);
  });

  it('停用（isActive=false）後不能登入，重新啟用後恢復', async () => {
    const adminToken = await getAdminToken();
    await registerUser('um-deact-user', 'deact-password-1');
    const user = await findUser(adminToken, 'um-deact-user');

    await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ isActive: false }),
    });
    const blocked = await fetchJson('/api/uep/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'um-deact-user',
        password: 'deact-password-1',
      }),
    });
    /* 403 而不是 401：密碼是對的，擋下來的是帳號狀態。
       訊息與判定順序見「被停用的帳號」那組測試。 */
    expect(blocked.status).toBe(403);

    await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ isActive: true }),
    });
    const restored = await fetchJson('/api/uep/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'um-deact-user',
        password: 'deact-password-1',
      }),
    });
    expect(restored.status).toBe(200);
  });

  it('軟刪除後：登入/me/progress 全部拒絕，預設列表隱藏，restore 後恢復', async () => {
    const adminToken = await getAdminToken();
    const { token: readerToken } = await registerUser(
      'um-del-user',
      'del-password-1'
    );
    const user = await findUser(adminToken, 'um-del-user');

    /* 啟用中的帳號刪不掉——刪除是清單上最容易點錯的一格，
       「先停用、確認沒事再刪」讓誤刪需要兩個刻意的動作 */
    const tooSoon = await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    expect(tooSoon.status).toBe(409);

    await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ isActive: false }),
    });

    const del = await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    expect(del.status).toBe(200);

    // 登入被拒
    const login = await fetchJson('/api/uep/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'um-del-user',
        password: 'del-password-1',
      }),
    });
    expect(login.status).toBe(401);

    // 既有 token 的 me / progress 也被拒（軟刪與停用一致）
    const me = await fetchJson('/api/uep/auth/me', { token: readerToken });
    expect(me.status).toBe(401);
    const prog = await fetchJson('/api/uep/progress', { token: readerToken });
    expect(prog.status).toBe(401);
    const progPut = await fetchJson('/api/uep/progress', {
      method: 'PUT',
      token: readerToken,
      body: JSON.stringify({ version: 1 }),
    });
    expect(progPut.status).toBe(401);

    // 預設列表隱藏、include_deleted 可見
    const defaultList = await fetchJson<AdminUser[]>('/api/uep/admin/users', {
      token: adminToken,
    });
    expect(
      defaultList.body.data!.some((u) => u.username === 'um-del-user')
    ).toBe(false);
    const withDeleted = await findUser(adminToken, 'um-del-user');
    expect(withDeleted!.deletedAt).not.toBeNull();

    // 重複刪除 → 404
    const delAgain = await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    expect(delAgain.status).toBe(404);

    // restore 後恢復登入
    const restore = await fetchJson(
      `/api/uep/admin/users/${user!.id}/restore`,
      { method: 'POST', token: adminToken }
    );
    expect(restore.status).toBe(200);

    /* restore 只撤銷刪除，不會順手把帳號重新啟用——刪除的前提就是先停用，
       所以復原後仍是停用狀態（403），要不要放人回來是另一個決定。 */
    const stillInactive = await fetchJson('/api/uep/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'um-del-user',
        password: 'del-password-1',
      }),
    });
    expect(stillInactive.status).toBe(403);

    await fetchJson(`/api/uep/admin/users/${user!.id}`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ isActive: true }),
    });
    const loginAfter = await fetchJson('/api/uep/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'um-del-user',
        password: 'del-password-1',
      }),
    });
    expect(loginAfter.status).toBe(200);
  });

  it('不存在的使用者：GET/PUT/DELETE/restore 回傳 404', async () => {
    const adminToken = await getAdminToken();
    const get = await fetchJson('/api/uep/admin/users/99999', {
      token: adminToken,
    });
    expect(get.status).toBe(404);
    const put = await fetchJson('/api/uep/admin/users/99999', {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ adminNote: 'x' }),
    });
    expect(put.status).toBe(404);
    const del = await fetchJson('/api/uep/admin/users/99999', {
      method: 'DELETE',
      token: adminToken,
    });
    expect(del.status).toBe(404);
    const restore = await fetchJson('/api/uep/admin/users/99999/restore', {
      method: 'POST',
      token: adminToken,
    });
    expect(restore.status).toBe(404);
  });
});

describe('權限隔離（安全邊界）', () => {
  async function getAdminToken(): Promise<string> {
    // bootstrap 可能已被其他測試檔執行過，失敗就直接登入
    await worker.fetch(
      createRequest('/api/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          username: 'sec-admin',
          password: 'sec-password',
          display_name: 'Sec Admin',
        }),
      }),
      env,
      ctx
    );
    const { body } = await fetchJson<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'sec-admin', password: 'sec-password' }),
    });
    return body.data!.token;
  }

  it('reader token 不能存取 admin 保護路由（媒體庫）', async () => {
    const { token } = await registerUser('reader-sec');
    const { status } = await fetchJson('/api/assets', { token });
    expect(status).toBe(401);
  });

  it('admin token 不能存取 reader 端點（me/progress）', async () => {
    const adminToken = await getAdminToken();
    const me = await fetchJson('/api/uep/auth/me', { token: adminToken });
    expect(me.status).toBe(401);
    const prog = await fetchJson('/api/uep/progress', { token: adminToken });
    expect(prog.status).toBe(401);
  });

  it('admin token 仍可正常存取 admin 路由（迴歸）', async () => {
    const adminToken = await getAdminToken();
    const { status } = await fetchJson('/api/assets', { token: adminToken });
    expect(status).toBe(200);
  });
});
