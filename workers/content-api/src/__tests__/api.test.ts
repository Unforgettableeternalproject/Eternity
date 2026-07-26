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
        storyPoint?: { title: string | null };
      };
    };
    expect(
      json.data.definitions.some((d) => d.pageId === 'echoes/ilx/story-song')
    ).toBe(true);
    expect(json.data.anchors.length).toBeGreaterThan(0);
    // 存檔時建的殼列，title 仍為 NULL
    expect(json.data.storyPoint).toEqual({ title: null, description: null });
  });

  it('usage 對 entity 類型不回 storyPoint', async () => {
    const res = await worker.fetch(
      createRequest('/api/interlink/usage?keyType=entity&key=xavier-colsono', {
        token: await getAdminToken(),
      }),
      env,
      ctx
    );
    const json = (await res.json()) as {
      data: { storyPoint?: unknown };
    };
    expect(json.data.storyPoint).toBeUndefined();
  });

  /**
   * usage 的定義端 live-scan 刻意 includeHidden（管理者要看到全部使用
   * 位置），S10-3 之後還會帶劇情點標題／說明。未授權放行等同把未公開
   * 內容的頁 id 與標題送出去，CDN 一快取更是攔不回來。
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
});
