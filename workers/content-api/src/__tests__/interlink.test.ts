import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';

import { findKeyConflict, conceptsScope, ZONE_SCOPE } from '../interlink';
import type { KeyConflictQuery } from '../interlink';

/**
 * 跨區互聯：資料表結構（T-B1）與 key 唯一性把關（T-B2）
 *
 * migration 0022 建立的兩張表：history_interlink_index（History 三種
 * 標記的反向索引）與 story_points（劇情點標題／說明）。
 *
 * 表結構的驗證重點放在**約束**而非欄位存在——欄位打錯型別測試自然會炸，
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

// ===== T-B2：findKeyConflict =====

/** 插入一頁 echoes/song 或 visuals/gallery 測資 */
async function insertKeyPage(
  area: 'echoes' | 'visuals',
  id: string,
  title: string,
  metadata: Record<string, unknown>,
  deletedAt: string | null = null
) {
  const pageType = area === 'echoes' ? 'song' : 'gallery';
  await env.CONTENT_DB.prepare(
    `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
     VALUES (?, ?, ?, ?, 1, '[]', ?, 'synced', ?, 3, ?)`
  )
    .bind(
      id,
      area,
      title,
      id.slice(area.length + 1),
      JSON.stringify(metadata),
      pageType,
      deletedAt
    )
    .run();
}

/** 插入一頁 concepts 結構化頁（單一 stack_style + 條目） */
async function insertConceptsPage(
  id: string,
  title: string,
  stackStyle: string,
  data: unknown
) {
  await env.CONTENT_DB.prepare(
    `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
     VALUES (?, 'concepts', ?, ?, 1, ?, ?, 'synced', 'page', 2, NULL)`
  )
    .bind(
      id,
      title,
      id.slice('concepts/'.length),
      JSON.stringify([{ type: stackStyle, content: JSON.stringify(data) }]),
      JSON.stringify({ stack_style: stackStyle })
    )
    .run();
}

/** dossier 結構：一個 variant 底下一個條目 */
const dossierWith = (variantId: string, entityKey: string) => ({
  variants: [
    {
      id: variantId,
      subcategories: [
        {
          label: 'X',
          groups: [{ label: 'Y', entries: [{ name: '條目', entityKey }] }],
        },
      ],
    },
  ],
});

describe('findKeyConflict — Echoes / Visuals（整個區塊一個實例）', () => {
  beforeAll(async () => {
    await insertKeyPage('echoes', 'echoes/ilk/song-a', '甲曲', {
      entityKey: 'ilk-shared',
    });
    await insertKeyPage('echoes', 'echoes/ilk/song-story', '劇情曲', {
      storyKey: 'ilk-story',
      category: 'story',
    });
    // 隱藏歌——key 仍是有效引用目標，撞名檢查必須看得到
    await insertKeyPage('echoes', 'echoes/ilk/song-hidden', '隱藏曲', {
      storyKey: 'ilk-hidden-story',
      category: 'story',
      hidden: true,
    });
    await insertKeyPage(
      'echoes',
      'echoes/ilk/song-deleted',
      '已刪曲',
      { entityKey: 'ilk-deleted' },
      new Date().toISOString()
    );
    await insertKeyPage('visuals', 'visuals/ilk/gallery-a', '甲畫廊', {
      entityKey: 'ilk-vis',
    });
  });

  const q = (over: Partial<KeyConflictQuery> = {}): KeyConflictQuery => ({
    keyType: 'entity',
    keyValue: 'ilk-shared',
    area: 'echoes',
    scope: ZONE_SCOPE,
    excludePageId: 'echoes/ilk/new-page',
    ...over,
  });

  it('同區塊已有相同 entityKey → 回傳衝突頁資訊', async () => {
    const conflict = await findKeyConflict(env.CONTENT_DB, q());
    expect(conflict).toEqual({
      pageId: 'echoes/ilk/song-a',
      pageTitle: '甲曲',
    });
  });

  it('未被使用的 key → null', async () => {
    expect(
      await findKeyConflict(env.CONTENT_DB, q({ keyValue: 'ilk-unused' }))
    ).toBeNull();
  });

  it('排除自身：更新既有頁面不與自己衝突', async () => {
    expect(
      await findKeyConflict(
        env.CONTENT_DB,
        q({ excludePageId: 'echoes/ilk/song-a' })
      )
    ).toBeNull();
  });

  it('storyKey 走 story 命名空間，與 entityKey 互不干擾', async () => {
    const asStory = await findKeyConflict(
      env.CONTENT_DB,
      q({ keyType: 'story', keyValue: 'ilk-story' })
    );
    expect(asStory?.pageId).toBe('echoes/ilk/song-story');

    // 同一個字串當 entityKey 查則無衝突（兩個命名空間允許重疊）
    expect(
      await findKeyConflict(
        env.CONTENT_DB,
        q({ keyType: 'entity', keyValue: 'ilk-story' })
      )
    ).toBeNull();
  });

  it('隱藏頁的 key 仍會被偵測到（hidden ≠ 不存在）', async () => {
    const conflict = await findKeyConflict(
      env.CONTENT_DB,
      q({ keyType: 'story', keyValue: 'ilk-hidden-story' })
    );
    expect(conflict?.pageId).toBe('echoes/ilk/song-hidden');
  });

  it('軟刪除頁的 key 已釋放，不再佔用命名空間', async () => {
    expect(
      await findKeyConflict(env.CONTENT_DB, q({ keyValue: 'ilk-deleted' }))
    ).toBeNull();
  });

  it('跨 zone 不算衝突：Echoes 的 key 不影響 Visuals 查詢', async () => {
    expect(
      await findKeyConflict(env.CONTENT_DB, q({ area: 'visuals' }))
    ).toBeNull();
    expect(
      await findKeyConflict(
        env.CONTENT_DB,
        q({ area: 'echoes', keyValue: 'ilk-vis' })
      )
    ).toBeNull();
  });

  it('空字串 key 一律視為無衝突（未填不參與把關）', async () => {
    expect(
      await findKeyConflict(env.CONTENT_DB, q({ keyValue: '' }))
    ).toBeNull();
  });
});

describe('findKeyConflict — Concepts（每個 stack 內一次，跨頁生效）', () => {
  beforeAll(async () => {
    // 同屬 dossier 的兩頁（模擬 records 容器底下的多頁結構）
    await insertConceptsPage(
      'concepts/ilk/dossier-one',
      '檔案一',
      'dossier',
      dossierWith('u', 'ilk-person')
    );
    await insertConceptsPage(
      'concepts/ilk/dossier-two',
      '檔案二',
      'dossier',
      dossierWith('u', 'ilk-other')
    );
    // 同 key 但不同 variant（不同時代版本，合法）
    await insertConceptsPage(
      'concepts/ilk/dossier-era-v',
      '檔案三',
      'dossier',
      dossierWith('v', 'ilk-person')
    );
    // 同 key 但不同 stack（合法）
    await insertConceptsPage('concepts/ilk/browser-one', '瀏覽器', 'browser', {
      profiles: [{ name: '側寫', entityKey: 'ilk-person' }],
    });
  });

  const cq = (over: Partial<KeyConflictQuery> = {}): KeyConflictQuery => ({
    keyType: 'entity',
    keyValue: 'ilk-person',
    area: 'concepts',
    scope: conceptsScope('dossier', 'u'),
    excludePageId: 'concepts/ilk/new-page',
    ...over,
  });

  it('同 stack 同 variant 的另一頁已用該 key → 衝突（跨頁生效）', async () => {
    const conflict = await findKeyConflict(env.CONTENT_DB, cq());
    expect(conflict?.pageId).toBe('concepts/ilk/dossier-one');
    expect(conflict?.pageTitle).toBe('檔案一');
  });

  it('dossier 不同 variant 的同 key 不算衝突（時代變體是核心設計）', async () => {
    expect(
      await findKeyConflict(
        env.CONTENT_DB,
        cq({ scope: conceptsScope('dossier', 'w') })
      )
    ).toBeNull();
  });

  it('不同 stack 的同 key 不算衝突', async () => {
    const inBrowser = await findKeyConflict(
      env.CONTENT_DB,
      cq({ scope: conceptsScope('browser') })
    );
    expect(inBrowser?.pageId).toBe('concepts/ilk/browser-one');

    expect(
      await findKeyConflict(
        env.CONTENT_DB,
        cq({ scope: conceptsScope('chrono') })
      )
    ).toBeNull();
  });

  it('排除自身頁面後不誤擋', async () => {
    expect(
      await findKeyConflict(
        env.CONTENT_DB,
        cq({ excludePageId: 'concepts/ilk/dossier-one' })
      )
    ).toBeNull();
  });

  it('story 命名空間不含 Concepts → 一律 null', async () => {
    expect(
      await findKeyConflict(env.CONTENT_DB, cq({ keyType: 'story' }))
    ).toBeNull();
  });
});

describe('conceptsScope', () => {
  it('dossier 以 variantId 分區，其餘 stack 為整個 stack', () => {
    expect(conceptsScope('dossier', 'u')).toBe('dossier:u');
    expect(conceptsScope('dossier')).toBe('dossier:');
    expect(conceptsScope('browser', 'u')).toBe('browser');
    expect(conceptsScope('chrono')).toBe('chrono');
    expect(conceptsScope('diff')).toBe('diff');
  });
});
