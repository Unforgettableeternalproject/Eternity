import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';

import {
  buildConceptsBindingIndex,
  hasRegisteredBinding,
} from '../concepts-bindings';

/**
 * Concepts dossier 綁定鏈掃描測試（entity 一對多綁定 T-1）
 *
 * 驗證：
 * 1. revision patch 的 bindings.echoes / bindings.visuals 被收進索引
 * 2. dot-path 與巢狀兩種 patch 寫法都認（求值端 applyRevisions 兩種都生效）
 * 3. 同 entityKey 跨多個 dossier variant 的綁定會合併
 * 4. browser 條目的綁定不收（dossier 是唯一權威來源）
 * 5. 無 bindings 的一般 revision 不誤判
 * 6. 壞 metadata JSON 靜默跳過，不打掉整個索引
 * 7. chrono/diff 不參與身分體系，即使寫了 bindings 也不收
 */

/** 插入一頁 concepts 測試資料（content = ContentBlock[] 格式） */
async function insertConceptsPage(
  id: string,
  stackStyle: string | null,
  data: unknown,
  options: { rawMetadata?: string } = {}
) {
  const metadata = stackStyle ? { stack_style: stackStyle } : {};
  await env.CONTENT_DB.prepare(
    `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
     VALUES (?, 'concepts', ?, ?, 1, ?, ?, 'synced', 'page', 2, NULL)`
  )
    .bind(
      id,
      id,
      id.slice('concepts/'.length),
      JSON.stringify([
        { type: stackStyle ?? 'rich_text', content: JSON.stringify(data) },
      ]),
      options.rawMetadata ?? JSON.stringify(metadata)
    )
    .run();
}

/** 包一層 dossier 的 variants→subcategories→groups→entries 結構 */
function dossierData(variantId: string, entries: unknown[]) {
  return {
    variants: [
      {
        id: variantId,
        subcategories: [{ label: '人物', groups: [{ label: '', entries }] }],
      },
    ],
  };
}

describe('buildConceptsBindingIndex', () => {
  beforeAll(async () => {
    // (1) dossier：base（gate null）+ 轉正 revision，dot-path 寫法
    await insertConceptsPage(
      'concepts/bind-test/records/characters',
      'dossier',
      dossierData('u', [
        {
          name: '轉正角色',
          entityKey: 'bind-turncoat',
          revisions: [
            {
              id: 'base',
              gate: null,
              patch: {
                set: { 'bindings.echoes': 'echoes/bind/villain-theme' },
              },
            },
            {
              id: 'bind-turncoat:turned',
              gate: { requiresFlags: ['bind-turncoat:turned'] },
              patch: {
                set: {
                  'bindings.echoes': 'echoes/bind/hero-theme',
                  'bindings.visuals': 'visuals/bind/after',
                },
              },
            },
          ],
        },
        {
          // (5) 有 revision 但不含 bindings → 不進索引
          name: '一般演進角色',
          entityKey: 'bind-plain',
          revisions: [
            {
              id: 'bind-plain:01',
              gate: { requiresFlags: ['bind-plain:01'] },
              patch: { set: { 'basic.陣營': '同盟' } },
            },
          ],
        },
        {
          // 無 revisions → 不進索引
          name: '無演進角色',
          entityKey: 'bind-norev',
        },
      ])
    );

    // (3) 同 entityKey 出現在另一個 variant，綁定應合併
    await insertConceptsPage(
      'concepts/bind-test/records/characters-e',
      'dossier',
      dossierData('e', [
        {
          name: '轉正角色（E 時代）',
          entityKey: 'bind-turncoat',
          revisions: [
            {
              id: 'base',
              gate: null,
              patch: { set: { 'bindings.visuals': 'visuals/bind/era-e' } },
            },
          ],
        },
      ])
    );

    // (2) 巢狀物件寫法
    await insertConceptsPage(
      'concepts/bind-test/records/nested',
      'dossier',
      dossierData('u', [
        {
          name: '巢狀寫法角色',
          entityKey: 'bind-nested',
          revisions: [
            {
              id: 'base',
              gate: null,
              patch: {
                set: { bindings: { echoes: 'echoes/bind/nested-theme' } },
              },
            },
          ],
        },
      ])
    );

    // (4) browser 條目即使寫了綁定也不收——dossier 是唯一權威來源
    await insertConceptsPage('concepts/bind-test/browser/traits', 'browser', {
      profiles: [
        {
          name: '不該被收的角色',
          entityKey: 'bind-browser',
          bindings: { echoes: 'echoes/bind/should-not' },
          revisions: [
            {
              id: 'base',
              gate: null,
              patch: {
                set: { 'bindings.visuals': 'visuals/bind/should-not' },
              },
            },
          ],
        },
      ],
    });

    // (7) diff 不參與身分體系，即使寫了 bindings 也不收
    await insertConceptsPage('concepts/bind-test/diff/terms', 'diff', {
      subcategories: [
        {
          label: '術語',
          sections: [
            {
              label: '',
              entries: [
                {
                  term: '不該被收的術語',
                  entityKey: 'bind-diff',
                  revisions: [
                    {
                      id: 'base',
                      gate: null,
                      patch: {
                        set: { 'bindings.echoes': 'echoes/bind/should-not' },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    // (6) 條目層級 bindings：一個只有 base、一個 base + revision 覆蓋
    await insertConceptsPage(
      'concepts/bind-test/records/base-level',
      'dossier',
      dossierData('u', [
        {
          name: '單曲角色',
          entityKey: 'bind-baseonly',
          bindings: {
            echoes: 'echoes/bind/only-theme',
            visuals: 'visuals/bind/only-art',
          },
        },
        {
          name: '換曲角色',
          entityKey: 'bind-basethenrev',
          bindings: { echoes: 'echoes/bind/before' },
          revisions: [
            {
              id: 'bind-basethenrev:after',
              gate: { requiresFlags: ['x'] },
              patch: { set: { 'bindings.echoes': 'echoes/bind/after' } },
            },
          ],
        },
      ])
    );

    // (7) 壞 metadata JSON
    await insertConceptsPage(
      'concepts/bind-test/badjson',
      'dossier',
      dossierData('u', []),
      { rawMetadata: '{not valid json' }
    );
  });

  it('收 revision patch 的 bindings，同 entityKey 多筆依宣告順序累積', async () => {
    const index = await buildConceptsBindingIndex(env.CONTENT_DB);
    const turncoat = index.get('bind-turncoat');
    expect(turncoat).toBeDefined();
    expect(turncoat!.echoesIds).toEqual([
      'echoes/bind/villain-theme',
      'echoes/bind/hero-theme',
    ]);
  });

  it('收條目層級的 bindings——沒有 revision 鏈也算登記', async () => {
    const index = await buildConceptsBindingIndex(env.CONTENT_DB);
    const only = index.get('bind-baseonly');
    expect(only).toBeDefined();
    expect(only!.echoesIds).toEqual(['echoes/bind/only-theme']);
    expect(only!.visualsIds).toEqual(['visuals/bind/only-art']);
  });

  it('條目層級與 revision 的指向都收，條目層級在前', async () => {
    const index = await buildConceptsBindingIndex(env.CONTENT_DB);
    expect(index.get('bind-basethenrev')!.echoesIds).toEqual([
      'echoes/bind/before',
      'echoes/bind/after',
    ]);
  });

  it('同 entityKey 跨多個 dossier variant 的綁定會合併', async () => {
    const index = await buildConceptsBindingIndex(env.CONTENT_DB);
    const turncoat = index.get('bind-turncoat')!;
    // u variant 的 after + e variant 的 era-e
    expect(turncoat.visualsIds).toContain('visuals/bind/after');
    expect(turncoat.visualsIds).toContain('visuals/bind/era-e');
  });

  it('巢狀 set.bindings.echoes 寫法與 dot-path 同等對待', async () => {
    const index = await buildConceptsBindingIndex(env.CONTENT_DB);
    expect(index.get('bind-nested')?.echoesIds).toEqual([
      'echoes/bind/nested-theme',
    ]);
  });

  it('有 revision 但不含 bindings 的條目不進索引', async () => {
    const index = await buildConceptsBindingIndex(env.CONTENT_DB);
    expect(index.has('bind-plain')).toBe(false);
    expect(index.has('bind-norev')).toBe(false);
  });

  it('🔒 browser stack 即使寫了 bindings 也不收——dossier 是唯一權威', async () => {
    // 掃描端若收 browser，會與只讀 dossier 的求值端分岔：browser 上寫一筆
    // 就能放行撞名，但那筆綁定 runtime 永遠不會被消費。
    const index = await buildConceptsBindingIndex(env.CONTENT_DB);
    expect(index.has('bind-browser')).toBe(false);
  });

  it('diff stack 即使寫了 bindings 也不收（不參與身分體系）', async () => {
    const index = await buildConceptsBindingIndex(env.CONTENT_DB);
    expect(index.has('bind-diff')).toBe(false);
  });

  it('壞 metadata JSON 靜默跳過，其餘條目照常收', async () => {
    const index = await buildConceptsBindingIndex(env.CONTENT_DB);
    expect(index.get('bind-turncoat')).toBeDefined();
  });
});

describe('hasRegisteredBinding', () => {
  it('未登記的 entityKey 回 false', async () => {
    const index = await buildConceptsBindingIndex(env.CONTENT_DB);
    expect(hasRegisteredBinding(index, 'bind-plain', 'echoes')).toBe(false);
    expect(hasRegisteredBinding(index, '完全不存在的-key', 'echoes')).toBe(
      false
    );
  });

  it('依 area 分別判定——只綁 echoes 的 key 不放行 visuals', async () => {
    const index = await buildConceptsBindingIndex(env.CONTENT_DB);
    expect(hasRegisteredBinding(index, 'bind-nested', 'echoes')).toBe(true);
    expect(hasRegisteredBinding(index, 'bind-nested', 'visuals')).toBe(false);
  });
});
