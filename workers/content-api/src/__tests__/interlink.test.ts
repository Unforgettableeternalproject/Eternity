import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';

import {
  findKeyConflict,
  findDuplicateCandidate,
  findStorySongsWithoutKey,
  conceptsScope,
  ZONE_SCOPE,
} from '../interlink';
import type { KeyCandidate, KeyConflictQuery } from '../interlink';

/**
 * 跨區互聯：資料表結構與 key 唯一性把關
 *
 * `history_interlink_index`（History 三種標記的反向索引）來自 migration
 * 0022；`interlink_keys`（key 的標題／說明，取代原本只收 story 的
 * `story_points`）與 `uep_flags`（自訂旗標註冊表）來自 0023。
 *
 * 表結構的驗證重點放在**約束**而非欄位存在——欄位打錯型別測試自然會炸，
 * 但 CHECK 約束寫錯（例如少列一種 anchor_kind）要等到真的寫入索引時
 * 才會發現，屆時錯誤訊息會指向寫入端而不是 migration。
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

describe('互聯相關資料表與索引', () => {
  it('三張表都已建立，且 story_points 已被 interlink_keys 取代', async () => {
    expect(await tableExists('history_interlink_index')).toBe(true);
    expect(await tableExists('interlink_keys')).toBe(true);
    expect(await tableExists('uep_flags')).toBe(true);
    expect(await tableExists('story_points')).toBe(false);
  });

  it('查詢用的索引都已建立', async () => {
    expect(await indexExists('idx_hii_key')).toBe(true);
    expect(await indexExists('idx_hii_page')).toBe(true);
    expect(await indexExists('idx_uep_flags_category')).toBe(true);
    // 0025：軟刪除墓碑，一般查詢一律過濾 deleted_at IS NULL
    expect(await indexExists('idx_uep_flags_deleted_at')).toBe(true);
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

describe('interlink_keys — 約束', () => {
  const INSERT = `INSERT INTO interlink_keys
    (key_type, key_value, title, description, created_at, updated_at)
    VALUES (?, ?, NULL, NULL, datetime('now'), datetime('now'))`;

  it('(key_type, key_value) 是複合主鍵，重複寫入被拒；INSERT OR IGNORE 靜默略過', async () => {
    await env.CONTENT_DB.prepare(INSERT).bind('story', 'sp-dup').run();

    expect(await insertRejected(INSERT, 'story', 'sp-dup')).toBe(true);

    // 寫入路徑實際用的是 INSERT OR IGNORE 建殼，不得覆蓋已填好的標題
    await env.CONTENT_DB.prepare(
      `INSERT OR IGNORE INTO interlink_keys
         (key_type, key_value, title, description, created_at, updated_at)
       VALUES ('story', 'sp-dup', '不該覆蓋', NULL, datetime('now'), datetime('now'))`
    ).run();
    const row = await env.CONTENT_DB.prepare(
      `SELECT title FROM interlink_keys
       WHERE key_type = 'story' AND key_value = 'sp-dup'`
    ).first<{ title: string | null }>();
    expect(row?.title).toBeNull();
  });

  it('同一個 key 值可同時以 entity 與 story 兩種身分存在', async () => {
    // 兩個命名空間平行且允許重疊（S10-1 §2-1），複合主鍵必須容得下
    await env.CONTENT_DB.prepare(INSERT).bind('entity', 'overlap').run();
    await env.CONTENT_DB.prepare(INSERT).bind('story', 'overlap').run();
    const rows = await env.CONTENT_DB.prepare(
      `SELECT key_type FROM interlink_keys WHERE key_value = 'overlap'
       ORDER BY key_type`
    ).all<{ key_type: string }>();
    expect(rows.results?.map((r) => r.key_type)).toEqual(['entity', 'story']);
  });

  it('key_type 只收 entity / story', async () => {
    expect(await insertRejected(INSERT, 'gallery', 'bad-type')).toBe(true);
  });

  it('title / description 可為 NULL（建殼階段皆為空）', async () => {
    await env.CONTENT_DB.prepare(INSERT).bind('story', 'sp-shell').run();
    const row = await env.CONTENT_DB.prepare(
      `SELECT title, description FROM interlink_keys
       WHERE key_type = 'story' AND key_value = 'sp-shell'`
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

/**
 * `findKeyConflict` 以 excludePageId 排除整個當前頁，同一次存檔內部的
 * 重複對它完全隱形——新建頁面連 DB 記錄都還沒有。沒有這道檢查，違規
 * 資料會被永久保存，而且之後每次存檔都一樣通過。
 */
describe('findDuplicateCandidate — 同一次請求內部的撞名', () => {
  const candidate = (overrides: Partial<KeyCandidate> = {}): KeyCandidate => ({
    keyType: 'entity',
    keyValue: 'dup-key',
    scope: 'dossier:u',
    field: 'entityKey',
    ...overrides,
  });

  it('同 scope 同 key 出現兩次 → 回傳第二次那筆', () => {
    const dup = findDuplicateCandidate([
      candidate(),
      candidate({ field: 'entityKey' }),
    ]);
    expect(dup).toMatchObject({ keyValue: 'dup-key', scope: 'dossier:u' });
  });

  it('同 key 不同 scope 不算撞（dossier 各 variant 本來就會重複）', () => {
    expect(
      findDuplicateCandidate([
        candidate({ scope: 'dossier:u' }),
        candidate({ scope: 'dossier:e' }),
      ])
    ).toBeNull();
  });

  it('同 key 分屬兩個命名空間不算撞', () => {
    expect(
      findDuplicateCandidate([
        candidate({ keyType: 'entity', scope: ZONE_SCOPE }),
        candidate({ keyType: 'story', scope: ZONE_SCOPE }),
      ])
    ).toBeNull();
  });

  it('scope 與 key 的邊界不會混淆（scope 本身含 `:`）', () => {
    expect(
      findDuplicateCandidate([
        candidate({ scope: 'dossier', keyValue: 'u:dup-key' }),
        candidate({ scope: 'dossier:u', keyValue: 'dup-key' }),
      ])
    ).toBeNull();
  });

  it('空清單／單筆一律無衝突', () => {
    expect(findDuplicateCandidate([])).toBeNull();
    expect(findDuplicateCandidate([candidate()])).toBeNull();
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

describe('findStorySongsWithoutKey — 劇情歌漏綁 storyKey 巡查', () => {
  beforeAll(async () => {
    const insert = (id: string, title: string, metadata: object) =>
      env.CONTENT_DB.prepare(
        `INSERT OR REPLACE INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth)
         VALUES (?, 'echoes', ?, ?, 1, '[]', ?, 'synced', 'song', 3)`
      )
        .bind(id, title, id.slice('echoes/'.length), JSON.stringify(metadata))
        .run();

    // 有綁：不進清單
    await insert('echoes/ssw/bound', '已綁的劇情歌', {
      category: 'story',
      storyKey: 'ssw-finale',
    });
    // 沒綁：進清單
    await insert('echoes/ssw/unbound', '漏綁的劇情歌', { category: 'story' });
    // storyKey 是空白字串視同沒綁
    await insert('echoes/ssw/blank', '空白 key 的劇情歌', {
      category: 'story',
      storyKey: '  ',
    });
    // 非劇情歌：不參與巡查
    await insert('echoes/ssw/character', '角色歌', { category: 'character' });
    // 軟刪除的劇情歌不列
    await env.CONTENT_DB.prepare(
      `INSERT OR REPLACE INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
       VALUES ('echoes/ssw/deleted', 'echoes', '刪掉的劇情歌', 'ssw/deleted', 1, '[]', ?, 'synced', 'song', 3, datetime('now'))`
    )
      .bind(JSON.stringify({ category: 'story' }))
      .run();
  });

  it('只列出 category=story 且無有效 storyKey 的未刪頁', async () => {
    const issues = await findStorySongsWithoutKey(env.CONTENT_DB);
    const ids = issues
      .map((i) => i.pageId)
      .filter((id) => id.includes('/ssw/'));
    expect(ids.sort()).toEqual(['echoes/ssw/blank', 'echoes/ssw/unbound']);
    expect(issues.find((i) => i.pageId === 'echoes/ssw/unbound')?.title).toBe(
      '漏綁的劇情歌'
    );
  });
});

describe('findKeyConflict — entity 一對多綁定例外（2026-08-15 定案）', () => {
  beforeAll(async () => {
    // 已在 dossier revision 鏈登記綁定的 entityKey：允許同區多首
    await insertConceptsPage(
      'concepts/bindx/records/characters',
      '綁定測試檔案',
      'dossier',
      {
        variants: [
          {
            id: 'u',
            subcategories: [
              {
                label: '人物',
                groups: [
                  {
                    label: '',
                    entries: [
                      {
                        name: '轉正角色',
                        entityKey: 'bindx-turncoat',
                        revisions: [
                          {
                            id: 'base',
                            gate: null,
                            patch: {
                              set: {
                                'bindings.echoes': 'echoes/bindx/villain',
                              },
                            },
                          },
                          {
                            id: 'bindx-turncoat:turned',
                            gate: { requiresFlags: ['bindx-turncoat:turned'] },
                            patch: {
                              set: { 'bindings.echoes': 'echoes/bindx/hero' },
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }
    );

    await insertKeyPage('echoes', 'echoes/bindx/villain', '反派期主題曲', {
      entityKey: 'bindx-turncoat',
    });
    await insertKeyPage('echoes', 'echoes/bindx/hero', '轉正後主題曲', {
      entityKey: 'bindx-turncoat',
    });

    // 對照組：沒有任何 dossier 綁定登記的 entityKey
    await insertKeyPage('echoes', 'echoes/bindx/plain-a', '未登記甲', {
      entityKey: 'bindx-plain',
    });
  });

  it('已登記綁定的 entityKey：同區第二首不算衝突', async () => {
    const conflict = await findKeyConflict(env.CONTENT_DB, {
      keyType: 'entity',
      keyValue: 'bindx-turncoat',
      area: 'echoes',
      scope: ZONE_SCOPE,
      excludePageId: 'echoes/bindx/hero',
    });
    expect(conflict).toBeNull();
  });

  it('尚未存檔的新頁也放行（不逐 id 比對，避免雞生蛋）', async () => {
    const conflict = await findKeyConflict(env.CONTENT_DB, {
      keyType: 'entity',
      keyValue: 'bindx-turncoat',
      area: 'echoes',
      // 這一頁還不存在，也不在任何 bindings 鏈裡
      excludePageId: 'echoes/bindx/brand-new',
      scope: ZONE_SCOPE,
    });
    expect(conflict).toBeNull();
  });

  it('未登記綁定的 entityKey：409 把關行為完全不變', async () => {
    const conflict = await findKeyConflict(env.CONTENT_DB, {
      keyType: 'entity',
      keyValue: 'bindx-plain',
      area: 'echoes',
      scope: ZONE_SCOPE,
      excludePageId: 'echoes/bindx/plain-b',
    });
    expect(conflict).not.toBeNull();
    expect(conflict!.pageId).toBe('echoes/bindx/plain-a');
  });

  it('綁定只豁免登記過的 area——只綁 echoes 不影響 visuals 的把關', async () => {
    await insertKeyPage('visuals', 'visuals/bindx/gal-a', '甲畫廊', {
      entityKey: 'bindx-turncoat',
    });
    const conflict = await findKeyConflict(env.CONTENT_DB, {
      keyType: 'entity',
      keyValue: 'bindx-turncoat',
      area: 'visuals',
      scope: ZONE_SCOPE,
      excludePageId: 'visuals/bindx/gal-b',
    });
    expect(conflict).not.toBeNull();
    expect(conflict!.pageId).toBe('visuals/bindx/gal-a');
  });

  it('🔒 綁定的 target 不存在時 409 恢復把關（殘留綁定不算豁免）', async () => {
    // 只看「登記過字串」的話，一筆指向已刪頁面的殘留綁定就能永久開啟這個
    // key 的撞名豁免，同 key 想塞幾筆都行——而那些內容誰都綁不到，
    // 求值端只會回 unbound，讀者看到的是 by-key 反查的任意一筆
    await insertConceptsPage(
      'concepts/bindx/records/ghost',
      '殘留綁定檔案',
      'dossier',
      {
        variants: [
          {
            id: 'u',
            subcategories: [
              {
                label: '人物',
                groups: [
                  {
                    label: '',
                    entries: [
                      {
                        name: '殘留角色',
                        entityKey: 'bindx-ghost',
                        // 指向一個從來不存在的頁面
                        bindings: { echoes: 'echoes/bindx/deleted-song' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }
    );
    await insertKeyPage('echoes', 'echoes/bindx/ghost-a', '殘留甲', {
      entityKey: 'bindx-ghost',
    });

    const conflict = await findKeyConflict(env.CONTENT_DB, {
      keyType: 'entity',
      keyValue: 'bindx-ghost',
      area: 'echoes',
      scope: ZONE_SCOPE,
      excludePageId: 'echoes/bindx/ghost-b',
    });
    expect(conflict).not.toBeNull();
    expect(conflict!.pageId).toBe('echoes/bindx/ghost-a');
  });

  it('storyKey 不適用綁定例外（劇情點與內容是一對一）', async () => {
    await insertKeyPage('echoes', 'echoes/bindx/story-a', '劇情曲甲', {
      storyKey: 'bindx-turncoat',
      category: 'story',
    });
    const conflict = await findKeyConflict(env.CONTENT_DB, {
      keyType: 'story',
      keyValue: 'bindx-turncoat',
      area: 'echoes',
      scope: ZONE_SCOPE,
      excludePageId: 'echoes/bindx/story-b',
    });
    expect(conflict).not.toBeNull();
    expect(conflict!.pageId).toBe('echoes/bindx/story-a');
  });
});
