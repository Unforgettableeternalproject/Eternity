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

  it('storyKey 首次出現寫入 interlink_keys，重複存檔不覆蓋既有內容', async () => {
    const row = await env.CONTENT_DB.prepare(
      `SELECT key_value, title FROM interlink_keys
       WHERE key_type = 'story' AND key_value = 'uniq-story'`
    ).first<{ key_value: string; title: string | null }>();
    expect(row?.key_value).toBe('uniq-story');
    expect(row?.title).toBeNull();

    // 模擬管理者之後填了標題
    await env.CONTENT_DB.prepare(
      `UPDATE interlink_keys SET title = '雨海終曲'
       WHERE key_type = 'story' AND key_value = 'uniq-story'`
    ).run();

    // 重新存檔同一頁——INSERT OR IGNORE 不得覆蓋
    await putPage('echoes/uniq/story-one', {
      title: '劇情一（再存一次）',
      pageType: 'song',
      metadata: { storyKey: 'uniq-story', category: 'story' },
    });
    const after = await env.CONTENT_DB.prepare(
      `SELECT title FROM interlink_keys
       WHERE key_type = 'story' AND key_value = 'uniq-story'`
    ).first<{ title: string | null }>();
    expect(after?.title).toBe('雨海終曲');
  });

  it('entityKey 同樣建殼列，且 title 建成 NULL（名稱權威在 dossier）', async () => {
    const row = await env.CONTENT_DB.prepare(
      `SELECT key_value, title FROM interlink_keys
       WHERE key_type = 'entity' AND key_value = 'uniq-clash'`
    ).first<{ key_value: string; title: string | null }>();
    expect(row?.key_value).toBe('uniq-clash');
    expect(row?.title).toBeNull();
  });

  it('同名的 entityKey 與 storyKey 各自建殼，兩個命名空間互不干擾', async () => {
    // 'uniq-story' 先以 storyKey 存過一次，又以 entityKey 存過一次
    const rows = await env.CONTENT_DB.prepare(
      `SELECT key_type FROM interlink_keys WHERE key_value = 'uniq-story'
       ORDER BY key_type`
    ).all<{ key_type: string }>();
    expect(rows.results?.map((r) => r.key_type)).toEqual(['entity', 'story']);
  });

  it('未帶 metadata 的部分更新不觸發 key 檢查', async () => {
    const res = await putPage('echoes/uniq/song-one', {
      title: '只改標題',
    });
    expect(res.status).toBe(200);
  });
});

describe('History 反向索引與互聯反查端點（S10-1）', () => {
  const CLUE_ATTRS =
    'data-clue-id="clue-x" data-target-type="story" data-target-key="rain-sea-finale" data-gallery-title="雨海"';

  const historyContent = () => [
    {
      type: 'rich_text',
      content:
        '<p>那天<span data-uep-entity="concept" data-ref="entity:xavier-colsono">艾斯維爾</span>沒有回頭。</p>' +
        '<div data-role="echo-spot" data-spot-id="spot-x" data-song-type="story" data-story-key="rain-sea-finale" data-song-title="雨海終曲"></div>' +
        `<div data-role="visual-clue-start" ${CLUE_ATTRS}></div>` +
        `<div data-role="visual-clue-end" ${CLUE_ATTRS}></div>`,
    },
  ];

  async function putHistory(id: string, content: unknown, title = '測試章節') {
    const token = await getAdminToken();
    return worker.fetch(
      createRequest(`/api/content/${id}`, {
        method: 'PUT',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, pageType: 'page', content }),
      }),
      env,
      ctx
    );
  }

  async function indexRows(pageId: string) {
    const { results } = await env.CONTENT_DB.prepare(
      `SELECT anchor_kind, anchor_id, key_type, key_value, label
       FROM history_interlink_index WHERE page_id = ? ORDER BY id ASC`
    )
      .bind(pageId)
      .all<{
        anchor_kind: string;
        anchor_id: string | null;
        key_type: string;
        key_value: string;
        label: string | null;
      }>();
    return results;
  }

  it('History 頁存檔後索引三種標記', async () => {
    const res = await putHistory('history/ilx/chapter-one', historyContent());
    expect(res.status).toBe(201);

    const rows = await indexRows('history/ilx/chapter-one');
    expect(rows.map((r) => r.anchor_kind)).toEqual([
      'entity-mark',
      'echo-spot',
      'visual-clue-start',
      'visual-clue-end',
    ]);
    expect(rows[0]).toMatchObject({
      key_type: 'entity',
      key_value: 'xavier-colsono',
      label: '艾斯維爾',
      anchor_id: null,
    });
    expect(rows[1]).toMatchObject({
      key_type: 'story',
      key_value: 'rain-sea-finale',
      anchor_id: 'spot-x',
    });
  });

  it('重複存檔相同內容 → 索引列不累積（冪等）', async () => {
    await putHistory('history/ilx/chapter-one', historyContent());
    await putHistory('history/ilx/chapter-one', historyContent());
    expect(await indexRows('history/ilx/chapter-one')).toHaveLength(4);
  });

  it('內容改成沒有標記 → 索引清空', async () => {
    await putHistory('history/ilx/chapter-two', historyContent());
    expect(await indexRows('history/ilx/chapter-two')).toHaveLength(4);

    await putHistory('history/ilx/chapter-two', [
      { type: 'rich_text', content: '<p>改寫過，標記都拿掉了。</p>' },
    ]);
    expect(await indexRows('history/ilx/chapter-two')).toHaveLength(0);
  });

  it('未帶 content 的部分更新不動索引', async () => {
    await putHistory('history/ilx/chapter-three', historyContent());
    const token = await getAdminToken();
    await worker.fetch(
      createRequest('/api/content/history/ilx/chapter-three', {
        method: 'PUT',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '只改標題' }),
      }),
      env,
      ctx
    );
    expect(await indexRows('history/ilx/chapter-three')).toHaveLength(4);
  });

  it('軟刪除 History 頁 → 索引清空', async () => {
    await putHistory('history/ilx/chapter-four', historyContent());
    const token = await getAdminToken();
    const del = await worker.fetch(
      createRequest('/api/content/history/ilx/chapter-four', {
        method: 'DELETE',
        token,
      }),
      env,
      ctx
    );
    expect(del.status).toBe(200);
    expect(await indexRows('history/ilx/chapter-four')).toHaveLength(0);
  });

  it('GET /api/interlink/anchors 回傳該 key 的錨點', async () => {
    await putHistory('history/ilx/chapter-five', historyContent(), '第五章');
    const res = await worker.fetch(
      createRequest('/api/interlink/anchors?keyType=story&key=rain-sea-finale'),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { anchors: { pageId: string; pageTitle: string }[] };
    };
    expect(json.ok).toBe(true);
    const fromChapterFive = json.data.anchors.filter(
      (a) => a.pageId === 'history/ilx/chapter-five'
    );
    expect(fromChapterFive.length).toBeGreaterThan(0);
    expect(fromChapterFive[0].pageTitle).toBe('第五章');
  });

  it('查無資料 → 空陣列', async () => {
    const res = await worker.fetch(
      createRequest('/api/interlink/anchors?keyType=entity&key=nobody-uses-me'),
      env,
      ctx
    );
    const json = (await res.json()) as { data: { anchors: unknown[] } };
    expect(json.data.anchors).toEqual([]);
  });

  it('keyType 非法或缺 key → 400', async () => {
    const badType = await worker.fetch(
      createRequest('/api/interlink/anchors?keyType=illustration&key=x'),
      env,
      ctx
    );
    expect(badType.status).toBe(400);

    const noKey = await worker.fetch(
      createRequest('/api/interlink/anchors?keyType=entity'),
      env,
      ctx
    );
    expect(noKey.status).toBe(400);
  });

  it('GET /api/interlink/usage 同時給定義端與錨點端', async () => {
    // 定義端：一首掛同 storyKey 的劇情歌
    const token = await getAdminToken();
    await worker.fetch(
      createRequest('/api/content/echoes/ilx/story-song', {
        method: 'PUT',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '雨海終曲',
          pageType: 'song',
          metadata: { storyKey: 'rain-sea-finale', category: 'story' },
        }),
      }),
      env,
      ctx
    );

    const res = await worker.fetch(
      createRequest('/api/interlink/usage?keyType=story&key=rain-sea-finale', {
        token,
      }),
      env,
      ctx
    );
    const json = (await res.json()) as {
      data: {
        definitions: { area: string; pageId: string }[];
        anchors: unknown[];
        keyMeta?: { title: string | null };
      };
    };
    expect(
      json.data.definitions.some((d) => d.pageId === 'echoes/ilx/story-song')
    ).toBe(true);
    expect(json.data.anchors.length).toBeGreaterThan(0);
    // 存檔時建的殼列，title 仍為 NULL
    expect(json.data.keyMeta).toEqual({ title: null, description: null });
  });

  it('usage 對查無殼列的 key 不回 keyMeta', async () => {
    const res = await worker.fetch(
      createRequest('/api/interlink/usage?keyType=entity&key=never-defined', {
        token: await getAdminToken(),
      }),
      env,
      ctx
    );
    const json = (await res.json()) as {
      data: { keyMeta?: unknown };
    };
    expect(json.data.keyMeta).toBeUndefined();
  });

  it('清單三路聯集：有定義沒說明／有說明但定義已刪／只在 History 被引用', async () => {
    const now = new Date().toISOString();
    // 只有說明、沒有任何定義端與錨點（定義頁後來被刪掉的殘留）
    await env.CONTENT_DB.prepare(
      `INSERT OR REPLACE INTO interlink_keys
         (key_type, key_value, title, description, created_at, updated_at)
       VALUES ('story', 'orphan-meta', '孤兒說明', NULL, ?, ?)`
    )
      .bind(now, now)
      .run();

    const res = await worker.fetch(
      createRequest('/api/interlink/keys', { token: await getAdminToken() }),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        keys: {
          keyType: string;
          keyValue: string;
          title: string | null;
          definitionCount: number;
          anchorCount: number;
        }[];
      };
    };
    const byKey = (t: string, v: string) =>
      json.data.keys.find((k) => k.keyType === t && k.keyValue === v);

    // 有定義（劇情歌）且有錨點
    const defined = byKey('story', 'rain-sea-finale');
    expect(defined?.definitionCount).toBeGreaterThan(0);
    expect(defined?.anchorCount).toBeGreaterThan(0);

    // 有說明但零定義零錨點
    expect(byKey('story', 'orphan-meta')).toMatchObject({
      title: '孤兒說明',
      definitionCount: 0,
      anchorCount: 0,
    });
  });

  it('清單未授權 → 401', async () => {
    const res = await worker.fetch(
      createRequest('/api/interlink/keys'),
      env,
      ctx
    );
    expect(res.status).toBe(401);
  });

  it('PUT story 寫入標題與說明', async () => {
    const res = await worker.fetch(
      createRequest('/api/interlink/keys/story/rain-sea-finale', {
        method: 'PUT',
        token: await getAdminToken(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '雨海終曲', description: '第三章結尾' }),
      }),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const row = await env.CONTENT_DB.prepare(
      `SELECT title, description FROM interlink_keys
       WHERE key_type = 'story' AND key_value = 'rain-sea-finale'`
    ).first<{ title: string | null; description: string | null }>();
    expect(row).toEqual({ title: '雨海終曲', description: '第三章結尾' });
  });

  /**
   * entity 的權威名稱在 Concepts dossier 條目上。這張表也存一份就會有
   * 兩個各自漂移的名字，所以資料層直接忽略請求體的 title，不靠前端自律。
   */
  it('PUT entity 忽略 title，只寫 description', async () => {
    const res = await worker.fetch(
      createRequest('/api/interlink/keys/entity/xavier-colsono', {
        method: 'PUT',
        token: await getAdminToken(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '亂寫的名字', description: '主角' }),
      }),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { keyMeta: { title: string | null; description: string | null } };
    };
    expect(json.data.keyMeta.title).toBeNull();

    const row = await env.CONTENT_DB.prepare(
      `SELECT title, description FROM interlink_keys
       WHERE key_type = 'entity' AND key_value = 'xavier-colsono'`
    ).first<{ title: string | null; description: string | null }>();
    expect(row).toEqual({ title: null, description: '主角' });
  });

  /**
   * `pnpm sync` 靠 updated_at 比對兩端。寫入時一律蓋成當下時間的話，
   * 被推過去的那筆立刻變「較新」，下次同步反向覆蓋，兩端永遠互推。
   */
  it('PUT 帶 updatedAt 時保留來源時間戳', async () => {
    const stamp = '2019-03-04T05:06:07.000Z';
    await worker.fetch(
      createRequest('/api/interlink/keys/story/stamped-key', {
        method: 'PUT',
        token: await getAdminToken(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '有時間戳', updatedAt: stamp }),
      }),
      env,
      ctx
    );
    const row = await env.CONTENT_DB.prepare(
      `SELECT updated_at AS updatedAt FROM interlink_keys
       WHERE key_type = 'story' AND key_value = 'stamped-key'`
    ).first<{ updatedAt: string }>();
    expect(row?.updatedAt).toBe(stamp);
  });

  it('清單回傳 updatedAt 供同步比對', async () => {
    const res = await worker.fetch(
      createRequest('/api/interlink/keys', { token: await getAdminToken() }),
      env,
      ctx
    );
    const json = (await res.json()) as {
      data: { keys: { keyValue: string; updatedAt: string | null }[] };
    };
    const stamped = json.data.keys.find((k) => k.keyValue === 'stamped-key');
    expect(stamped?.updatedAt).toBe('2019-03-04T05:06:07.000Z');
    // 沒有殼列的 key（只有定義端或錨點端）updatedAt 為 null
    expect(
      json.data.keys.every(
        (k) => k.updatedAt === null || typeof k.updatedAt === 'string'
      )
    ).toBe(true);
  });

  /**
   * 前台的觸發呼叫都是匿名 fetch。這個端點若誤加 isAuthorized，
   * 「命名可見」整條鏈路會靜默 401 失效——不報錯，卡片就是不顯示標題。
   */
  it('/keys/public 匿名可讀，且不回 definitions 與 anchors', async () => {
    await worker.fetch(
      createRequest('/api/interlink/keys/story/rain-sea-finale', {
        method: 'PUT',
        token: await getAdminToken(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '雨海終曲' }),
      }),
      env,
      ctx
    );

    const res = await worker.fetch(
      createRequest(
        '/api/interlink/keys/public?keyType=story&key=rain-sea-finale'
      ),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Record<string, unknown> & {
        keyMeta: { title: string | null } | null;
      };
    };
    expect(json.data.keyMeta?.title).toBe('雨海終曲');
    expect(json.data.definitions).toBeUndefined();
    expect(json.data.anchors).toBeUndefined();
  });

  /**
   * 批次模式（T-B7-1）：Echoes 收藏池一頁可能有數十首劇情歌，逐首查會對
   * 同一個端點掃射。
   */
  it('/keys/public 批次模式一次取多把，查無的不出現在回應裡', async () => {
    const token = await getAdminToken();
    for (const [key, title] of [
      ['batch-a', '甲'],
      ['batch-b', '乙'],
    ]) {
      await worker.fetch(
        createRequest(`/api/interlink/keys/story/${key}`, {
          method: 'PUT',
          token,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        }),
        env,
        ctx
      );
    }

    const res = await worker.fetch(
      createRequest(
        '/api/interlink/keys/public?keyType=story&keys=batch-a,batch-b,batch-missing'
      ),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { keyMetas: Record<string, { title: string | null }> };
    };
    expect(json.data.keyMetas['batch-a'].title).toBe('甲');
    expect(json.data.keyMetas['batch-b'].title).toBe('乙');
    // 查無的 key 不補 null——呼叫端本來就要處理「還沒建殼列」
    expect(json.data.keyMetas['batch-missing']).toBeUndefined();
  });

  it('/keys/public 批次模式的邊界：key 與 keys 互斥、空值與超量皆 400', async () => {
    const bad = async (qs: string) =>
      (
        await worker.fetch(
          createRequest(`/api/interlink/keys/public?${qs}`),
          env,
          ctx
        )
      ).status;
    // 兩者回應形狀不同，同時給無法決定要回哪一種
    expect(await bad('keyType=story&key=a&keys=b')).toBe(400);
    expect(await bad('keyType=story&keys=')).toBe(400);
    expect(await bad('keyType=story&keys=,,')).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => `k${i}`).join(',');
    expect(await bad(`keyType=story&keys=${many}`)).toBe(400);
  });

  /**
   * `public` 這一段若被 `/keys/:type/:value` 的正規式吃掉，就會被當成
   * keyType 而落進 admin 路由。
   */
  it('/keys/public 不被 /keys/:type/:value 路由吃掉', async () => {
    const res = await worker.fetch(
      createRequest('/api/interlink/keys/public?keyType=entity&key=never-x'),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { keyMeta: unknown } };
    expect(json.data.keyMeta).toBeNull();
  });

  /**
   * usage 的定義端 live-scan 刻意 includeHidden（管理者要看到全部使用
   * 位置），並帶 key 的標題／說明。未授權放行等同把未公開內容的頁 id
   * 與標題送出去，CDN 一快取更是攔不回來。
   */
  it('usage 未授權 → 401，且不進共用快取', async () => {
    const res = await worker.fetch(
      createRequest('/api/interlink/usage?keyType=story&key=rain-sea-finale'),
      env,
      ctx
    );
    expect(res.status).toBe(401);

    const authed = await worker.fetch(
      createRequest('/api/interlink/usage?keyType=story&key=rain-sea-finale', {
        token: await getAdminToken(),
      }),
      env,
      ctx
    );
    expect(authed.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('anchors 維持公開（觸發模型的讀者端要用）', async () => {
    const res = await worker.fetch(
      createRequest('/api/interlink/anchors?keyType=story&key=rain-sea-finale'),
      env,
      ctx
    );
    expect(res.status).toBe(200);
  });

  it('anchors-summary 回傳逐頁分類計數，未授權 401', async () => {
    await putHistory('history/ilx/chapter-five', historyContent());

    const anon = await worker.fetch(
      createRequest('/api/interlink/anchors-summary'),
      env,
      ctx
    );
    expect(anon.status).toBe(401);

    const res = await worker.fetch(
      createRequest('/api/interlink/anchors-summary', {
        token: await getAdminToken(),
      }),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const json = (await res.json()) as {
      data: { pages: Record<string, Record<string, number>> };
    };
    expect(json.data.pages['history/ilx/chapter-five']).toMatchObject({
      'entity-mark': 1,
      'echo-spot': 1,
      'visual-clue-start': 1,
      'visual-clue-end': 1,
    });
  });
});

describe('PATCH /api/content/:area/:slug/metadata — 進度頁部分更新（S10-3b）', () => {
  const PAGE_ID = 'history/mdp/chapter-one';

  async function patchMetadata(
    id: string,
    body: unknown,
    withToken = true
  ): Promise<{ status: number; json: any }> {
    const token = withToken ? await getAdminToken() : undefined;
    const res = await worker.fetch(
      createRequest(`/api/content/${id}/metadata`, {
        method: 'PATCH',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      ctx
    );
    return { status: res.status, json: await res.json() };
  }

  async function readRow(id: string) {
    return env.CONTENT_DB.prepare(
      'SELECT content, metadata, updated_at FROM pages WHERE id = ?'
    )
      .bind(id)
      .first<{ content: string; metadata: string; updated_at: string }>();
  }

  beforeAll(async () => {
    // 帶錨點 content + 既有 metadata 鍵的 History 頁，走 PUT 建立讓
    // 反向索引真的先有列——「PATCH 不觸發重建」才有可驗證的對象
    const token = await getAdminToken();
    await worker.fetch(
      createRequest(`/api/content/${PAGE_ID}`, {
        method: 'PUT',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '進度頁測試章節',
          pageType: 'page',
          content: [
            {
              type: 'rich_text',
              content:
                '<div data-role="echo-spot" data-spot-id="spot-mdp" data-song-type="story" data-story-key="mdp-finale" data-song-title="測試曲"></div>',
            },
          ],
          metadata: { icon: '📜', gate: { requiresFlags: ['mdp-flag'] } },
        }),
      }),
      env,
      ctx
    );
  });

  it('未授權 → 401', async () => {
    const { status } = await patchMetadata(
      PAGE_ID,
      { progressPage: true },
      false
    );
    expect(status).toBe(401);
  });

  it('路由不被 contentMatch 吃掉（地雷 2 回歸：非 405/404）', async () => {
    const { status } = await patchMetadata(PAGE_ID, { progressPage: true });
    expect(status).toBe(200);
  });

  it('progressPage:true 寫入且既有 metadata 鍵原樣保留', async () => {
    const { status, json } = await patchMetadata(PAGE_ID, {
      progressPage: true,
    });
    expect(status).toBe(200);
    expect(json.data.metadata).toMatchObject({
      progressPage: true,
      icon: '📜',
      gate: { requiresFlags: ['mdp-flag'] },
    });

    const row = await readRow(PAGE_ID);
    expect(JSON.parse(row!.metadata)).toMatchObject({
      progressPage: true,
      icon: '📜',
    });
  });

  it('false 刪鍵而非存 false（與編輯器 Inspector 的形狀一致）', async () => {
    await patchMetadata(PAGE_ID, { progressPage: true, gateExempt: true });
    const { json } = await patchMetadata(PAGE_ID, {
      progressPage: false,
      gateExempt: false,
    });
    expect('progressPage' in json.data.metadata).toBe(false);
    expect('gateExempt' in json.data.metadata).toBe(false);

    const row = await readRow(PAGE_ID);
    const stored = JSON.parse(row!.metadata);
    expect('progressPage' in stored).toBe(false);
    expect('gateExempt' in stored).toBe(false);
    // 其他鍵不因刪鍵而消失
    expect(stored.icon).toBe('📜');
  });

  it('白名單外的鍵 → 400 且不寫入', async () => {
    const before = await readRow(PAGE_ID);
    const { status } = await patchMetadata(PAGE_ID, {
      progressPage: true,
      entityKey: 'sneaky-bypass',
    });
    expect(status).toBe(400);
    const after = await readRow(PAGE_ID);
    expect(after!.metadata).toBe(before!.metadata);
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  it('非 boolean 值 → 400', async () => {
    const { status } = await patchMetadata(PAGE_ID, { progressPage: 'yes' });
    expect(status).toBe(400);
  });

  it('空 body → 400', async () => {
    const { status } = await patchMetadata(PAGE_ID, {});
    expect(status).toBe(400);
  });

  it('不存在的頁面 → 404', async () => {
    const { status } = await patchMetadata('history/mdp/nonexistent', {
      progressPage: true,
    });
    expect(status).toBe(404);
  });

  it('PATCH 不觸發反向索引重建、不動 content，但 updated_at 有更新', async () => {
    const before = await readRow(PAGE_ID);
    const { results: idxBefore } = await env.CONTENT_DB.prepare(
      'SELECT id FROM history_interlink_index WHERE page_id = ?'
    )
      .bind(PAGE_ID)
      .all();
    expect(idxBefore.length).toBeGreaterThan(0);

    const { status } = await patchMetadata(PAGE_ID, { progressPage: true });
    expect(status).toBe(200);

    const after = await readRow(PAGE_ID);
    const { results: idxAfter } = await env.CONTENT_DB.prepare(
      'SELECT id FROM history_interlink_index WHERE page_id = ?'
    )
      .bind(PAGE_ID)
      .all();
    expect(idxAfter).toEqual(idxBefore);
    expect(after!.content).toBe(before!.content);
    expect(after!.updated_at).not.toBe(before!.updated_at);
  });
});
