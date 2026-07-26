import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * Echoes entity↔曲目反查端點測試（Epic 2 S8 B-5）
 *
 * 驗證：
 * 1. entityKey 命中 → found + 摘要（audioFile 裸 key / songType=category /
 *    spoilerRevisions / clusterId 路徑推導）
 * 2. 未命中 / 軟刪除 / 非 song 頁 → found:false
 * 3. 缺 key 參數 → 400
 * 4. 路由不被 contentMatch regex 吸走（獨立前綴 /api/echoes/）
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

function createRequest(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Origin', 'http://localhost:4321');
  return new Request(`http://localhost${path}`, { ...options, headers });
}

async function insertPage(
  id: string,
  title: string,
  pageType: string,
  metadata: Record<string, unknown>,
  deletedAt: string | null = null
) {
  await env.CONTENT_DB.prepare(
    `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
     VALUES (?, 'echoes', ?, ?, 1, '[]', ?, 'synced', ?, 3, ?)`
  )
    .bind(
      id,
      title,
      id.slice('echoes/'.length),
      JSON.stringify(metadata),
      pageType,
      deletedAt
    )
    .run();
}

describe('GET /api/echoes/entity-song', () => {
  beforeAll(async () => {
    // 正常曲目：entityKey + 音檔 + spoiler 降級鏈
    await insertPage(
      'echoes/characters/heroes/esong-xavier',
      'X 的主題曲',
      'song',
      {
        entityKey: 'esong-xavier',
        category: 'character',
        subtitle: '被雨記住的人',
        audioFile: 'audio/xavier-theme.mp3',
        audioMeta: { duration: 245 },
        spoilerLevel: 3,
        gate: { requiresFlags: ['met:esong-xavier'] },
        spoilerRevisions: [
          { targetLevel: 2, gate: { requiresFlags: ['esong-xavier:01'] } },
        ],
      }
    );
    // 軟刪除的曲目：不可命中
    await insertPage(
      'echoes/characters/heroes/esong-deleted',
      '被刪的曲',
      'song',
      { entityKey: 'esong-deleted', category: 'character' },
      '2026-07-11T00:00:00Z'
    );
    // 非 song 頁掛了同 key：不可命中
    await insertPage(
      'echoes/characters/esong-subcat',
      '子分類',
      'subcategory',
      {
        entityKey: 'esong-subcat-key',
      }
    );
    // 無音檔、無降級鏈的極簡曲目
    await insertPage('echoes/special/esong-minimal', '極簡曲', 'song', {
      entityKey: 'esong-minimal',
    });
  });

  it('entityKey 命中 → found + 完整摘要', async () => {
    const res = await worker.fetch(
      createRequest('/api/echoes/entity-song?key=esong-xavier'),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { found: boolean; song?: Record<string, unknown> };
    };
    expect(json.ok).toBe(true);
    expect(json.data.found).toBe(true);
    expect(json.data.song).toMatchObject({
      id: 'echoes/characters/heroes/esong-xavier',
      title: 'X 的主題曲',
      audioFile: 'audio/xavier-theme.mp3', // 裸 R2 key，不含 API base
      entityKey: 'esong-xavier',
      songType: 'character',
      subtitle: '被雨記住的人',
      duration: 245,
      spoilerLevel: 3,
      gate: { requiresFlags: ['met:esong-xavier'] },
      locked: false,
      clusterId: 'characters',
    });
    expect(json.data.song?.spoilerRevisions).toEqual([
      { targetLevel: 2, gate: { requiresFlags: ['esong-xavier:01'] } },
    ]);
  });

  it('極簡曲目：無音檔/降級鏈 → audioFile null、不帶 spoilerRevisions', async () => {
    const res = await worker.fetch(
      createRequest('/api/echoes/entity-song?key=esong-minimal'),
      env,
      ctx
    );
    const json = (await res.json()) as {
      data: { found: boolean; song?: Record<string, unknown> };
    };
    expect(json.data.found).toBe(true);
    expect(json.data.song?.audioFile).toBeNull();
    expect(json.data.song?.songType).toBeNull();
    expect(json.data.song).not.toHaveProperty('spoilerRevisions');
    expect(json.data.song?.clusterId).toBe('special');
  });

  it('未命中 → found:false', async () => {
    const res = await worker.fetch(
      createRequest('/api/echoes/entity-song?key=esong-nonexistent'),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { found: boolean } };
    expect(json.data).toEqual({ found: false });
  });

  it('軟刪除曲目不可命中', async () => {
    const res = await worker.fetch(
      createRequest('/api/echoes/entity-song?key=esong-deleted'),
      env,
      ctx
    );
    const json = (await res.json()) as { data: { found: boolean } };
    expect(json.data.found).toBe(false);
  });

  it('非 song 頁掛同 key 不可命中', async () => {
    const res = await worker.fetch(
      createRequest('/api/echoes/entity-song?key=esong-subcat-key'),
      env,
      ctx
    );
    const json = (await res.json()) as { data: { found: boolean } };
    expect(json.data.found).toBe(false);
  });

  it('缺 key 參數 → 400', async () => {
    const res = await worker.fetch(
      createRequest('/api/echoes/entity-song'),
      env,
      ctx
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/echoes/song（by-id 快照刷新）', () => {
  beforeAll(async () => {
    // 隱藏的劇情歌（未掛 entityKey）：列表隱藏是常態，by-id 必須命中
    await insertPage(
      'echoes/stories/arc/esong-hidden-story',
      '隱藏的劇情曲',
      'song',
      {
        category: 'story',
        hidden: true,
        audioFile: 'audio/hidden-story.mp3',
      }
    );
  });

  it('id 命中 → found + 現行 audioFile／spoiler 摘要', async () => {
    const res = await worker.fetch(
      createRequest(
        `/api/echoes/song?id=${encodeURIComponent('echoes/characters/heroes/esong-xavier')}`
      ),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { found: boolean; song?: Record<string, unknown> };
    };
    expect(json.ok).toBe(true);
    expect(json.data.found).toBe(true);
    expect(json.data.song).toMatchObject({
      id: 'echoes/characters/heroes/esong-xavier',
      audioFile: 'audio/xavier-theme.mp3',
      entityKey: 'esong-xavier',
      spoilerLevel: 3,
      clusterId: 'characters',
    });
  });

  it('hidden 歌曲仍可命中，未掛 entityKey 回 null（劇情 spot 引用）', async () => {
    const res = await worker.fetch(
      createRequest(
        `/api/echoes/song?id=${encodeURIComponent('echoes/stories/arc/esong-hidden-story')}`
      ),
      env,
      ctx
    );
    const json = (await res.json()) as {
      data: { found: boolean; song?: Record<string, unknown> };
    };
    expect(json.data.found).toBe(true);
    expect(json.data.song).toMatchObject({
      audioFile: 'audio/hidden-story.mp3',
      entityKey: null,
      songType: 'story',
      clusterId: 'stories',
    });
  });

  it('軟刪除曲目 → found:false', async () => {
    const res = await worker.fetch(
      createRequest(
        `/api/echoes/song?id=${encodeURIComponent('echoes/characters/heroes/esong-deleted')}`
      ),
      env,
      ctx
    );
    const json = (await res.json()) as { data: { found: boolean } };
    expect(json.data.found).toBe(false);
  });

  it('未知 id → found:false', async () => {
    const res = await worker.fetch(
      createRequest('/api/echoes/song?id=echoes/nope'),
      env,
      ctx
    );
    const json = (await res.json()) as { data: { found: boolean } };
    expect(json.data.found).toBe(false);
  });

  it('缺 id 參數 → 400', async () => {
    const res = await worker.fetch(createRequest('/api/echoes/song'), env, ctx);
    expect(res.status).toBe(400);
  });
});

describe('entity-song：storyKey 反查與壞 JSON 容錯（S10-1）', () => {
  beforeAll(async () => {
    // 劇情歌掛 storyKey（S10-1 第二套命名空間）
    await insertPage('echoes/stories/arc/esong-story', '雨海終曲', 'song', {
      storyKey: 'rain-sea-finale',
      category: 'story',
      audioFile: 'audio/rain-sea.mp3',
    });
    // metadata 是非法 JSON：SQL 端若用 json_extract 過濾會炸掉整條 SELECT
    await env.CONTENT_DB.prepare(
      `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
       VALUES (?, 'echoes', ?, ?, 1, '[]', ?, 'synced', 'song', 3, NULL)`
    )
      .bind(
        'echoes/special/esong-broken',
        '壞掉的 metadata',
        'special/esong-broken',
        '{ this is not valid json'
      )
      .run();
  });

  it('storyKey 命中 → found + storyKey 欄位', async () => {
    const res = await worker.fetch(
      createRequest('/api/echoes/entity-song?key=rain-sea-finale'),
      env,
      ctx
    );
    const json = (await res.json()) as {
      data: { found: boolean; song?: Record<string, unknown> };
    };
    expect(json.data.found).toBe(true);
    expect(json.data.song).toMatchObject({
      id: 'echoes/stories/arc/esong-story',
      storyKey: 'rain-sea-finale',
      entityKey: null,
      songType: 'story',
    });
  });

  it('未掛 storyKey 的歌曲 storyKey 回 null', async () => {
    const res = await worker.fetch(
      createRequest('/api/echoes/entity-song?key=esong-xavier'),
      env,
      ctx
    );
    const json = (await res.json()) as {
      data: { song?: Record<string, unknown> };
    };
    expect(json.data.song?.storyKey).toBeNull();
  });

  it('壞 JSON 的頁面不影響其餘列的反查', async () => {
    // entityKey 與 storyKey 兩條路徑都要能跨過壞資料
    const byEntity = await worker.fetch(
      createRequest('/api/echoes/entity-song?key=esong-xavier'),
      env,
      ctx
    );
    expect(byEntity.status).toBe(200);
    expect(
      ((await byEntity.json()) as { data: { found: boolean } }).data.found
    ).toBe(true);

    const byStory = await worker.fetch(
      createRequest('/api/echoes/entity-song?key=rain-sea-finale'),
      env,
      ctx
    );
    expect(byStory.status).toBe(200);
    expect(
      ((await byStory.json()) as { data: { found: boolean } }).data.found
    ).toBe(true);
  });
});
