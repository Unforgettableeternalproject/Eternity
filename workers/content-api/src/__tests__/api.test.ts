import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * Content API Worker 整合測試
 *
 * 在 Miniflare runtime 內執行，使用真實的 D1 資料庫（已套用 migrations）。
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
        username: 'test-admin',
        password: 'test-password',
        display_name: 'Test Admin',
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
        username: 'test-admin',
        password: 'test-password',
      }),
    }),
    env,
    ctx
  );
  const json = (await res.json()) as { data?: { token?: string } };
  adminToken = json.data?.token;
  return adminToken;
}

// 輔助函式：建立模擬 Request
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
  return new Request(`http://localhost${path}`, { ...init, headers });
}

describe('Content API — 內容讀取', () => {
  // 先插入測試資料
  beforeAll(async () => {
    await env.CONTENT_DB.prepare(
      `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        'history/test-page',
        'history',
        '測試頁面',
        'test-page',
        1,
        JSON.stringify({ type: 'doc', content: [] }),
        JSON.stringify({ icon: '📜' }),
        'synced',
        'page',
        0
      )
      .run();
  });

  it('GET /api/content/history 列出 history 區域的頁面', async () => {
    const req = createRequest('/api/content/history');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { data: unknown[] };
    expect(data.data).toBeDefined();
    expect(data.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/content/history/tree 回傳樹狀結構', async () => {
    const req = createRequest('/api/content/history/tree');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { data: unknown[] };
    expect(data.data).toBeDefined();
  });

  it('GET /api/content/history/test-page 取得單頁內容', async () => {
    const req = createRequest('/api/content/history/test-page');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      data: { title: string; slug: string };
    };
    expect(data.data.title).toBe('測試頁面');
    expect(data.data.slug).toBe('test-page');
  });

  it('GET /api/content/history/nonexistent 回傳 404', async () => {
    const req = createRequest('/api/content/history/nonexistent');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(404);
  });
});

describe('Content API — CORS', () => {
  it('OPTIONS 預檢回傳 CORS 標頭', async () => {
    const req = createRequest('/api/content/history', { method: 'OPTIONS' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('允許的 Origin 得到正確的 CORS 回應', async () => {
    const req = createRequest('/api/content/history');
    const res = await worker.fetch(req, env, ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:4321'
    );
  });
});

describe('Content API — 未知路徑', () => {
  it('不存在的路徑回傳 404', async () => {
    const req = createRequest('/nonexistent');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(404);
  });
});

describe('Root API — 同步時間戳', () => {
  it.each([
    [
      'projects',
      'sync-project',
      {
        titleZh: '同步測試專案',
        titleEn: 'Sync Test Project',
        tags: ['test'],
      },
    ],
    [
      'links',
      'sync-link',
      {
        titleZh: '同步測試連結',
        titleEn: 'Sync Test Link',
        url: 'https://example.com',
      },
    ],
    [
      'updates',
      'sync-update',
      {
        titleZh: '同步測試更新',
        titleEn: 'Sync Test Update',
        date: '2026-05-26',
      },
    ],
  ])(
    'PUT /api/root/%s/:id 保留來源端 updatedAt',
    async (collection, id, body) => {
      const updatedAt = '2026-05-26T06:33:12.000Z';
      const token = await getAdminToken();
      const req = createRequest(`/api/root/${collection}/${id}`, {
        method: 'PUT',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, updatedAt }),
      });

      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(201);

      const data = (await res.json()) as {
        data: { updatedAt: string };
      };
      expect(data.data.updatedAt).toBe(updatedAt);
    }
  );
});

describe('PUT /api/content/:area/:slug — key 唯一性把關（S10-1）', () => {
  interface ConflictResponse {
    ok: boolean;
    error?: string;
    conflict?: {
      field: string;
      key: string;
      conflictingPageId: string;
      conflictingPageTitle: string;
    };
  }

  async function putPage(
    id: string,
    body: Record<string, unknown>
  ): Promise<{ status: number; json: ConflictResponse }> {
    const token = await getAdminToken();
    const res = await worker.fetch(
      createRequest(`/api/content/${id}`, {
        method: 'PUT',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      ctx
    );
    return { status: res.status, json: (await res.json()) as ConflictResponse };
  }

  /** 單一 dossier 條目的 content 形狀 */
  const dossierContent = (entityKey: string) => [
    {
      type: 'dossier',
      content: JSON.stringify({
        variants: [
          {
            id: 'u',
            subcategories: [
              {
                label: 'X',
                groups: [
                  { label: 'Y', entries: [{ name: '條目', entityKey }] },
                ],
              },
            ],
          },
        ],
      }),
    },
  ];

  it('Echoes 同 zone entityKey 撞名 → 409 並帶出衝突頁', async () => {
    const first = await putPage('echoes/uniq/song-one', {
      title: '第一首',
      pageType: 'song',
      metadata: { entityKey: 'uniq-clash' },
    });
    expect(first.status).toBe(201);

    const second = await putPage('echoes/uniq/song-two', {
      title: '第二首',
      pageType: 'song',
      metadata: { entityKey: 'uniq-clash' },
    });
    expect(second.status).toBe(409);
    expect(second.json.conflict).toMatchObject({
      field: 'entityKey',
      key: 'uniq-clash',
      conflictingPageId: 'echoes/uniq/song-one',
      conflictingPageTitle: '第一首',
    });
  });

  it('storyKey 撞名同樣 409，且與 entityKey 分屬不同命名空間', async () => {
    const first = await putPage('echoes/uniq/story-one', {
      title: '劇情一',
      pageType: 'song',
      metadata: { storyKey: 'uniq-story', category: 'story' },
    });
    expect(first.status).toBe(201);

    const clash = await putPage('echoes/uniq/story-two', {
      title: '劇情二',
      pageType: 'song',
      metadata: { storyKey: 'uniq-story', category: 'story' },
    });
    expect(clash.status).toBe(409);
    expect(clash.json.conflict?.field).toBe('storyKey');

    // 同一個字串當 entityKey 用不算衝突（兩個命名空間允許重疊）
    const asEntity = await putPage('echoes/uniq/song-three', {
      title: '同名但是 entityKey',
      pageType: 'song',
      metadata: { entityKey: 'uniq-story' },
    });
    expect(asEntity.status).toBe(201);
  });

  it('更新自身頁面不會被自己的 key 擋下', async () => {
    const again = await putPage('echoes/uniq/song-one', {
      title: '第一首（改標題）',
      pageType: 'song',
      metadata: { entityKey: 'uniq-clash' },
    });
    expect(again.status).toBe(200);
  });

  it('跨 zone 撞名放行（互聯的基礎）', async () => {
    const inVisuals = await putPage('visuals/uniq/gallery-one', {
      title: '同名畫廊',
      pageType: 'gallery',
      metadata: { entityKey: 'uniq-clash' },
    });
    expect(inVisuals.status).toBe(201);
  });

  it('軟刪除後 key 釋放，可被其他頁面接手', async () => {
    await putPage('echoes/uniq/song-temp', {
      title: '暫存曲',
      pageType: 'song',
      metadata: { entityKey: 'uniq-recycle' },
    });
    const token = await getAdminToken();
    const del = await worker.fetch(
      createRequest('/api/content/echoes/uniq/song-temp', {
        method: 'DELETE',
        token,
      }),
      env,
      ctx
    );
    expect(del.status).toBe(200);

    const reuse = await putPage('echoes/uniq/song-reuse', {
      title: '接手曲',
      pageType: 'song',
      metadata: { entityKey: 'uniq-recycle' },
    });
    expect(reuse.status).toBe(201);
  });

  it('Concepts 同 stack 跨頁撞名 → 409；不同 stack 放行', async () => {
    const first = await putPage('concepts/uniq/dossier-a', {
      title: '檔案甲',
      pageType: 'page',
      metadata: { stack_style: 'dossier' },
      content: dossierContent('uniq-person'),
    });
    expect(first.status).toBe(201);

    const sameStack = await putPage('concepts/uniq/dossier-b', {
      title: '檔案乙',
      pageType: 'page',
      metadata: { stack_style: 'dossier' },
      content: dossierContent('uniq-person'),
    });
    expect(sameStack.status).toBe(409);
    expect(sameStack.json.conflict?.conflictingPageId).toBe(
      'concepts/uniq/dossier-a'
    );

    // 不同 stack 的同 key 合法
    const otherStack = await putPage('concepts/uniq/browser-a', {
      title: '瀏覽器甲',
      pageType: 'page',
      metadata: { stack_style: 'browser' },
      content: [
        {
          type: 'browser',
          content: JSON.stringify({
            profiles: [{ name: '側寫', entityKey: 'uniq-person' }],
          }),
        },
      ],
    });
    expect(otherStack.status).toBe(201);
  });

  it('storyKey 首次出現寫入 story_points，重複存檔不覆蓋既有內容', async () => {
    const row = await env.CONTENT_DB.prepare(
      `SELECT story_key, title FROM story_points WHERE story_key = 'uniq-story'`
    ).first<{ story_key: string; title: string | null }>();
    expect(row?.story_key).toBe('uniq-story');
    expect(row?.title).toBeNull();

    // 模擬 S10-3 之後填了標題
    await env.CONTENT_DB.prepare(
      `UPDATE story_points SET title = '雨海終曲' WHERE story_key = 'uniq-story'`
    ).run();

    // 重新存檔同一頁——INSERT OR IGNORE 不得覆蓋
    await putPage('echoes/uniq/story-one', {
      title: '劇情一（再存一次）',
      pageType: 'song',
      metadata: { storyKey: 'uniq-story', category: 'story' },
    });
    const after = await env.CONTENT_DB.prepare(
      `SELECT title FROM story_points WHERE story_key = 'uniq-story'`
    ).first<{ title: string | null }>();
    expect(after?.title).toBe('雨海終曲');
  });

  it('未帶 metadata 的部分更新不觸發 key 檢查', async () => {
    const res = await putPage('echoes/uniq/song-one', {
      title: '只改標題',
    });
    expect(res.status).toBe(200);
  });
});
