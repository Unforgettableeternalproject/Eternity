import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * Visuals gallery 反查端點測試（Epic 2 S8 下半場 V-A.13）
 *
 * 驗證：
 * 1. entityKey 命中 → found + 摘要（images 裸 key / 三態欄位 /
 *    sortOrder 升冪 / divisionId 路徑推導）
 * 2. 舊自由文字 gate 不回傳為條件（靜默失效定案）
 * 3. by-id / by-illustration 反查（hidden 仍命中——clue 明確引用）
 * 4. 未命中 / 軟刪除 / 非 gallery 頁 → found:false；缺參數 → 400
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
     VALUES (?, 'visuals', ?, ?, 1, '[]', ?, 'synced', ?, 3, ?)`
  )
    .bind(
      id,
      title,
      id.slice('visuals/'.length),
      JSON.stringify(metadata),
      pageType,
      deletedAt
    )
    .run();
}

describe('GET /api/visuals/entity-gallery', () => {
  beforeAll(async () => {
    // 陳列走廊 gallery：entityKey + 三態圖片（sortOrder 亂序驗證後端排序）
    await insertPage('visuals/profiles/vgal-xavier', 'X 的肖像集', 'gallery', {
      entityKey: 'vgal-xavier',
      gate: { requiresFlags: ['met:vgal-xavier'] },
      spoilerLevel: 1,
      images: [
        {
          id: 'img-b',
          file: 'images/xavier-2.png',
          caption: '後期立繪',
          sortOrder: 1,
          initialState: 'locked',
          lockGate: { requiresFlags: ['completed:history/ch3'] },
          partialGate: { pristineOnly: true },
        },
        {
          id: 'img-a',
          file: 'images/xavier-1.png',
          caption: '初登場',
          sortOrder: 0,
        },
        { id: 'img-bad', caption: '沒檔案的壞資料', sortOrder: 2 },
      ],
    });
    // 舊自由文字 gate：不可回傳為條件
    await insertPage('visuals/profiles/vgal-legacy', '舊資料畫廊', 'gallery', {
      entityKey: 'vgal-legacy',
      gate: '讀完第一章解鎖',
      images: [],
    });
    // 軟刪除：不可命中
    await insertPage(
      'visuals/profiles/vgal-deleted',
      '被刪畫廊',
      'gallery',
      { entityKey: 'vgal-deleted' },
      '2026-07-19T00:00:00Z'
    );
    // 非 gallery 頁掛同 key：不可命中
    await insertPage('visuals/profiles/vgal-subcat', '子分類', 'subcategory', {
      entityKey: 'vgal-subcat-key',
    });
  });

  it('entityKey 命中 → found + 完整摘要（images 依 sortOrder 升冪、壞項目剔除）', async () => {
    const res = await worker.fetch(
      createRequest('/api/visuals/entity-gallery?key=vgal-xavier'),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { found: boolean; gallery?: Record<string, unknown> };
    };
    expect(json.ok).toBe(true);
    expect(json.data.found).toBe(true);
    expect(json.data.gallery).toMatchObject({
      id: 'visuals/profiles/vgal-xavier',
      title: 'X 的肖像集',
      entityKey: 'vgal-xavier',
      illustrationId: null,
      divisionId: 'profiles',
      gate: { requiresFlags: ['met:vgal-xavier'] },
      locked: false,
      spoilerLevel: 1,
    });
    // 後端排序：sortOrder 0 在前；缺 file 的壞項目剔除
    expect(json.data.gallery?.images).toEqual([
      {
        id: 'img-a',
        file: 'images/xavier-1.png', // 裸 R2 key，不含 API base
        caption: '初登場',
        sortOrder: 0,
      },
      {
        id: 'img-b',
        file: 'images/xavier-2.png',
        caption: '後期立繪',
        sortOrder: 1,
        initialState: 'locked',
        lockGate: { requiresFlags: ['completed:history/ch3'] },
        partialGate: { pristineOnly: true },
      },
    ]);
  });

  it('舊自由文字 gate → 不帶 gate 欄位（靜默失效）', async () => {
    const res = await worker.fetch(
      createRequest('/api/visuals/entity-gallery?key=vgal-legacy'),
      env,
      ctx
    );
    const json = (await res.json()) as {
      data: { found: boolean; gallery?: Record<string, unknown> };
    };
    expect(json.data.found).toBe(true);
    expect(json.data.gallery).not.toHaveProperty('gate');
    expect(json.data.gallery?.images).toEqual([]);
  });

  it('未命中 → found:false', async () => {
    const res = await worker.fetch(
      createRequest('/api/visuals/entity-gallery?key=vgal-nonexistent'),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { found: boolean } };
    expect(json.data).toEqual({ found: false });
  });

  it('軟刪除 gallery 不可命中', async () => {
    const res = await worker.fetch(
      createRequest('/api/visuals/entity-gallery?key=vgal-deleted'),
      env,
      ctx
    );
    const json = (await res.json()) as { data: { found: boolean } };
    expect(json.data.found).toBe(false);
  });

  it('非 gallery 頁掛同 key 不可命中', async () => {
    const res = await worker.fetch(
      createRequest('/api/visuals/entity-gallery?key=vgal-subcat-key'),
      env,
      ctx
    );
    const json = (await res.json()) as { data: { found: boolean } };
    expect(json.data.found).toBe(false);
  });

  it('缺 key 參數 → 400', async () => {
    const res = await worker.fetch(
      createRequest('/api/visuals/entity-gallery'),
      env,
      ctx
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/visuals/gallery（by-id / by-illustration 快照刷新）', () => {
  beforeAll(async () => {
    // 鑲框室隱藏插圖：插圖 ID 引用，hidden 仍須命中
    await insertPage(
      'visuals/illustrations/vgal-hidden-scene',
      '隱藏的場景插圖',
      'gallery',
      {
        illustrationId: 'scene-rainfall',
        hidden: true,
        images: [
          {
            id: 'img-s',
            file: 'images/rainfall.png',
            caption: '',
            sortOrder: 0,
          },
        ],
      }
    );
  });

  it('by-id 命中 → found + 現行摘要', async () => {
    const res = await worker.fetch(
      createRequest(
        `/api/visuals/gallery?id=${encodeURIComponent('visuals/profiles/vgal-xavier')}`
      ),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { found: boolean; gallery?: Record<string, unknown> };
    };
    expect(json.ok).toBe(true);
    expect(json.data.found).toBe(true);
    expect(json.data.gallery).toMatchObject({
      id: 'visuals/profiles/vgal-xavier',
      entityKey: 'vgal-xavier',
      divisionId: 'profiles',
    });
  });

  it('by-illustration 命中，hidden 仍可命中（clue 明確引用）', async () => {
    const res = await worker.fetch(
      createRequest('/api/visuals/gallery?illustration=scene-rainfall'),
      env,
      ctx
    );
    const json = (await res.json()) as {
      data: { found: boolean; gallery?: Record<string, unknown> };
    };
    expect(json.data.found).toBe(true);
    expect(json.data.gallery).toMatchObject({
      id: 'visuals/illustrations/vgal-hidden-scene',
      illustrationId: 'scene-rainfall',
      entityKey: null,
      divisionId: 'illustrations',
    });
  });

  it('軟刪除 → found:false', async () => {
    const res = await worker.fetch(
      createRequest(
        `/api/visuals/gallery?id=${encodeURIComponent('visuals/profiles/vgal-deleted')}`
      ),
      env,
      ctx
    );
    const json = (await res.json()) as { data: { found: boolean } };
    expect(json.data.found).toBe(false);
  });

  it('未知 id / illustration → found:false', async () => {
    const byId = await worker.fetch(
      createRequest('/api/visuals/gallery?id=visuals/nope'),
      env,
      ctx
    );
    expect(
      ((await byId.json()) as { data: { found: boolean } }).data.found
    ).toBe(false);
    const byIll = await worker.fetch(
      createRequest('/api/visuals/gallery?illustration=nope'),
      env,
      ctx
    );
    expect(
      ((await byIll.json()) as { data: { found: boolean } }).data.found
    ).toBe(false);
  });

  it('缺 id 與 illustration 參數 → 400', async () => {
    const res = await worker.fetch(
      createRequest('/api/visuals/gallery'),
      env,
      ctx
    );
    expect(res.status).toBe(400);
  });
});
