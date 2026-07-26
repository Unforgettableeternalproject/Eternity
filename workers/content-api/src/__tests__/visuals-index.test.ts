import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

import type { VisualsEntityIndexEntry } from '../visuals-index';

/**
 * Visuals 條目索引端點測試（Epic 2 S8 驗收 #2）
 *
 * 驗證：
 * 1. 有 entityKey 的 gallery 進索引，gate/locked 正確帶出
 * 2. 無 entityKey 的 gallery 不進索引
 * 3. hidden=1 的 gallery 不進索引
 * 4. deleted_at 非 null 的 gallery 不進索引
 * 5. 壞 metadata JSON 靜默跳過，不炸端點
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

/** 插入一頁 visuals/gallery 測試資料；rawMetadata 提供時直接寫入壞字串測壞 JSON 容錯 */
async function insertGalleryPage(
  id: string,
  title: string,
  metadata: Record<string, unknown> | null,
  options: { deletedAt?: string | null; rawMetadata?: string } = {}
) {
  const metadataStr = options.rawMetadata ?? JSON.stringify(metadata ?? {});
  await env.CONTENT_DB.prepare(
    `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
     VALUES (?, 'visuals', ?, ?, 1, '[]', ?, 'synced', 'gallery', 3, ?)`
  )
    .bind(
      id,
      title,
      id.slice('visuals/'.length),
      metadataStr,
      options.deletedAt ?? null
    )
    .run();
}

describe('GET /api/visuals/entity-index', () => {
  beforeAll(async () => {
    // (a) 有 entityKey，帶 gate + locked
    await insertGalleryPage('visuals/vidx-test/gallery-gated', '有閘畫廊', {
      entityKey: 'vidx-gallery-gated',
      gate: { requiresFlags: ['vidx:01'] },
      locked: true,
    });
    // (a) 有 entityKey，無 gate/locked（預設值）
    await insertGalleryPage('visuals/vidx-test/gallery-plain', '普通畫廊', {
      entityKey: 'vidx-gallery-plain',
    });
    // (b) 無 entityKey → 不進索引
    await insertGalleryPage('visuals/vidx-test/gallery-nokey', '無鑰畫廊', {
      illustrationId: 'illus-01',
    });
    // (c) hidden=1 → 不進索引
    await insertGalleryPage('visuals/vidx-test/gallery-hidden', '隱藏畫廊', {
      entityKey: 'vidx-gallery-hidden',
      hidden: true,
    });
    // (d) 軟刪除 → 不進索引
    await insertGalleryPage(
      'visuals/vidx-test/gallery-deleted',
      '已刪畫廊',
      { entityKey: 'vidx-gallery-deleted' },
      { deletedAt: new Date().toISOString() }
    );
    // (e) 壞 metadata JSON → 靜默跳過
    await insertGalleryPage(
      'visuals/vidx-test/gallery-badjson',
      '壞資料畫廊',
      null,
      { rawMetadata: '{not valid json' }
    );
  });

  async function fetchIndex(): Promise<VisualsEntityIndexEntry[]> {
    const res = await worker.fetch(
      createRequest('/api/visuals/entity-index'),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { entries: VisualsEntityIndexEntry[] };
    };
    expect(json.ok).toBe(true);
    return json.data.entries;
  }

  it('有 entityKey 的畫廊進索引，gate/locked 正確帶出', async () => {
    const entries = await fetchIndex();
    const gated = entries.find((e) => e.entityKey === 'vidx-gallery-gated');
    expect(gated).toBeDefined();
    expect(gated!.id).toBe('visuals/vidx-test/gallery-gated');
    expect(gated!.gate).toEqual({ requiresFlags: ['vidx:01'] });
    expect(gated!.locked).toBe(true);
  });

  it('無 gate 的條目不落 gate 欄位；未設 locked 預設 false', async () => {
    const entries = await fetchIndex();
    const plain = entries.find((e) => e.entityKey === 'vidx-gallery-plain');
    expect(plain).toBeDefined();
    expect(plain).not.toHaveProperty('gate');
    expect(plain!.locked).toBe(false);
  });

  it('無 entityKey 的畫廊不進索引', async () => {
    const entries = await fetchIndex();
    expect(
      entries.find((e) => e.id === 'visuals/vidx-test/gallery-nokey')
    ).toBeUndefined();
  });

  it('hidden=1 的畫廊不進索引', async () => {
    const entries = await fetchIndex();
    expect(
      entries.find((e) => e.entityKey === 'vidx-gallery-hidden')
    ).toBeUndefined();
  });

  it('軟刪除的畫廊不進索引', async () => {
    const entries = await fetchIndex();
    expect(
      entries.find((e) => e.entityKey === 'vidx-gallery-deleted')
    ).toBeUndefined();
  });

  it('壞 metadata JSON 靜默跳過，不影響端點回應其他條目', async () => {
    const entries = await fetchIndex();
    expect(
      entries.find((e) => e.id === 'visuals/vidx-test/gallery-badjson')
    ).toBeUndefined();
    // 端點整體仍正常回應，其他條目照常存在
    expect(
      entries.find((e) => e.entityKey === 'vidx-gallery-gated')
    ).toBeDefined();
  });

  it('路由不被 contentMatch 吸走：/api/content/visuals/entity-index 是頁面查詢', async () => {
    const res = await worker.fetch(
      createRequest('/api/content/visuals/entity-index'),
      env,
      ctx
    );
    expect(res.status).toBe(404);
  });
});

describe('buildVisualsEntityIndex — storyKey 與 includeHidden（S10-1）', () => {
  beforeAll(async () => {
    // 鑲框室插圖：只有 storyKey、沒有 entityKey
    await insertGalleryPage('visuals/vidx-s10/gallery-story', '劇情插圖', {
      storyKey: 'vidx-story-point',
    });
    // 隱藏的插圖——Visuals 現況超過半數 gallery 是 hidden，
    // 唯一性把關若看不到它們等於形同虛設
    await insertGalleryPage(
      'visuals/vidx-s10/gallery-story-hidden',
      '隱藏劇情插圖',
      { storyKey: 'vidx-story-hidden', hidden: true }
    );
  });

  it('只有 storyKey 的 gallery 進索引，不帶 entityKey 欄位', async () => {
    const { buildVisualsEntityIndex } = await import('../visuals-index');
    const entries = await buildVisualsEntityIndex(env.CONTENT_DB);
    const story = entries.find((e) => e.storyKey === 'vidx-story-point');
    expect(story).toBeDefined();
    expect(story!.id).toBe('visuals/vidx-s10/gallery-story');
    expect(story).not.toHaveProperty('entityKey');
  });

  it('只有 illustrationId（無兩種 key）的 gallery 仍不進索引', async () => {
    const { buildVisualsEntityIndex } = await import('../visuals-index');
    const entries = await buildVisualsEntityIndex(env.CONTENT_DB);
    expect(
      entries.find((e) => e.id === 'visuals/vidx-test/gallery-nokey')
    ).toBeUndefined();
  });

  it('預設排除 hidden；includeHidden=true 納入（唯一性把關用）', async () => {
    const { buildVisualsEntityIndex } = await import('../visuals-index');

    const visible = await buildVisualsEntityIndex(env.CONTENT_DB);
    expect(
      visible.find((e) => e.storyKey === 'vidx-story-hidden')
    ).toBeUndefined();
    expect(
      visible.find((e) => e.entityKey === 'vidx-gallery-hidden')
    ).toBeUndefined();

    const all = await buildVisualsEntityIndex(env.CONTENT_DB, {
      includeHidden: true,
    });
    expect(all.find((e) => e.storyKey === 'vidx-story-hidden')).toBeDefined();
    expect(
      all.find((e) => e.entityKey === 'vidx-gallery-hidden')
    ).toBeDefined();
  });

  it('includeHidden=true 仍排除軟刪除與壞 JSON', async () => {
    const { buildVisualsEntityIndex } = await import('../visuals-index');
    const all = await buildVisualsEntityIndex(env.CONTENT_DB, {
      includeHidden: true,
    });
    expect(
      all.find((e) => e.entityKey === 'vidx-gallery-deleted')
    ).toBeUndefined();
    expect(
      all.find((e) => e.id === 'visuals/vidx-test/gallery-badjson')
    ).toBeUndefined();
  });
});
