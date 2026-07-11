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
        audioFile: 'audio/xavier-theme.mp3',
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
