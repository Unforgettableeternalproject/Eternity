import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';

/**
 * 跨區互聯資料表結構測試（Epic 2 S10-1 T-B1）
 *
 * migration 0022 建立的兩張表：history_interlink_index（History 三種
 * 標記的反向索引）與 story_points（劇情點標題／說明）。
 *
 * 驗證重點放在**約束**而非欄位存在——欄位打錯型別測試自然會炸，
 * 但 CHECK 約束寫錯（例如少列一種 anchor_kind）要等到 E 段真的寫入
 * 索引時才會發現，屆時錯誤訊息會指向寫入端而不是 migration。
 */

async function tableExists(name: string): Promise<boolean> {
  const row = await env.CONTENT_DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
  )
    .bind(name)
    .first<{ name: string }>();
  return row?.name === name;
}

async function indexExists(name: string): Promise<boolean> {
  const row = await env.CONTENT_DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`
  )
    .bind(name)
    .first<{ name: string }>();
  return row?.name === name;
}

/** 嘗試寫入，回傳是否被資料庫拒絕 */
async function insertRejected(sql: string, ...params: string[]) {
  try {
    await env.CONTENT_DB.prepare(sql)
      .bind(...params)
      .run();
    return false;
  } catch {
    return true;
  }
}

describe('migration 0022 — 表與索引', () => {
  it('history_interlink_index 與 story_points 兩張表都已建立', async () => {
    expect(await tableExists('history_interlink_index')).toBe(true);
    expect(await tableExists('story_points')).toBe(true);
  });

  it('查詢用的兩個索引都已建立', async () => {
    expect(await indexExists('idx_hii_key')).toBe(true);
    expect(await indexExists('idx_hii_page')).toBe(true);
  });
});

describe('history_interlink_index — 約束', () => {
  const INSERT = `INSERT INTO history_interlink_index
    (page_id, anchor_kind, anchor_id, key_type, key_value, label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;

  it('五種 anchor_kind 全部可寫入', async () => {
    const kinds = [
      'entity-mark',
      'echo-spot',
      'visual-clue-start',
      'visual-clue-gate',
      'visual-clue-end',
    ];
    for (const kind of kinds) {
      await env.CONTENT_DB.prepare(INSERT)
        .bind('history/kind-probe', kind, null, 'entity', 'probe-key', null)
        .run();
    }
    const { results } = await env.CONTENT_DB.prepare(
      `SELECT anchor_kind FROM history_interlink_index WHERE page_id = ?`
    )
      .bind('history/kind-probe')
      .all<{ anchor_kind: string }>();
    expect(results.map((r) => r.anchor_kind).sort()).toEqual(kinds.sort());
  });

  it('未知的 anchor_kind 被 CHECK 擋下', async () => {
    expect(
      await insertRejected(
        INSERT,
        'history/bad',
        'not-a-real-kind',
        'x',
        'entity',
        'k',
        'l'
      )
    ).toBe(true);
  });

  it('key_type 只接受 entity / story', async () => {
    await env.CONTENT_DB.prepare(INSERT)
      .bind('history/keytype', 'echo-spot', 'spot-1', 'story', 'a-story', null)
      .run();
    expect(
      await insertRejected(
        INSERT,
        'history/keytype',
        'echo-spot',
        'spot-2',
        'illustration',
        'k',
        'l'
      )
    ).toBe(true);
  });

  it('entity mark 沒有穩定 id，anchor_id 可為 NULL', async () => {
    await env.CONTENT_DB.prepare(INSERT)
      .bind(
        'history/nullanchor',
        'entity-mark',
        null,
        'entity',
        'k',
        '顯示文字'
      )
      .run();
    const row = await env.CONTENT_DB.prepare(
      `SELECT anchor_id, label FROM history_interlink_index WHERE page_id = ?`
    )
      .bind('history/nullanchor')
      .first<{ anchor_id: string | null; label: string | null }>();
    expect(row?.anchor_id).toBeNull();
    expect(row?.label).toBe('顯示文字');
  });

  it('同一頁可掛多筆同 key 的不同錨點（多錨點定案，不加 main flag）', async () => {
    await env.CONTENT_DB.prepare(INSERT)
      .bind('history/multi', 'echo-spot', 'spot-a', 'story', 'shared', null)
      .run();
    await env.CONTENT_DB.prepare(INSERT)
      .bind(
        'history/multi',
        'visual-clue-start',
        'clue-a',
        'story',
        'shared',
        null
      )
      .run();
    const { results } = await env.CONTENT_DB.prepare(
      `SELECT anchor_id FROM history_interlink_index
       WHERE key_type = 'story' AND key_value = 'shared'`
    ).all<{ anchor_id: string }>();
    expect(results.length).toBe(2);
  });
});

describe('story_points — 約束', () => {
  it('story_key 是主鍵，重複寫入被拒；INSERT OR IGNORE 則靜默略過', async () => {
    await env.CONTENT_DB.prepare(
      `INSERT INTO story_points (story_key, title, description, created_at, updated_at)
       VALUES ('sp-dup', NULL, NULL, datetime('now'), datetime('now'))`
    ).run();

    expect(
      await insertRejected(
        `INSERT INTO story_points (story_key, title, description, created_at, updated_at)
         VALUES (?, NULL, NULL, datetime('now'), datetime('now'))`,
        'sp-dup'
      )
    ).toBe(true);

    // 寫入路徑實際用的是 INSERT OR IGNORE 建殼（見設計文件 §2-4）
    await env.CONTENT_DB.prepare(
      `INSERT OR IGNORE INTO story_points (story_key, title, description, created_at, updated_at)
       VALUES ('sp-dup', '不該覆蓋', NULL, datetime('now'), datetime('now'))`
    ).run();
    const row = await env.CONTENT_DB.prepare(
      `SELECT title FROM story_points WHERE story_key = 'sp-dup'`
    ).first<{ title: string | null }>();
    expect(row?.title).toBeNull();
  });

  it('title / description 可為 NULL（S10-1 建殼階段全程為空）', async () => {
    await env.CONTENT_DB.prepare(
      `INSERT INTO story_points (story_key, title, description, created_at, updated_at)
       VALUES ('sp-shell', NULL, NULL, datetime('now'), datetime('now'))`
    ).run();
    const row = await env.CONTENT_DB.prepare(
      `SELECT title, description FROM story_points WHERE story_key = 'sp-shell'`
    ).first<{ title: string | null; description: string | null }>();
    expect(row?.title).toBeNull();
    expect(row?.description).toBeNull();
  });
});
