import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * 批次匯入的 S10 寫入契約測試（S10-1 修補）
 *
 * `/api/content/sync/import` 是所有 migrate-*.mjs 的入口，卻長期繞過
 * `upsertPage` 的三道關卡：撞名可寫入、storyKey 沒有殼列、History 反向
 * 索引不建也不更新。單頁存檔的測試全綠也抓不到，因為根本是另一條路徑。
 *
 * 另含 migration 0022 的資料補建（`/api/interlink/reindex`）：migration
 * 只建空表，既有文章的錨點必須另外掃一次才查得到。
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

let adminToken: string | undefined;

async function getAdminToken(): Promise<string> {
  if (adminToken) return adminToken;
  await worker.fetch(
    request('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'import-admin',
        password: 'import-password',
        display_name: 'Import Admin',
      }),
    }),
    env,
    ctx
  );
  const res = await worker.fetch(
    request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'import-admin',
        password: 'import-password',
      }),
    }),
    env,
    ctx
  );
  const json = (await res.json()) as { data?: { token?: string } };
  adminToken = json.data?.token ?? '';
  return adminToken;
}

function request(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Origin', 'http://localhost:4321');
  return new Request(`http://localhost${path}`, { ...rest, headers });
}

interface ImportOutcome {
  imported: number;
  updated: number;
  skipped: number;
  conflicts: number;
  details: {
    imported: string[];
    updated: string[];
    skipped: string[];
    conflicts: { pageId: string; field: string; key: string }[];
  };
}

/** 匯入一批頁面，回傳統計 */
async function importPages(
  pages: Record<string, unknown>[]
): Promise<ImportOutcome> {
  const res = await worker.fetch(
    request('/api/content/sync/import', {
      method: 'POST',
      token: await getAdminToken(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages }),
    }),
    env,
    ctx
  );
  const json = (await res.json()) as { data: ImportOutcome };
  return json.data;
}

/** 匯入用的頁面骨架；contentHash 預設隨 id 走，改內容時要一起換 */
function page(
  overrides: Record<string, unknown> & { id: string; area: string }
): Record<string, unknown> {
  return {
    title: overrides.id,
    slug: overrides.id.split('/').slice(1).join('/'),
    content: [],
    sourceFile: `${overrides.id}.md`,
    contentHash: `hash-${overrides.id}`,
    pageType: 'page',
    depth: 1,
    ...overrides,
  };
}

/** History 內文含一個 entity mark 的 content 區塊 */
function contentWithEntityMark(key: string, label: string) {
  return [
    {
      type: 'rich_text',
      content: `<p>那時候<span data-uep-entity="concept" data-ref="entity:${key}">${label}</span>還在。</p>`,
    },
  ];
}

async function anchorsOf(keyType: string, key: string) {
  const res = await worker.fetch(
    request(`/api/interlink/anchors?keyType=${keyType}&key=${key}`),
    env,
    ctx
  );
  const json = (await res.json()) as {
    data: { anchors: { pageId: string; label: string | null }[] };
  };
  return json.data.anchors;
}

describe('sync/import — History 反向索引', () => {
  it('匯入 History 頁時建立反向索引（原本完全不建）', async () => {
    const result = await importPages([
      page({
        id: 'history/imp/ch-a',
        area: 'history',
        content: contentWithEntityMark('imp-xavier', '艾斯維爾'),
      }),
    ]);
    expect(result.imported).toBe(1);

    const anchors = await anchorsOf('entity', 'imp-xavier');
    expect(anchors).toEqual([
      {
        pageId: 'history/imp/ch-a',
        pageTitle: expect.any(String),
        anchorKind: 'entity-mark',
        anchorId: null,
        label: '艾斯維爾',
      },
    ]);
  });

  it('來源內容更新時索引跟著重建（舊錨點不殘留）', async () => {
    await importPages([
      page({
        id: 'history/imp/ch-b',
        area: 'history',
        content: contentWithEntityMark('imp-old-key', '舊的人'),
      }),
    ]);
    expect(await anchorsOf('entity', 'imp-old-key')).toHaveLength(1);

    await importPages([
      page({
        id: 'history/imp/ch-b',
        area: 'history',
        contentHash: 'hash-history/imp/ch-b-v2',
        content: contentWithEntityMark('imp-new-key', '新的人'),
      }),
    ]);

    expect(await anchorsOf('entity', 'imp-old-key')).toHaveLength(0);
    expect(await anchorsOf('entity', 'imp-new-key')).toHaveLength(1);
  });
});

/**
 * 更新既有頁時，唯一性檢查與 story point 殼列都依「即將落地的 metadata」
 * 求值。UPDATE 若不寫 metadata，檢查的就是一個不存在的狀態——同步回報
 * updated，D1 裡的 key 卻還是舊值，還會替不存在的 storyKey 建出孤兒殼列。
 */
describe('sync/import — 更新既有頁的 metadata', () => {
  async function metadataOf(id: string): Promise<Record<string, unknown>> {
    const row = await env.CONTENT_DB.prepare(
      'SELECT metadata FROM pages WHERE id = ?'
    )
      .bind(id)
      .first<{ metadata: string }>();
    return JSON.parse(row?.metadata || '{}') as Record<string, unknown>;
  }

  it('來源改了 entityKey → D1 跟著改（不是回報 updated 卻留舊值）', async () => {
    await importPages([
      page({
        id: 'echoes/imp/meta-song',
        area: 'echoes',
        pageType: 'song',
        metadata: { entityKey: 'imp-meta-old', category: 'character' },
      }),
    ]);
    expect((await metadataOf('echoes/imp/meta-song')).entityKey).toBe(
      'imp-meta-old'
    );

    const result = await importPages([
      page({
        id: 'echoes/imp/meta-song',
        area: 'echoes',
        pageType: 'song',
        contentHash: 'hash-echoes/imp/meta-song-v2',
        metadata: { entityKey: 'imp-meta-new', category: 'character' },
      }),
    ]);
    expect(result.updated).toBe(1);
    expect((await metadataOf('echoes/imp/meta-song')).entityKey).toBe(
      'imp-meta-new'
    );
  });

  it('D1 端手動維護的欄位不被來源清掉（合併而非覆蓋）', async () => {
    await importPages([
      page({
        id: 'visuals/imp/meta-gal',
        area: 'visuals',
        pageType: 'gallery',
        metadata: { entityKey: 'imp-meta-gal' },
      }),
    ]);
    // 編輯器補上的欄位：markdown 來源不帶這些
    await env.CONTENT_DB.prepare(`UPDATE pages SET metadata = ? WHERE id = ?`)
      .bind(
        JSON.stringify({
          entityKey: 'imp-meta-gal',
          icon: '🖼️',
          gate: { requiresFlags: ['completed:history/ch1'] },
        }),
        'visuals/imp/meta-gal'
      )
      .run();

    await importPages([
      page({
        id: 'visuals/imp/meta-gal',
        area: 'visuals',
        pageType: 'gallery',
        contentHash: 'hash-visuals/imp/meta-gal-v2',
        metadata: { entityKey: 'imp-meta-gal-2' },
      }),
    ]);

    const meta = await metadataOf('visuals/imp/meta-gal');
    expect(meta.entityKey).toBe('imp-meta-gal-2');
    expect(meta.icon).toBe('🖼️');
    expect(meta.gate).toEqual({ requiresFlags: ['completed:history/ch1'] });
  });

  it('來源沒帶 metadata 時原樣保留', async () => {
    await importPages([
      page({
        id: 'echoes/imp/meta-keep',
        area: 'echoes',
        pageType: 'song',
        metadata: { entityKey: 'imp-meta-keep', category: 'character' },
      }),
    ]);

    await importPages([
      {
        ...page({
          id: 'echoes/imp/meta-keep',
          area: 'echoes',
          pageType: 'song',
          contentHash: 'hash-echoes/imp/meta-keep-v2',
        }),
        metadata: undefined,
      },
    ]);

    expect((await metadataOf('echoes/imp/meta-keep')).entityKey).toBe(
      'imp-meta-keep'
    );
  });

  it('更新成新的 storyKey → 殼列建在新 key 上', async () => {
    await importPages([
      page({
        id: 'echoes/imp/meta-story',
        area: 'echoes',
        pageType: 'song',
        metadata: { storyKey: 'imp-story-old', category: 'story' },
      }),
    ]);

    await importPages([
      page({
        id: 'echoes/imp/meta-story',
        area: 'echoes',
        pageType: 'song',
        contentHash: 'hash-echoes/imp/meta-story-v2',
        metadata: { storyKey: 'imp-story-new', category: 'story' },
      }),
    ]);

    expect((await metadataOf('echoes/imp/meta-story')).storyKey).toBe(
      'imp-story-new'
    );
    const row = await env.CONTENT_DB.prepare(
      "SELECT key_value FROM interlink_keys WHERE key_type = 'story' AND key_value = ?"
    )
      .bind('imp-story-new')
      .first();
    expect(row).toBeTruthy();
  });

  it('更新成已被別頁佔用的 key → 擋下，metadata 不動', async () => {
    await importPages([
      page({
        id: 'echoes/imp/meta-holder',
        area: 'echoes',
        pageType: 'song',
        metadata: { entityKey: 'imp-meta-taken', category: 'character' },
      }),
      page({
        id: 'echoes/imp/meta-mover',
        area: 'echoes',
        pageType: 'song',
        metadata: { entityKey: 'imp-meta-mine', category: 'character' },
      }),
    ]);

    const result = await importPages([
      page({
        id: 'echoes/imp/meta-mover',
        area: 'echoes',
        pageType: 'song',
        contentHash: 'hash-echoes/imp/meta-mover-v2',
        metadata: { entityKey: 'imp-meta-taken', category: 'character' },
      }),
    ]);

    expect(result.conflicts).toBe(1);
    expect(result.updated).toBe(0);
    expect((await metadataOf('echoes/imp/meta-mover')).entityKey).toBe(
      'imp-meta-mine'
    );
  });
});

describe('sync/import — key 唯一性把關', () => {
  beforeAll(async () => {
    await importPages([
      page({
        id: 'echoes/imp/first-song',
        area: 'echoes',
        pageType: 'song',
        metadata: { entityKey: 'imp-occupied', category: 'character' },
      }),
    ]);
  });

  it('與既有頁面撞名的那頁被擋下並回報，其餘照常寫入', async () => {
    const result = await importPages([
      page({
        id: 'echoes/imp/dup-song',
        area: 'echoes',
        pageType: 'song',
        metadata: { entityKey: 'imp-occupied', category: 'character' },
      }),
      page({
        id: 'echoes/imp/ok-song',
        area: 'echoes',
        pageType: 'song',
        metadata: { entityKey: 'imp-fresh', category: 'character' },
      }),
    ]);

    expect(result.conflicts).toBe(1);
    expect(result.details.conflicts[0]).toMatchObject({
      pageId: 'echoes/imp/dup-song',
      field: 'entityKey',
      key: 'imp-occupied',
      conflictingPageId: 'echoes/imp/first-song',
    });
    expect(result.details.imported).toEqual(['echoes/imp/ok-song']);

    // 被擋下的頁不得留在 D1
    const row = await env.CONTENT_DB.prepare(
      'SELECT id FROM pages WHERE id = ?'
    )
      .bind('echoes/imp/dup-song')
      .first();
    expect(row).toBeNull();
  });

  it('同一批之內互撞也擋得住（DB 快照看不到彼此）', async () => {
    const result = await importPages([
      page({
        id: 'visuals/imp/gal-a',
        area: 'visuals',
        pageType: 'gallery',
        metadata: { entityKey: 'imp-twin' },
      }),
      page({
        id: 'visuals/imp/gal-b',
        area: 'visuals',
        pageType: 'gallery',
        metadata: { entityKey: 'imp-twin' },
      }),
    ]);

    expect(result.imported).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(result.details.conflicts[0]).toMatchObject({
      pageId: 'visuals/imp/gal-b',
      conflictingPageId: 'visuals/imp/gal-a',
    });
  });

  it('跨 zone 同名 key 不互擋（互聯的基礎）', async () => {
    const result = await importPages([
      page({
        id: 'echoes/imp/cross-song',
        area: 'echoes',
        pageType: 'song',
        metadata: { entityKey: 'imp-cross', category: 'character' },
      }),
      page({
        id: 'visuals/imp/cross-gal',
        area: 'visuals',
        pageType: 'gallery',
        metadata: { entityKey: 'imp-cross' },
      }),
    ]);

    expect(result.conflicts).toBe(0);
    expect(result.imported).toBe(2);
  });
});

describe('sync/import — key 殼列', () => {
  it('匯入劇情歌時建立 interlink_keys 殼列', async () => {
    await importPages([
      page({
        id: 'echoes/imp/story-song',
        area: 'echoes',
        pageType: 'song',
        metadata: { storyKey: 'imp-rain-sea', category: 'story' },
      }),
    ]);

    const row = await env.CONTENT_DB.prepare(
      "SELECT key_value, title FROM interlink_keys WHERE key_type = 'story' AND key_value = ?"
    )
      .bind('imp-rain-sea')
      .first<{ key_value: string; title: string | null }>();
    expect(row).toMatchObject({ key_value: 'imp-rain-sea', title: null });
  });

  it('匯入帶 entityKey 的頁面同樣建立殼列', async () => {
    await importPages([
      page({
        id: 'echoes/imp/entity-song',
        area: 'echoes',
        pageType: 'song',
        metadata: { entityKey: 'imp-entity-song' },
      }),
    ]);

    const row = await env.CONTENT_DB.prepare(
      "SELECT key_value, title FROM interlink_keys WHERE key_type = 'entity' AND key_value = ?"
    )
      .bind('imp-entity-song')
      .first<{ key_value: string; title: string | null }>();
    expect(row).toMatchObject({ key_value: 'imp-entity-song', title: null });
  });
});

/**
 * 前端 `collectEntityKeyIssues` 對這種情形會即時警告，但那是提示不是
 * 約束——`findKeyConflict` 以 excludePageId 排除整個當前頁，同一份
 * payload 內部的重複對它完全隱形，違規資料因此可以永久存活。
 */
describe('PUT — 同一次存檔內部的重複 key', () => {
  /** dossier：同一個 variant 底下塞兩個相同 entityKey 的條目 */
  function dossierContent(keys: string[]) {
    return [
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
                    {
                      label: 'Y',
                      entries: keys.map((entityKey, i) => ({
                        name: `條目${i}`,
                        entityKey,
                      })),
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
    ];
  }

  async function putConcepts(slug: string, keys: string[]) {
    return worker.fetch(
      request(`/api/content/concepts/${slug}`, {
        method: 'PUT',
        token: await getAdminToken(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '重複條目測試',
          metadata: { stack_style: 'dossier' },
          content: dossierContent(keys),
        }),
      }),
      env,
      ctx
    );
  }

  it('同一頁同 variant 出現兩個相同 entityKey → 409，且不落地', async () => {
    const res = await putConcepts('imp/dup-entries', [
      'imp-inline-dup',
      'imp-inline-dup',
    ]);
    expect(res.status).toBe(409);
    const json = (await res.json()) as {
      conflict?: { field: string; key: string };
    };
    expect(json.conflict).toMatchObject({
      field: 'entityKey',
      key: 'imp-inline-dup',
    });

    const row = await env.CONTENT_DB.prepare(
      'SELECT id FROM pages WHERE id = ?'
    )
      .bind('concepts/imp/dup-entries')
      .first();
    expect(row).toBeNull();
  });

  it('條目 key 各不相同時照常存檔', async () => {
    const res = await putConcepts('imp/ok-entries', ['imp-a', 'imp-b']);
    expect(res.status).toBe(201);
  });

  it('已存在的頁面再次送出重複 key 一樣被擋（排除自身不等於放行）', async () => {
    const res = await putConcepts('imp/ok-entries', ['imp-c', 'imp-c']);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/interlink/reindex — migration 0022 的資料補建', () => {
  it('直接寫進 D1 的既有錨點在 reindex 後查得到', async () => {
    // 模擬「migration 之前就存在的文章」：繞過 API 直接寫 pages
    await env.CONTENT_DB.prepare(
      `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth)
       VALUES (?, 'history', ?, ?, 0, ?, '{}', 'synced', 'section', 2)`
    )
      .bind(
        'history/legacy/ch-old',
        '沒有索引的舊文章',
        'legacy/ch-old',
        JSON.stringify(contentWithEntityMark('imp-legacy', '舊時代'))
      )
      .run();

    expect(await anchorsOf('entity', 'imp-legacy')).toHaveLength(0);

    const res = await worker.fetch(
      request('/api/interlink/reindex', {
        method: 'POST',
        token: await getAdminToken(),
      }),
      env,
      ctx
    );
    expect(res.status).toBe(200);

    expect(await anchorsOf('entity', 'imp-legacy')).toHaveLength(1);
  });

  /**
   * 殼列平常只在存檔路徑建立——遷移腳本直接改寫 metadata（例如
   * illustrationId → storyKey）產生的 key 因此永遠沒有殼列，管理 UI
   * 會找不到可 UPDATE 的列。
   */
  it('直接寫進 metadata 的 storyKey 在 reindex 後補上殼列', async () => {
    await env.CONTENT_DB.prepare(
      `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth)
       VALUES (?, 'visuals', ?, ?, 0, '[]', ?, 'synced', 'gallery', 3)`
    )
      .bind(
        'visuals/legacy/migrated-gal',
        '遷移過來的插圖',
        'legacy/migrated-gal',
        JSON.stringify({ storyKey: 'imp-migrated-story', images: [] })
      )
      .run();

    const before = await env.CONTENT_DB.prepare(
      "SELECT key_value FROM interlink_keys WHERE key_type = 'story' AND key_value = ?"
    )
      .bind('imp-migrated-story')
      .first();
    expect(before).toBeNull();

    await worker.fetch(
      request('/api/interlink/reindex', {
        method: 'POST',
        token: await getAdminToken(),
      }),
      env,
      ctx
    );

    const after = await env.CONTENT_DB.prepare(
      "SELECT key_value FROM interlink_keys WHERE key_type = 'story' AND key_value = ?"
    )
      .bind('imp-migrated-story')
      .first();
    expect(after).toBeTruthy();
  });

  it('重跑不會累積重複列（冪等）', async () => {
    await worker.fetch(
      request('/api/interlink/reindex', {
        method: 'POST',
        token: await getAdminToken(),
      }),
      env,
      ctx
    );
    expect(await anchorsOf('entity', 'imp-legacy')).toHaveLength(1);
  });

  it('未授權不得重建索引', async () => {
    const res = await worker.fetch(
      request('/api/interlink/reindex', { method: 'POST' }),
      env,
      ctx
    );
    expect(res.status).toBe(401);
  });
});
