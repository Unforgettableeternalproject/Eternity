import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

import type { EchoesEntityIndexEntry } from '../echoes-index';

/**
 * Echoes 條目索引端點測試（Epic 2 S8 驗收 #2）
 *
 * 驗證：
 * 1. 有 entityKey 的 song 進索引，gate/locked 正確帶出
 * 2. 無 entityKey 的 song 不進索引
 * 3. hidden=1 的 song 不進索引
 * 4. deleted_at 非 null 的 song 不進索引
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

/** 插入一頁 echoes/song 測試資料；metadataRaw 未提供時直接寫入壞字串測壞 JSON 容錯 */
async function insertSongPage(
  id: string,
  title: string,
  metadata: Record<string, unknown> | null,
  options: { deletedAt?: string | null; rawMetadata?: string } = {}
) {
  const metadataStr = options.rawMetadata ?? JSON.stringify(metadata ?? {});
  await env.CONTENT_DB.prepare(
    `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
     VALUES (?, 'echoes', ?, ?, 1, '[]', ?, 'synced', 'song', 3, ?)`
  )
    .bind(
      id,
      title,
      id.slice('echoes/'.length),
      metadataStr,
      options.deletedAt ?? null
    )
    .run();
}

describe('GET /api/echoes/entity-index', () => {
  beforeAll(async () => {
    // (a) 有 entityKey，帶 gate + locked
    await insertSongPage('echoes/eidx-test/song-gated', '有閘曲目', {
      entityKey: 'eidx-song-gated',
      gate: { requiresFlags: ['eidx:01'] },
      locked: true,
    });
    // (a) 有 entityKey，無 gate/locked（預設值）
    await insertSongPage('echoes/eidx-test/song-plain', '普通曲目', {
      entityKey: 'eidx-song-plain',
    });
    // (b) 無 entityKey → 不進索引
    await insertSongPage('echoes/eidx-test/song-nokey', '無鑰曲目', {
      category: 'story',
    });
    // (c) hidden=1 → 不進索引
    await insertSongPage('echoes/eidx-test/song-hidden', '隱藏曲目', {
      entityKey: 'eidx-song-hidden',
      hidden: true,
    });
    // (d) 軟刪除 → 不進索引
    await insertSongPage(
      'echoes/eidx-test/song-deleted',
      '已刪曲目',
      { entityKey: 'eidx-song-deleted' },
      { deletedAt: new Date().toISOString() }
    );
    // (e) 壞 metadata JSON → 靜默跳過
    await insertSongPage('echoes/eidx-test/song-badjson', '壞資料曲目', null, {
      rawMetadata: '{not valid json',
    });
  });

  async function fetchIndex(): Promise<EchoesEntityIndexEntry[]> {
    const res = await worker.fetch(
      createRequest('/api/echoes/entity-index'),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { entries: EchoesEntityIndexEntry[] };
    };
    expect(json.ok).toBe(true);
    return json.data.entries;
  }

  it('有 entityKey 的曲目進索引，gate/locked 正確帶出', async () => {
    const entries = await fetchIndex();
    const gated = entries.find((e) => e.entityKey === 'eidx-song-gated');
    expect(gated).toBeDefined();
    expect(gated!.id).toBe('echoes/eidx-test/song-gated');
    expect(gated!.gate).toEqual({ requiresFlags: ['eidx:01'] });
    expect(gated!.locked).toBe(true);
  });

  it('無 gate 的條目不落 gate 欄位；未設 locked 預設 false', async () => {
    const entries = await fetchIndex();
    const plain = entries.find((e) => e.entityKey === 'eidx-song-plain');
    expect(plain).toBeDefined();
    expect(plain).not.toHaveProperty('gate');
    expect(plain!.locked).toBe(false);
  });

  it('無 entityKey 的曲目不進索引', async () => {
    const entries = await fetchIndex();
    expect(
      entries.find((e) => e.id === 'echoes/eidx-test/song-nokey')
    ).toBeUndefined();
  });

  it('hidden=1 的曲目不進索引', async () => {
    const entries = await fetchIndex();
    expect(
      entries.find((e) => e.entityKey === 'eidx-song-hidden')
    ).toBeUndefined();
  });

  it('軟刪除的曲目不進索引', async () => {
    const entries = await fetchIndex();
    expect(
      entries.find((e) => e.entityKey === 'eidx-song-deleted')
    ).toBeUndefined();
  });

  it('壞 metadata JSON 靜默跳過，不影響端點回應其他條目', async () => {
    const entries = await fetchIndex();
    expect(
      entries.find((e) => e.id === 'echoes/eidx-test/song-badjson')
    ).toBeUndefined();
    // 端點整體仍正常回應，其他條目照常存在
    expect(
      entries.find((e) => e.entityKey === 'eidx-song-gated')
    ).toBeDefined();
  });

  it('路由不被 contentMatch 吸走：/api/content/echoes/entity-index 是頁面查詢', async () => {
    const res = await worker.fetch(
      createRequest('/api/content/echoes/entity-index'),
      env,
      ctx
    );
    expect(res.status).toBe(404);
  });
});
