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
              { label: '', entries: [{ term: '原質', values: ['Essence'] }] },
            ],
          },
        ],
      }
    );

    // chrono：title fallback year
    await insertConceptsPage(
      'concepts/eidx-test/time_logs/chronicles',
      '測試時鐘',
      'chrono',
      {
        periods: [
          { era: 'u', yearNum: 420, year: 'U.0420', title: '叛逃事件' },
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
          { name: '諾薇亞 (Norvia)', entityKey: 'norvia', placeholder: false },
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

  it('chrono period 以 title 為名、無 title 時 fallback year', async () => {
    const entries = await fetchIndex();
    expect(entries.find((e) => e.name === '叛逃事件')?.stack).toBe('chrono');
    expect(entries.find((e) => e.name === 'U.0421')?.stack).toBe('chrono');
  });

  it('browser profile 帶 entityKey 納入', async () => {
    const entries = await fetchIndex();
    const norvia = entries.find((e) => e.entityKey === 'norvia');
    expect(norvia).toBeDefined();
    expect(norvia!.stack).toBe('browser');
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
