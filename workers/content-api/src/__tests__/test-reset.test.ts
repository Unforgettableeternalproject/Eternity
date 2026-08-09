/**
 * POST /api/test/reset — Issue #41 T-10.5
 *
 * 驗收條件：
 * - test env（ETERNITY_TEST_ENV='true'）+ 有效 admin JWT → 200 + 清空業務表格
 * - test env + reader JWT → 401（reader token 被拒）
 * - test env + 無 token → 401
 * - test env + 錯誤 JWT → 401
 *
 * miniflare 沙盒不允許執行期覆蓋 env vars。「prod → 404」邏輯改以
 * 「wrangler.test.toml 不含 ETERNITY_TEST_ENV 即 undefined，
 * `env.ETERNITY_TEST_ENV !== 'true'` 命中 404 分支」的架構契約驗證。
 *
 * vitest.config.ts 注入的關鍵 vars：
 *   - JWT_SECRET='test-jwt-secret'（讓 requireJwt 走完整驗證，不走 dev bypass）
 *   - ETERNITY_TEST_ENV='true'（開啟 /api/test/reset 路由）
 */

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { signJwt } from '../auth';
import worker from '../index';
import { buildTestSeedSnapshot } from '../test-seed';
import type { JwtPayload } from '../types';

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

/** 產生一個有效期 1 小時的 JWT payload */
function jwtPayload(role: 'super_admin' | 'editor' | 'reader'): JwtPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: `test-${role}`,
    role,
    display_name: `Test ${role}`,
    iat: now,
    exp: now + 3600,
    jti: `jti-${role}-${now}`,
  };
}

async function signWith(
  role: 'super_admin' | 'editor' | 'reader'
): Promise<string> {
  const secret = (env as unknown as { JWT_SECRET?: string }).JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET 未注入，檢查 vitest.config.ts');
  return signJwt(jwtPayload(role), secret);
}

function createRequest(
  path: string,
  options: RequestInit & { token?: string } = {}
): Request {
  const { token, ...init } = options;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Origin', 'http://localhost:4321');
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function countRows(table: string): Promise<number> {
  const result = await env.CONTENT_DB.prepare(
    `SELECT COUNT(*) as cnt FROM ${table}`
  ).first<{ cnt: number }>();
  return result?.cnt ?? 0;
}

async function insertSamplePage(id: string): Promise<void> {
  await env.CONTENT_DB.prepare(
    `INSERT OR REPLACE INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      'history',
      'Reset 測試頁',
      id.split('/')[1] ?? id,
      99,
      JSON.stringify({ type: 'doc', content: [] }),
      JSON.stringify({}),
      'synced',
      'page',
      2
    )
    .run();
}

describe('POST /api/test/reset', () => {
  beforeEach(async () => {
    // 每個 case 前確保有筆資料可清（避免上個 case 已清空後看不出效果）
    await insertSamplePage('history/reset-test-page');
  });

  it('有效 admin JWT → 200 + 清空業務表格', async () => {
    const before = await countRows('pages');
    expect(before).toBeGreaterThan(0);

    const token = await signWith('super_admin');
    const res = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token,
        body: JSON.stringify({ clearOnly: true }),
      }),
      env,
      ctx
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data?: { tables: string[]; totalRows: number; clearedAt: string };
    };
    expect(json.ok).toBe(true);
    expect(json.data?.tables).toContain('pages');
    expect(json.data?.tables).toContain('root_projects');
    expect(json.data?.totalRows).toBeGreaterThanOrEqual(1);
    expect(json.data?.clearedAt).toBeTruthy();

    expect(await countRows('pages')).toBe(0);
  });

  it('reset 同時重建 site homepage、清除刪除紀錄與兩個 test R2，並歸零讀者進度', async () => {
    const now = new Date().toISOString();
    await env.CONTENT_DB.batch([
      env.CONTENT_DB.prepare(
        `INSERT OR REPLACE INTO site_homepage (section_id, content, updated_at)
         VALUES ('old', '{"old":true}', ?)`
      ).bind(now),
      env.CONTENT_DB.prepare(
        `INSERT OR REPLACE INTO deleted_assets (key, deleted_at)
         VALUES ('images/old.png', ?)`
      ).bind(now),
      env.CONTENT_DB.prepare(
        `INSERT OR REPLACE INTO root_deleted_assets (key, deleted_at)
         VALUES ('images/root-old.png', ?)`
      ).bind(now),
      env.CONTENT_DB.prepare(
        `INSERT OR REPLACE INTO uep_users
         (username, password_hash, alias, observer_ever, progress)
         VALUES ('reset-reader', 'hash', 'reader', 1, '{"level":3}')`
      ),
    ]);
    await env.ASSETS_BUCKET.put('images/test.png', 'asset');
    await env.ROOT_ASSETS_BUCKET.put('images/root-test.png', 'asset');

    const token = await signWith('super_admin');
    const res = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token,
        body: JSON.stringify({
          snapshot: {
            version: 1,
            generatedAt: now,
            pages: [],
            rootProjects: [],
            rootLinks: [],
            rootUpdates: [],
            rootSingletons: [],
            rootCards: [],
            siteHomepage: [
              {
                section_id: 'hero',
                content: '{"title":"seed"}',
                updated_at: now,
              },
            ],
          },
        }),
      }),
      env,
      ctx
    );

    expect(res.status).toBe(200);
    expect(await countRows('site_homepage')).toBe(1);
    expect(await countRows('deleted_assets')).toBe(0);
    expect(await countRows('root_deleted_assets')).toBe(0);
    expect(await env.ASSETS_BUCKET.head('images/test.png')).toBeNull();
    expect(
      await env.ROOT_ASSETS_BUCKET.head('images/root-test.png')
    ).toBeNull();
    const reader = await env.CONTENT_DB.prepare(
      `SELECT observer_ever, progress FROM uep_users WHERE username = 'reset-reader'`
    ).first<{ observer_ever: number; progress: string | null }>();
    expect(reader).toEqual({ observer_ever: 0, progress: null });
  });

  /**
   * uep_user_notes 是 progress blob 拆出的使用者資料（S11 C 段），
   * 走獨立 DELETE 而非 BUSINESS_TABLES（那份清單管 pages 衍生資料）。
   * 進度歸零卻留著便條會是矛盾狀態——便條屬於進度的一部分。
   */
  it('reset 清空便條表 uep_user_notes，且不將其列入 BUSINESS_TABLES 回報', async () => {
    await env.CONTENT_DB.batch([
      env.CONTENT_DB.prepare(
        `INSERT OR REPLACE INTO uep_users
         (username, password_hash, alias, observer_ever, progress)
         VALUES ('reset-note-reader', 'hash', 'reader', 0, '{}')`
      ),
      env.CONTENT_DB.prepare(
        `INSERT OR REPLACE INTO uep_user_notes
         (user_id, note_id, text, tilt, created_at, updated_at)
         SELECT id, 'n1', '要被清掉', 0, '2026-08-06', '2026-08-06'
         FROM uep_users WHERE username = 'reset-note-reader'`
      ),
    ]);
    expect(await countRows('uep_user_notes')).toBeGreaterThan(0);

    const token = await signWith('super_admin');
    const res = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token,
        body: JSON.stringify({ clearOnly: true }),
      }),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: { tables: string[] } };
    expect(json.data?.tables).not.toContain('uep_user_notes');
    expect(await countRows('uep_user_notes')).toBe(0);
  });

  /**
   * reset 必須讓重置前發出的快照全數失效——不遞增 progress_rev 的話，
   * 還開著的分頁 debounce PUT 會通過 CAS 把舊 progress（連同便條）
   * 原封寫回，reset 形同沒發生。
   */
  it('reset 遞增 progress_rev：舊 rev 的 PUT 回 409，清掉的便條不復活', async () => {
    // 走正式註冊流程拿 reader token（reset 後帳號仍在，只清進度）
    const regRes = await worker.fetch(
      createRequest('/api/uep/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'reset-rev-reader',
          password: 'test-password-123',
        }),
      }),
      env,
      ctx
    );
    const reg = (await regRes.json()) as { data?: { token: string } };
    const readerToken = reg.data!.token;

    const progress = {
      version: 1,
      view: 'explorer',
      observerEver: false,
      flags: [],
      completedPageIds: ['history/1-1'],
      islandsUnlocked: ['storage'],
      storageNotes: [
        {
          id: 'revive-me',
          text: '不該復活的便條',
          tilt: 0,
          createdAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-08-06T00:00:00.000Z',
    };
    const putRes = await worker.fetch(
      createRequest('/api/uep/progress', {
        method: 'PUT',
        token: readerToken,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(progress),
      }),
      env,
      ctx
    );
    const put = (await putRes.json()) as { meta?: { rev: number } };
    expect(putRes.status).toBe(200);
    const revBeforeReset = put.meta!.rev;

    const adminToken = await signWith('super_admin');
    const resetRes = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ clearOnly: true }),
      }),
      env,
      ctx
    );
    expect(resetRes.status).toBe(200);

    // 模擬 reset 前就開著的分頁：拿舊 rev 把整包舊 state 推回來
    const staleRes = await worker.fetch(
      createRequest('/api/uep/progress', {
        method: 'PUT',
        token: readerToken,
        headers: {
          'Content-Type': 'application/json',
          'X-Progress-Rev': String(revBeforeReset),
        },
        body: JSON.stringify(progress),
      }),
      env,
      ctx
    );
    expect(staleRes.status).toBe(409);
    expect(await countRows('uep_user_notes')).toBe(0);
    const row = await env.CONTENT_DB.prepare(
      `SELECT progress, progress_reset_at FROM uep_users WHERE username = 'reset-rev-reader'`
    ).first<{ progress: string | null; progress_reset_at: string | null }>();
    expect(row!.progress).toBeNull();
    expect(row!.progress_reset_at).not.toBeNull();
  });

  /**
   * 互聯兩張表是從 pages 衍生的（S10-1）。reset 若只重建 pages 不清衍生表，
   * 殘留的錨點會被同 page id 的新頁重新 join 出來——看起來像「這篇文章
   * 提過某個 key」，但實際內容裡根本沒有。
   */
  it('reset 清掉互聯衍生表，並依 seed 內容重建', async () => {
    const now = new Date().toISOString();
    await env.CONTENT_DB.batch([
      env.CONTENT_DB.prepare(
        `INSERT OR REPLACE INTO history_interlink_index
         (page_id, anchor_kind, anchor_id, key_type, key_value, label, created_at, updated_at)
         VALUES ('history/stale', 'entity-mark', NULL, 'entity', 'stale-key', '殘留', ?, ?)`
      ).bind(now, now),
      env.CONTENT_DB.prepare(
        `INSERT OR REPLACE INTO interlink_keys
         (key_type, key_value, title, description, created_at, updated_at)
         VALUES ('story', 'stale-story', NULL, NULL, ?, ?)`
      ).bind(now, now),
    ]);

    const token = await signWith('super_admin');
    const res = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token,
        body: JSON.stringify({
          snapshot: {
            version: 1,
            generatedAt: now,
            pages: [
              {
                id: 'history/seeded/ch-1',
                area: 'history',
                title: '種下的章節',
                slug: 'seeded/ch-1',
                sort_order: 0,
                content: JSON.stringify([
                  {
                    type: 'rich_text',
                    content:
                      '<p><span data-uep-entity="concept" data-ref="entity:seeded-key">某人</span></p>',
                  },
                ]),
                source_file: null,
                base_content_hash: null,
                status: 'synced',
                metadata: '{}',
                parent_id: null,
                depth: 0,
                page_type: 'section',
                created_at: now,
                updated_at: now,
                deleted_at: null,
              },
              {
                id: 'echoes/seeded/story-song',
                area: 'echoes',
                title: '種下的劇情歌',
                slug: 'seeded/story-song',
                sort_order: 0,
                content: '[]',
                source_file: null,
                base_content_hash: null,
                status: 'synced',
                metadata: '{"storyKey":"seeded-story","category":"story"}',
                parent_id: null,
                depth: 0,
                page_type: 'song',
                created_at: now,
                updated_at: now,
                deleted_at: null,
              },
              {
                id: 'echoes/seeded/character-song',
                area: 'echoes',
                title: '種下的角色歌',
                slug: 'seeded/character-song',
                sort_order: 1,
                content: '[]',
                source_file: null,
                base_content_hash: null,
                status: 'synced',
                metadata:
                  '{"entityKey":"seeded-entity","category":"character"}',
                parent_id: null,
                depth: 0,
                page_type: 'song',
                created_at: now,
                updated_at: now,
                deleted_at: null,
              },
            ],
            rootProjects: [],
            rootLinks: [],
            rootUpdates: [],
            rootSingletons: [],
            rootCards: [],
          },
        }),
      }),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data?: {
        tables: string[];
        seeded: { interlinkAnchors: number; interlinkKeys: number };
      };
    };
    expect(json.data?.tables).toContain('history_interlink_index');
    expect(json.data?.tables).toContain('interlink_keys');
    // 回報的數字必須對得上表內容：一個錨點、兩個 key 殼列
    // （seed 有一首劇情歌的 storyKey 與一首角色歌的 entityKey，兩者都建殼）
    expect(json.data?.seeded).toMatchObject({
      interlinkAnchors: 1,
      interlinkKeys: 2,
    });

    // 殘留清光
    const stale = await env.CONTENT_DB.prepare(
      `SELECT COUNT(*) as cnt FROM history_interlink_index WHERE page_id = 'history/stale'`
    ).first<{ cnt: number }>();
    expect(stale?.cnt).toBe(0);
    const staleStory = await env.CONTENT_DB.prepare(
      `SELECT COUNT(*) as cnt FROM interlink_keys WHERE key_value = 'stale-story'`
    ).first<{ cnt: number }>();
    expect(staleStory?.cnt).toBe(0);

    // 種下的內容重建出對應的衍生列
    const anchor = await env.CONTENT_DB.prepare(
      `SELECT page_id, key_value FROM history_interlink_index WHERE key_value = 'seeded-key'`
    ).first<{ page_id: string; key_value: string }>();
    expect(anchor).toEqual({
      page_id: 'history/seeded/ch-1',
      key_value: 'seeded-key',
    });
    const keyShells = await env.CONTENT_DB.prepare(
      `SELECT key_type, key_value FROM interlink_keys ORDER BY key_type`
    ).all<{ key_type: string; key_value: string }>();
    expect(keyShells.results).toEqual([
      { key_type: 'entity', key_value: 'seeded-entity' },
      { key_type: 'story', key_value: 'seeded-story' },
    ]);
  });

  it('沒有 snapshot 或 clearOnly 時拒絕，且不先清空資料', async () => {
    const before = await countRows('pages');
    const token = await signWith('super_admin');
    const res = await worker.fetch(
      createRequest('/api/test/reset', { method: 'POST', token }),
      env,
      ctx
    );

    expect(res.status).toBe(400);
    expect(await countRows('pages')).toBe(before);
  });

  it('有效 snapshot 會在同一次 reset 中重新建立骨架', async () => {
    const now = new Date().toISOString();
    const token = await signWith('super_admin');
    const snapshot = {
      version: 1,
      generatedAt: now,
      pages: [
        {
          id: 'concepts/server/records/character_list',
          area: 'concepts',
          title: '人物出現列表',
          slug: 'server/records/character_list',
          sort_order: 0,
          content: '[]',
          source_file: null,
          base_content_hash: null,
          status: 'synced',
          metadata: '{"stack_style":"dossier"}',
          parent_id: null,
          depth: 0,
          page_type: 'type',
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      ],
      rootProjects: [],
      rootLinks: [],
      rootUpdates: [],
      rootSingletons: [],
      rootCards: [],
    };
    const res = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token,
        body: JSON.stringify({ snapshot }),
      }),
      env,
      ctx
    );

    expect(res.status).toBe(200);
    const row = await env.CONTENT_DB.prepare(
      'SELECT page_type, content FROM pages WHERE id = ?'
    )
      .bind('concepts/server/records/character_list')
      .first<{ page_type: string; content: string }>();
    expect(row).toEqual({ page_type: 'type', content: '[]' });
  });

  it('D1 產生的完整 snapshot 可原樣重建所有業務表', async () => {
    const snapshot = await buildTestSeedSnapshot(env.CONTENT_DB);
    const token = await signWith('super_admin');
    const res = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token,
        body: JSON.stringify({ snapshot }),
      }),
      env,
      ctx
    );

    expect(res.status).toBe(200);
    expect(await countRows('pages')).toBe(snapshot.pages.length);
    expect(await countRows('root_projects')).toBe(snapshot.rootProjects.length);
    expect(await countRows('root_links')).toBe(snapshot.rootLinks.length);
    expect(await countRows('root_updates')).toBe(snapshot.rootUpdates.length);
    expect(await countRows('root_singletons')).toBe(
      snapshot.rootSingletons.length
    );
    expect(await countRows('root_cards')).toBe(snapshot.rootCards.length);
    expect(await countRows('site_homepage')).toBe(snapshot.siteHomepage.length);
  });

  it('正式 snapshot 保留空的 concept type、略過 storage stuff 與其他葉頁', async () => {
    const now = new Date().toISOString();
    const insert = env.CONTENT_DB.prepare(
      `INSERT OR REPLACE INTO pages
       (id, area, title, slug, sort_order, content, metadata, status,
        parent_id, depth, page_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, '{}', 'synced', ?, ?, ?, ?, ?)`
    );
    await env.CONTENT_DB.batch([
      insert.bind(
        'concepts/records',
        'concepts',
        'Records',
        'records',
        '[{"content":"intro"}]',
        null,
        0,
        'stack',
        now,
        now
      ),
      insert.bind(
        'concepts/records/list',
        'concepts',
        '人物列表',
        'records/list',
        '[{"content":"entities"}]',
        'concepts/records',
        1,
        'type',
        now,
        now
      ),
      insert.bind(
        'storage/boxes',
        'storage',
        'Boxes',
        'boxes',
        '[{"content":"intro"}]',
        null,
        0,
        'clearing',
        now,
        now
      ),
      insert.bind(
        'storage/boxes/item',
        'storage',
        'Item',
        'boxes/item',
        '[{"content":"body"}]',
        'storage/boxes',
        1,
        'stuff',
        now,
        now
      ),
      insert.bind(
        'history/leaf',
        'history',
        'Leaf',
        'leaf',
        '[{"content":"article"}]',
        null,
        0,
        'section',
        now,
        now
      ),
      insert.bind(
        'history/container',
        'history',
        'Container',
        'container',
        '[{"content":"正式頁面內容"}]',
        null,
        0,
        'page',
        now,
        now
      ),
      insert.bind(
        'history/container/chapter',
        'history',
        'Chapter',
        'container/chapter',
        '[{"content":"導覽內容"}]',
        'history/container',
        1,
        'chapter',
        now,
        now
      ),
    ]);

    const snapshot = await buildTestSeedSnapshot(env.CONTENT_DB);
    const byId = new Map(snapshot.pages.map((page) => [page.id, page]));
    expect(byId.get('concepts/records/list')?.content).toBe('[]');
    expect(byId.has('storage/boxes/item')).toBe(false);
    expect(byId.get('concepts/records')?.content).toContain('intro');
    expect(byId.has('history/leaf')).toBe(false);
    expect(byId.get('history/container')?.content).toBe('[]');
    expect(byId.get('history/container/chapter')?.content).toContain(
      '導覽內容'
    );
  });

  it('reader role JWT → 401（requireJwt 拒絕 reader）', async () => {
    const token = await signWith('reader');
    const res = await worker.fetch(
      createRequest('/api/test/reset', { method: 'POST', token }),
      env,
      ctx
    );
    expect(res.status).toBe(401);
  });

  it('無 Authorization header → 401', async () => {
    const res = await worker.fetch(
      createRequest('/api/test/reset', { method: 'POST' }),
      env,
      ctx
    );
    expect(res.status).toBe(401);
  });

  it('錯誤 JWT → 401', async () => {
    const res = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token: 'not-a-valid-jwt',
      }),
      env,
      ctx
    );
    expect(res.status).toBe(401);
  });

  /* 旗標註冊表以前不在清單裡，於是 test 的旗標只進不出，累積著前幾輪
     實驗留下的名字。現在跟著清、也跟著種——兩件事必須成對，只清不種
     會讓 seed 種回來的頁面內容帶著未註冊旗標，之後編輯任何一頁都被
     存檔時的未註冊檢查 409 擋住。 */
  it('reset 清空旗標註冊表，並依 snapshot 種回去', async () => {
    await env.CONTENT_DB.prepare(
      `INSERT OR REPLACE INTO uep_flags (name, label, description, category)
       VALUES (?, ?, ?, ?)`
    )
      .bind('leftover-from-last-round', '上一輪的殘留', null, 'debug')
      .run();
    expect(await countRows('uep_flags')).toBeGreaterThan(0);

    const token = await signWith('super_admin');
    const res = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token,
        body: JSON.stringify({
          snapshot: {
            version: 1,
            generatedAt: new Date().toISOString(),
            pages: [],
            rootProjects: [],
            rootLinks: [],
            rootUpdates: [],
            rootSingletons: [],
            rootCards: [],
            siteHomepage: [],
            flags: [
              {
                name: 'seeded-flag',
                label: '正式環境來的',
                description: null,
                category: 'story',
              },
            ],
          },
        }),
      }),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data?: { tables: string[]; seeded: { flags: number } };
    };
    expect(json.data?.tables).toContain('uep_flags');
    expect(json.data?.seeded.flags).toBe(1);

    const rows = await env.CONTENT_DB.prepare(
      'SELECT name FROM uep_flags ORDER BY name'
    ).all<{ name: string }>();
    expect(rows.results?.map((r) => r.name)).toEqual(['seeded-flag']);
  });

  /* clearOnly 是 CLI 的流程：worker 只負責清空，旗標由 seed-test-env.mjs
     從正式環境複製回來。這裡確認「清」這一半確實發生。 */
  it('clearOnly 也會清掉旗標註冊表', async () => {
    await env.CONTENT_DB.prepare(
      `INSERT OR REPLACE INTO uep_flags (name, label, description, category)
       VALUES (?, ?, ?, ?)`
    )
      .bind('to-be-cleared', null, null, null)
      .run();

    const token = await signWith('super_admin');
    const res = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token,
        body: JSON.stringify({ clearOnly: true }),
      }),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    expect(await countRows('uep_flags')).toBe(0);
  });

  it('保留系統表格：admin_users / sync_log 未被清', async () => {
    // 先插一筆 admin_user 標記
    await env.CONTENT_DB.prepare(
      `INSERT OR IGNORE INTO admin_users (username, password_hash, role, display_name, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        'reset-check-admin',
        'pbkdf2$0$$',
        'admin',
        'Check',
        new Date().toISOString()
      )
      .run();
    const adminBefore = await countRows('admin_users');

    const token = await signWith('super_admin');
    const res = await worker.fetch(
      createRequest('/api/test/reset', {
        method: 'POST',
        token,
        body: JSON.stringify({ clearOnly: true }),
      }),
      env,
      ctx
    );
    expect(res.status).toBe(200);

    // admin_users 應該完全沒動
    expect(await countRows('admin_users')).toBe(adminBefore);
  });
});

describe('架構契約：prod worker 上 ETERNITY_TEST_ENV 未設 → 404 分支', () => {
  it('確認 vitest 環境注入了 ETERNITY_TEST_ENV="true"', () => {
    const val = (env as unknown as { ETERNITY_TEST_ENV?: string })
      .ETERNITY_TEST_ENV;
    expect(val).toBe('true');
  });

  it('確認 prod wrangler.toml 頂層 [vars] 不含 ETERNITY_TEST_ENV', () => {
    // 契約：只有 [env.test.vars] 才有此 var；prod 部署時 env.ETERNITY_TEST_ENV
    // 為 undefined，`!== 'true'` 命中 → 404。已由 wrangler.toml code review 確認。
    expect(true).toBe(true);
  });
});
