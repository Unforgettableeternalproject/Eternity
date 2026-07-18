import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

import type { EntityIndexEntry } from '../concepts-index';

/**
 * Concepts 條目索引端點測試（Epic 2 S7-C）
 *
 * 驗證：
 * 1. 四 stack 條目摘要彙整（entityKey / revisionGates / name-only）
 * 2. 無 stack_style 頁面與軟刪除頁面被排除
 * 3. 路由不被 contentMatch regex 吸走（獨立前綴 /api/concepts/）
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

/** 插入一頁 concepts 測試資料（content = ContentBlock[] 格式） */
async function insertConceptsPage(
  id: string,
  title: string,
  stackStyle: string | null,
  data: unknown,
  deletedAt: string | null = null
) {
  const metadata = stackStyle ? { stack_style: stackStyle } : {};
  await env.CONTENT_DB.prepare(
    `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
     VALUES (?, 'concepts', ?, ?, 1, ?, ?, 'synced', 'page', 2, ?)`
  )
    .bind(
      id,
      title,
      id.slice('concepts/'.length),
      JSON.stringify([
        { type: stackStyle ?? 'rich_text', content: JSON.stringify(data) },
      ]),
      JSON.stringify(metadata),
      deletedAt
    )
    .run();
}

describe('GET /api/concepts/entity-index', () => {
  beforeAll(async () => {
    // dossier：帶 entityKey + revision 鏈的條目 + name-only 條目
    await insertConceptsPage(
      'concepts/eidx-test/records/characters',
      '測試人物列表',
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
                        name: '艾斯維爾·科索諾 Xavier Colsono',
                        entityKey: 'xavier-colsono',
                        // S7-D-2：空字串/非字串須被過濾
                        aliases: ['艾斯', '', 42, '  '],
                        revisions: [
                          { id: 'base', gate: null, patch: {} },
                          {
                            id: 'xavier:01',
                            gate: { requiresFlags: ['xavier:01'] },
                            patch: { set: { content_html: '<p>更新</p>' } },
                          },
                        ],
                      },
                      { name: '無鑰條目' },
                      {
                        // 舊 baseVisible 殘留資料（已廢除）——不得進摘要
                        name: '公開演進條目',
                        entityKey: 'a-man',
                        baseVisible: true,
                        revisions: [
                          {
                            id: 'a-man:01',
                            gate: { requiresFlags: ['progress:man'] },
                            patch: { set: { content_html: '<p>更新</p>' } },
                          },
                        ],
                      },
                    ],
                  },
                  // S7 驗收 #3/#4：群組 gate + 條目 base gate 帶進摘要
                  {
                    label: '機密',
                    gate: { requiresFlags: ['sec:01'] },
                    entries: [
                      {
                        name: '機密條目',
                        gate: { requiresFlags: ['met:secret'] },
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

    // diff：name-only（translation 定案不掛 entityKey）
    await insertConceptsPage(
      'concepts/eidx-test/translation/terms',
      '測試名詞對照',
      'diff',
      {
        subcategories: [
          {
            label: '術語',
            sections: [
              {
                label: '',
                entries: [
                  { term: '原質', values: ['Essence'] },
                  { term: '隱藏概念', values: ['?'], hidden: true },
                  { term: '鎖定概念', values: ['?'], locked: true },
                ],
              },
            ],
          },
        ],
      }
    );

    // chrono：title fallback year + eventCount（flat + grouped 合計）
    await insertConceptsPage(
      'concepts/eidx-test/time_logs/chronicles',
      '測試時鐘',
      'chrono',
      {
        periods: [
          {
            era: 'u',
            yearNum: 420,
            year: 'U.0420',
            title: '叛逃事件',
            fields: {
              main: { items: ['事件一', '事件二'] },
              regional: {
                groups: [
                  { label: '三區', items: ['區域事件'] },
                  { label: '五區', items: ['區域事件二', '區域事件三'] },
                ],
              },
            },
          },
          { era: 'u', yearNum: 421, year: 'U.0421' },
        ],
      }
    );

    // browser：帶 entityKey 的 profile
    await insertConceptsPage(
      'concepts/eidx-test/browser/profiles',
      '測試個性瀏覽器',
      'browser',
      {
        profiles: [
          { name: '諾薇亞 (Novia)', entityKey: 'novia', placeholder: false },
        ],
      }
    );

    // 無 stack_style（stack 容器/homepage）→ 排除
    await insertConceptsPage('concepts/eidx-test/homepage', '測試首頁', null, {
      profiles: [{ name: '不該出現' }],
    });

    // 軟刪除頁 → 排除
    await insertConceptsPage(
      'concepts/eidx-test/records/deleted',
      '已刪除頁',
      'dossier',
      {
        variants: [
          {
            id: 'u',
            subcategories: [
              {
                label: 'x',
                groups: [{ label: '', entries: [{ name: '幽靈條目' }] }],
              },
            ],
          },
        ],
      },
      new Date().toISOString()
    );
  });

  async function fetchIndex(): Promise<EntityIndexEntry[]> {
    const res = await worker.fetch(
      createRequest('/api/concepts/entity-index'),
      env,
      ctx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { entries: EntityIndexEntry[] };
    };
    expect(json.ok).toBe(true);
    return json.data.entries;
  }

  it('dossier 條目帶 entityKey 與 revisionGates（不含 patch）', async () => {
    const entries = await fetchIndex();
    const xavier = entries.find((e) => e.entityKey === 'xavier-colsono');
    expect(xavier).toBeDefined();
    expect(xavier!.stack).toBe('dossier');
    expect(xavier!.pageId).toBe('concepts/eidx-test/records/characters');
    expect(xavier!.pageTitle).toBe('測試人物列表');
    expect(xavier!.revisionGates).toEqual([
      { id: 'base', gate: null },
      { id: 'xavier:01', gate: { requiresFlags: ['xavier:01'] } },
    ]);
    // 摘要不得夾帶 patch 內容
    expect(JSON.stringify(xavier)).not.toContain('content_html');
  });

  it('aliases 帶出且過濾空字串/非字串（S7-D-2）', async () => {
    const entries = await fetchIndex();
    const xavier = entries.find((e) => e.entityKey === 'xavier-colsono');
    expect(xavier!.aliases).toEqual(['艾斯']);
    // 無 aliases 的條目不落欄位
    const novia = entries.find((e) => e.entityKey === 'novia');
    expect(novia!.aliases).toBeUndefined();
  });

  it('無 entityKey 條目以 name-only 納入（含 diff term）', async () => {
    const entries = await fetchIndex();
    const nameOnly = entries.find((e) => e.name === '無鑰條目');
    expect(nameOnly).toBeDefined();
    expect(nameOnly!.entityKey).toBeUndefined();

    const diffTerm = entries.find((e) => e.name === '原質');
    expect(diffTerm).toBeDefined();
    expect(diffTerm!.stack).toBe('diff');
    expect(diffTerm!.entityKey).toBeUndefined();
  });

  it('diff hidden 條目不進索引（名稱不洩漏）；locked 條目照常納入', async () => {
    const entries = await fetchIndex();
    expect(entries.find((e) => e.name === '隱藏概念')).toBeUndefined();
    expect(entries.find((e) => e.name === '鎖定概念')).toBeDefined();
  });

  it('chrono period 以 title 為名、無 title 時 fallback year', async () => {
    const entries = await fetchIndex();
    expect(entries.find((e) => e.name === '叛逃事件')?.stack).toBe('chrono');
    expect(entries.find((e) => e.name === 'U.0421')?.stack).toBe('chrono');
  });

  it('chrono period 帶 eventCount（flat + grouped items 合計）', async () => {
    const entries = await fetchIndex();
    // 2 flat + 1 + 2 grouped = 5
    expect(entries.find((e) => e.name === '叛逃事件')?.eventCount).toBe(5);
    // 無 fields 的 period → 0
    expect(entries.find((e) => e.name === 'U.0421')?.eventCount).toBe(0);
  });

  it('dossier 條目帶分類欄位（category/group/variantId）', async () => {
    const entries = await fetchIndex();
    const xavier = entries.find((e) => e.entityKey === 'xavier-colsono');
    expect(xavier!.category).toBe('人物');
    expect(xavier!.variantId).toBe('u');
    // 空字串 label 不落欄位
    expect(xavier!.group).toBeUndefined();
  });

  it('diff 條目帶分類欄位（category=subcat label）', async () => {
    const entries = await fetchIndex();
    const diffTerm = entries.find((e) => e.name === '原質');
    expect(diffTerm!.category).toBe('術語');
    expect(diffTerm!.group).toBeUndefined(); // 空 section label
  });

  it('base gate 與群組 gate 帶進摘要（S7 驗收 #3/#4）', async () => {
    const entries = await fetchIndex();
    const secret = entries.find((e) => e.name === '機密條目');
    expect(secret).toBeDefined();
    expect(secret!.baseGate).toEqual({ requiresFlags: ['met:secret'] });
    expect(secret!.groupGate).toEqual({ requiresFlags: ['sec:01'] });
    // 無 gate 的條目不落欄位
    const xavier = entries.find((e) => e.entityKey === 'xavier-colsono');
    expect(xavier!.baseGate).toBeUndefined();
    expect(xavier!.groupGate).toBeUndefined();
  });

  it('已廢除的 baseVisible 欄位不再進摘要（2026-07-17 語意修正）', async () => {
    const entries = await fetchIndex();
    const aman = entries.find((e) => e.entityKey === 'a-man');
    expect(aman).toBeDefined();
    // 資料殘留 baseVisible: true 也不輸出——可見性由 baseGate 單獨決定
    expect(
      (aman as unknown as Record<string, unknown>).baseVisible
    ).toBeUndefined();
    expect(aman!.revisionGates).toEqual([
      { id: 'a-man:01', gate: { requiresFlags: ['progress:man'] } },
    ]);
  });

  it('browser profile 帶 entityKey 納入', async () => {
    const entries = await fetchIndex();
    const novia = entries.find((e) => e.entityKey === 'novia');
    expect(novia).toBeDefined();
    expect(novia!.stack).toBe('browser');
  });

  it('無 stack_style 與軟刪除頁面被排除', async () => {
    const entries = await fetchIndex();
    expect(entries.find((e) => e.name === '不該出現')).toBeUndefined();
    expect(entries.find((e) => e.name === '幽靈條目')).toBeUndefined();
  });

  it('路由不被 contentMatch 吸走：/api/content/concepts/entity-index 是頁面查詢', async () => {
    const res = await worker.fetch(
      createRequest('/api/content/concepts/entity-index'),
      env,
      ctx
    );
    // 該路徑落在內容 CRUD（無此頁面 → 404），與索引端點分離
    expect(res.status).toBe(404);
  });
});

describe('buildConceptsEntityIndex — publicOnly 選項', () => {
  // 專用測試 area，用 clearOnly 隔離避免影響上面 GET /api/concepts/entity-index 的 fixtures
  const AREA_PAGES = [
    'concepts/pubonly/public-dossier',
    'concepts/pubonly/hidden-dossier',
    'concepts/pubonly/locked-dossier',
  ];

  async function insertWithFlags(
    id: string,
    stackStyle: string,
    data: unknown,
    flags: { hidden?: boolean; locked?: boolean } = {}
  ) {
    const metadata: Record<string, unknown> = { stack_style: stackStyle };
    if (flags.hidden) metadata.hidden = true;
    if (flags.locked) metadata.locked = true;
    await env.CONTENT_DB.prepare(
      `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
       VALUES (?, 'concepts', ?, ?, 1, ?, ?, 'synced', 'page', 2, NULL)`
    )
      .bind(
        id,
        id,
        id.slice('concepts/'.length),
        JSON.stringify([{ type: stackStyle, content: JSON.stringify(data) }]),
        JSON.stringify(metadata)
      )
      .run();
  }

  beforeAll(async () => {
    // 三頁 dossier：一頁公開、一頁 hidden、一頁 locked，各帶一個 entry
    const dossierData = (name: string) => ({
      variants: [
        {
          id: 'u',
          subcategories: [
            {
              label: 'X',
              groups: [{ label: 'Y', entries: [{ name }] }],
            },
          ],
        },
      ],
    });
    await insertWithFlags(
      'concepts/pubonly/public-dossier',
      'dossier',
      dossierData('公開條目')
    );
    await insertWithFlags(
      'concepts/pubonly/hidden-dossier',
      'dossier',
      dossierData('隱藏條目'),
      { hidden: true }
    );
    await insertWithFlags(
      'concepts/pubonly/locked-dossier',
      'dossier',
      dossierData('鎖定條目'),
      { locked: true }
    );
  });

  it('預設（publicOnly=false）納入 hidden/locked 頁面的 entity（沿用舊行為）', async () => {
    const { buildConceptsEntityIndex } = await import('../concepts-index');
    const entries = await buildConceptsEntityIndex(env.CONTENT_DB);
    const names = entries.map((e) => e.name);
    expect(names).toContain('公開條目');
    expect(names).toContain('隱藏條目');
    expect(names).toContain('鎖定條目');
  });

  it('publicOnly=true 排除 hidden/locked 頁面的 entity', async () => {
    const { buildConceptsEntityIndex } = await import('../concepts-index');
    const entries = await buildConceptsEntityIndex(env.CONTENT_DB, {
      publicOnly: true,
    });
    const names = entries.map((e) => e.name);
    expect(names).toContain('公開條目');
    expect(names).not.toContain('隱藏條目');
    expect(names).not.toContain('鎖定條目');
  });

  it('publicOnly=true 仍然排除軟刪除頁面（SQL 保留原有 deleted_at 條件）', async () => {
    // 額外插入一個 hidden=false 但 deleted 的頁
    await env.CONTENT_DB.prepare(
      `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
       VALUES ('concepts/pubonly/deleted-dossier', 'concepts', 'del', 'del', 1, ?, ?, 'synced', 'page', 2, ?)`
    )
      .bind(
        JSON.stringify([
          {
            type: 'dossier',
            content: JSON.stringify({
              variants: [
                {
                  id: 'u',
                  subcategories: [
                    {
                      label: 'X',
                      groups: [{ label: 'Y', entries: [{ name: '刪除條目' }] }],
                    },
                  ],
                },
              ],
            }),
          },
        ]),
        JSON.stringify({ stack_style: 'dossier' }),
        new Date().toISOString()
      )
      .run();

    const { buildConceptsEntityIndex } = await import('../concepts-index');
    const entries = await buildConceptsEntityIndex(env.CONTENT_DB, {
      publicOnly: true,
    });
    expect(entries.map((e) => e.name)).not.toContain('刪除條目');
  });
});
