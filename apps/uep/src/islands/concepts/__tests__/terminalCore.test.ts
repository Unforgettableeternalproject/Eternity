/**
 * terminalCore 測試 — Terminal Island 查詢核心（Epic 2 S7-C）
 *
 * 驗證四件事：
 * 1. 索引載入與模組級快取（成功快取、失敗重試、手動 invalidate）
 * 2. 檢索語意：解鎖過濾（未解鎖=隱藏）、substring 比對、entityKey 排序
 * 3. ls 列表與 stack 簡稱解析
 * 4. 條目內容解析：effective view 套用、placeholder/locked → restricted
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createInitialState } from '../../../progress/types';
import type { ProgressState } from '../../../progress/types';
import {
  loadEntityIndex,
  invalidateTerminalCache,
  isEntityRefUnlocked,
  isIndexEntryUnlocked,
  passedRevisionCount,
  resolveStackAlias,
  queryIndex,
  findByEntityKey,
  listStackEntries,
  groupStackEntries,
  summarizeCategories,
  significantChronoPeriods,
  completeInput,
  stripHtml,
  truncate,
  htmlToLines,
  resolveBrowserExpand,
  resolveEntryDetails,
  summarizePages,
  formatEntryLabel,
} from '../terminalCore';
import type { TerminalIndexEntry } from '../terminalCore';

function stateWith(partial: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...partial };
}

/** 索引條目工廠 */
function indexEntry(
  overrides: Partial<TerminalIndexEntry> & { name: string }
): TerminalIndexEntry {
  return {
    stack: 'dossier',
    pageId: 'concepts/server/records/characters',
    pageTitle: '人物列表',
    ...overrides,
  };
}

/** 打造 fetch mock：依 URL 尾端分派回應 */
function stubFetch(routes: Record<string, unknown>) {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const [suffix, payload] of Object.entries(routes)) {
      if (url.endsWith(suffix)) {
        return {
          ok: true,
          json: async () => payload,
        } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  invalidateTerminalCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 索引載入與快取 ─────────────────────────────────────────────────

describe('loadEntityIndex', () => {
  const payload = {
    ok: true,
    data: { entries: [indexEntry({ name: '艾斯維爾' })] },
  };

  it('載入索引並快取（重複呼叫只打一次 API）', async () => {
    const fetchFn = stubFetch({ '/api/concepts/entity-index': payload });
    const first = await loadEntityIndex();
    const second = await loadEntityIndex();
    expect(first).toHaveLength(1);
    expect(second).toBe(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('invalidateTerminalCache 後重新抓取', async () => {
    const fetchFn = stubFetch({ '/api/concepts/entity-index': payload });
    await loadEntityIndex();
    invalidateTerminalCache();
    await loadEntityIndex();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('失敗時清除快取，下次呼叫重試', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => payload });
    vi.stubGlobal('fetch', fetchFn);

    await expect(loadEntityIndex()).rejects.toThrow('HTTP 500');
    const retried = await loadEntityIndex();
    expect(retried).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

// ── 解鎖判定 ───────────────────────────────────────────────────────

describe('isIndexEntryUnlocked / passedRevisionCount', () => {
  // 2026-07-17 語意修正：可見性 = groupGate + baseGate；
  // revisionGates 只供更動通知水位，不影響可見性
  const gated = indexEntry({
    name: '艾斯維爾',
    entityKey: 'xavier-colsono',
    revisionGates: [
      { id: 'base', gate: null },
      { id: 'xavier:01', gate: { requiresFlags: ['xavier:01'] } },
      { id: 'xavier:02', gate: { requiresFlags: ['xavier:02'] } },
    ],
  });

  it('無 gate 摘要 = 無進度閘', () => {
    expect(
      isIndexEntryUnlocked(indexEntry({ name: '普通' }), stateWith({}))
    ).toBe(true);
  });

  it('revision gate 不影響可見性：全 gated revisions 且零旗標仍可見', () => {
    expect(isIndexEntryUnlocked(gated, stateWith({}))).toBe(true);
    const fullyGatedRevisions = indexEntry({
      name: '演進條目',
      revisionGates: [{ id: 'r1', gate: { requiresFlags: ['secret:01'] } }],
    });
    expect(isIndexEntryUnlocked(fullyGatedRevisions, stateWith({}))).toBe(true);
  });

  it('baseGate（S7 驗收 #4）：未過隱藏、通過解鎖、觀測者 bypass', () => {
    const baseGated = indexEntry({
      name: '甲',
      baseGate: { requiresFlags: ['met:a'] },
    });
    expect(isIndexEntryUnlocked(baseGated, stateWith({}))).toBe(false);
    expect(
      isIndexEntryUnlocked(baseGated, stateWith({ flags: ['met:a'] }))
    ).toBe(true);
    expect(
      isIndexEntryUnlocked(
        baseGated,
        stateWith({ view: 'observer', observerEver: true })
      )
    ).toBe(true);
  });

  it('baseGate 未過時 revision gate 通過也不反向開鎖（可見性只看 baseGate）', () => {
    const withRev = indexEntry({
      name: '乙',
      baseGate: { requiresFlags: ['met:b'] },
      revisionGates: [{ id: 'b:01', gate: { requiresFlags: ['b:01'] } }],
    });
    expect(isIndexEntryUnlocked(withRev, stateWith({ flags: ['b:01'] }))).toBe(
      false
    );
    expect(isIndexEntryUnlocked(withRev, stateWith({ flags: ['met:b'] }))).toBe(
      true
    );
  });

  it('groupGate（S7 驗收 #3）：未過整組隱藏（前置 AND，base/revision 不再看）', () => {
    const inGatedGroup = indexEntry({
      name: '丙',
      groupGate: { requiresFlags: ['sec:01'] },
      revisionGates: [{ id: 'base', gate: null }],
    });
    expect(isIndexEntryUnlocked(inGatedGroup, stateWith({}))).toBe(false);
    expect(
      isIndexEntryUnlocked(inGatedGroup, stateWith({ flags: ['sec:01'] }))
    ).toBe(true);
    // 觀測者 bypass
    expect(
      isIndexEntryUnlocked(
        inGatedGroup,
        stateWith({ view: 'observer', observerEver: true })
      )
    ).toBe(true);
  });

  it('passedRevisionCount 隨旗標遞增（T-05 水位）', () => {
    expect(passedRevisionCount(gated, stateWith({}))).toBe(1);
    expect(
      passedRevisionCount(gated, stateWith({ flags: ['xavier:01'] }))
    ).toBe(2);
    expect(
      passedRevisionCount(
        gated,
        stateWith({ flags: ['xavier:01', 'xavier:02'] })
      )
    ).toBe(3);
    expect(
      passedRevisionCount(indexEntry({ name: '無鏈' }), stateWith({}))
    ).toBe(0);
  });
});

// ── 檢索與列表 ─────────────────────────────────────────────────────

describe('queryIndex', () => {
  const entries = [
    indexEntry({ name: '雨海塔', stack: 'dossier' }),
    indexEntry({
      name: '艾斯維爾·科索諾 Xavier Colsono',
      entityKey: 'xavier-colsono',
    }),
    indexEntry({
      name: '未解鎖角色',
      baseGate: { requiresFlags: ['no:01'] },
    }),
    indexEntry({ name: '原質', stack: 'diff' }),
    indexEntry({ name: '月桂 Laurel', stack: 'browser' }),
    indexEntry({ name: 'AD 0420', stack: 'chrono' }),
  ];

  it('name substring 比對（case-insensitive）', () => {
    expect(queryIndex(entries, 'xavier', stateWith({}))).toHaveLength(1);
    expect(queryIndex(entries, '艾斯維爾', stateWith({}))).toHaveLength(1);
    expect(queryIndex(entries, 'XAVIER', stateWith({}))).toHaveLength(1);
  });

  it('entityKey 也可比對；browser 條目不進檢索（三輪定案）', () => {
    // 'l' 命中 'Xavier Colsono'（dossier 帶 key）與 '月桂 Laurel'（browser）
    // ——browser 為 log entry 的附屬內容，不能直接搜尋
    const hits = queryIndex(entries, 'l', stateWith({}));
    expect(hits).toHaveLength(1);
    expect(hits[0].entityKey).toBe('xavier-colsono');
    expect(hits.find((h) => h.stack === 'browser')).toBeUndefined();
  });

  it('diff 條目一律不進 query（純對照表，ls compare 才是入口）', () => {
    expect(queryIndex(entries, '原質', stateWith({}))).toHaveLength(0);
    // 索引殘留 entityKey 的舊資料也不得被查到
    const withKeyed = [
      ...entries,
      indexEntry({ name: '遣返', stack: 'diff', entityKey: 'repatriation' }),
    ];
    expect(queryIndex(withKeyed, '遣返', stateWith({}))).toHaveLength(0);
  });

  /* 艾斯維爾 2026-07-27 定案：query 專門用來抓 entity。實體身分只由
   * dossier 與 browser 承擔，browser 又不可直接搜——可查的就只剩 dossier。 */
  it('chrono 時期一律不進 query（ls clock 才是入口）', () => {
    expect(queryIndex(entries, 'AD 0420', stateWith({}))).toHaveLength(0);
    expect(queryIndex(entries, '0420', stateWith({}))).toHaveLength(0);
    // 索引殘留 entityKey 的舊資料也不得被查到
    const withKeyed = [
      ...entries,
      indexEntry({ name: 'AD 0666', stack: 'chrono', entityKey: 'incident' }),
    ];
    expect(queryIndex(withKeyed, '0666', stateWith({}))).toHaveLength(0);
    expect(queryIndex(withKeyed, 'incident', stateWith({}))).toHaveLength(0);
  });

  it('未解鎖條目從結果隱藏', () => {
    expect(queryIndex(entries, '未解鎖', stateWith({}))).toHaveLength(0);
    expect(
      queryIndex(entries, '未解鎖', stateWith({ flags: ['no:01'] }))
    ).toHaveLength(1);
  });

  it('空關鍵字回空陣列', () => {
    expect(queryIndex(entries, '  ', stateWith({}))).toHaveLength(0);
  });

  it('aliases 也可比對（S7-D-2 補充匹配詞）', () => {
    const withAlias = [
      ...entries,
      indexEntry({
        name: '諾薇亞 Novia',
        entityKey: 'novia',
        aliases: ['小諾', 'Nov'],
      }),
    ];
    expect(queryIndex(withAlias, '小諾', stateWith({}))).toHaveLength(1);
    expect(queryIndex(withAlias, 'nov', stateWith({}))).toHaveLength(1);
    // 別名不影響未命中情況
    expect(queryIndex(withAlias, '大諾', stateWith({}))).toHaveLength(0);
  });

  it('findByEntityKey 精準取回（跨 stack 多筆）', () => {
    const multi = [
      ...entries,
      indexEntry({
        name: '艾斯維爾·科索諾 (Xavier Colsono)',
        entityKey: 'xavier-colsono',
        stack: 'browser',
        pageId: 'concepts/server/browser/profiles',
      }),
    ];
    expect(findByEntityKey(multi, 'xavier-colsono')).toHaveLength(2);
    expect(findByEntityKey(multi, 'nobody')).toHaveLength(0);
  });
});

describe('resolveStackAlias / listStackEntries', () => {
  it('簡稱解析（設計文件 6-3）+ 原名容忍', () => {
    expect(resolveStackAlias('log')).toBe('dossier');
    expect(resolveStackAlias('browser')).toBe('browser');
    expect(resolveStackAlias('clock')).toBe('chrono');
    expect(resolveStackAlias('compare')).toBe('diff');
    expect(resolveStackAlias('DOSSIER')).toBe('dossier');
    expect(resolveStackAlias('unknown')).toBeNull();
  });

  it('ls：已解鎖列名、未解鎖只計數', () => {
    const entries = [
      indexEntry({ name: '甲' }),
      indexEntry({
        name: '乙（未解鎖）',
        baseGate: { requiresFlags: ['no:01'] },
      }),
      indexEntry({ name: '丙', stack: 'diff' }),
    ];
    const result = listStackEntries(entries, 'dossier', stateWith({}));
    expect(result.total).toBe(2);
    expect(result.unlocked.map((e) => e.name)).toEqual(['甲']);
  });
});

// ── ls 三層式（S7 驗收 #5）＋ alias 標籤（#11） ─────────────────────

describe('summarizePages / pageId 過濾 / formatEntryLabel', () => {
  const entries = [
    indexEntry({
      name: '甲',
      pageId: 'concepts/a',
      pageTitle: '人物列表',
      category: '三區',
    }),
    indexEntry({
      name: '乙',
      pageId: 'concepts/a',
      pageTitle: '人物列表',
      category: '五區',
    }),
    indexEntry({
      name: '丙',
      pageId: 'concepts/b',
      pageTitle: '地點列表',
      category: '三區',
    }),
    indexEntry({
      name: '丁（未解鎖）',
      pageId: 'concepts/b',
      pageTitle: '地點列表',
      baseGate: { requiresFlags: ['no:01'] },
    }),
  ];

  it('summarizePages：按來源頁彙整已解鎖條目（索引順序）', () => {
    const { pages, unlockedCount, total } = summarizePages(
      entries,
      'dossier',
      stateWith({})
    );
    expect(pages).toEqual([
      { pageId: 'concepts/a', pageTitle: '人物列表', count: 2 },
      { pageId: 'concepts/b', pageTitle: '地點列表', count: 1 },
    ]);
    expect(unlockedCount).toBe(3);
    expect(total).toBe(4);
  });

  it('summarizeCategories 帶 pageId：只看該頁——同名分類不跨頁混列', () => {
    const scoped = summarizeCategories(
      entries,
      'dossier',
      stateWith({}),
      'concepts/a'
    );
    expect(scoped.categories).toEqual([
      { category: '三區', count: 1 },
      { category: '五區', count: 1 },
    ]);
    // 不帶 pageId 時「三區」跨頁合併（舊行為保留）
    const global = summarizeCategories(entries, 'dossier', stateWith({}));
    expect(global.categories.find((c) => c.category === '三區')?.count).toBe(2);
  });

  it('groupStackEntries 帶 pageId：條目層限定來源頁', () => {
    const { groups, unlockedCount } = groupStackEntries(
      entries,
      'dossier',
      stateWith({}),
      'concepts/b'
    );
    expect(unlockedCount).toBe(1);
    expect(groups.flatMap((g) => g.entries.map((e) => e.name))).toEqual(['丙']);
  });

  it('formatEntryLabel：名稱後附 aliases、空白別名過濾、無別名原樣', () => {
    expect(
      formatEntryLabel(
        indexEntry({ name: '諾薇亞 Novia', aliases: ['小諾', ' ', 'Nov'] })
      )
    ).toBe('諾薇亞 Novia（小諾、Nov）');
    expect(formatEntryLabel(indexEntry({ name: '甲' }))).toBe('甲');
    expect(formatEntryLabel(indexEntry({ name: '甲', aliases: [] }))).toBe(
      '甲'
    );
  });
});

// ── 文字工具 ───────────────────────────────────────────────────────

describe('stripHtml / truncate', () => {
  it('剝標記、還原 entity、壓平空白', () => {
    expect(stripHtml('<p>甲 <strong>乙</strong>&nbsp;&amp; 丙</p>')).toBe(
      '甲 乙 & 丙'
    );
  });

  it('truncate 超長截短補 …', () => {
    expect(truncate('短句')).toBe('短句');
    expect(truncate('a'.repeat(130))).toHaveLength(120);
    expect(truncate('a'.repeat(130)).endsWith('…')).toBe(true);
  });
});

// ── 條目內容解析 ───────────────────────────────────────────────────

describe('resolveEntryDetails', () => {
  const dossierPage = {
    ok: true,
    data: {
      content: [
        {
          type: 'dossier',
          content: JSON.stringify({
            variants: [
              {
                id: 'u',
                label: 'U',
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
                            content_html: '<p>初始敘述。</p>',
                            revisions: [
                              { id: 'base', gate: null, patch: {} },
                              {
                                id: 'xavier:01',
                                gate: { requiresFlags: ['xavier-colsono:01'] },
                                patch: {
                                  set: {
                                    content_html: '<p>揭露後的敘述。</p>',
                                  },
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
          }),
        },
      ],
    },
  };

  const xavierIndex = indexEntry({
    name: '艾斯維爾·科索諾 Xavier Colsono',
    entityKey: 'xavier-colsono',
  });

  it('dossier：effective view 隨旗標演進（base → revision patch）', async () => {
    stubFetch({
      '/api/content/concepts/server/records/characters': dossierPage,
    });

    const before = await resolveEntryDetails(xavierIndex, stateWith({}));
    expect(before).toHaveLength(1);
    expect(before[0].variantId).toBe('u');
    expect(before[0].summary[0]).toBe('初始敘述。');

    invalidateTerminalCache(); // 清頁面快取（progress 不同不共用 mock 呼叫）
    stubFetch({
      '/api/content/concepts/server/records/characters': dossierPage,
    });
    const after = await resolveEntryDetails(
      xavierIndex,
      stateWith({ flags: ['xavier-colsono:01'] })
    );
    expect(after[0].summary[0]).toBe('揭露後的敘述。');
  });

  it('browser placeholder → restricted 佔位（定案 C）', async () => {
    const target = indexEntry({
      name: '未認識角色',
      stack: 'browser',
      pageId: 'concepts/server/browser/profiles',
    });
    stubFetch({
      '/api/content/concepts/server/browser/profiles': {
        ok: true,
        data: {
          content: [
            {
              type: 'browser_profile',
              content: JSON.stringify({
                profiles: [{ name: '未認識角色', placeholder: true }],
              }),
            },
          ],
        },
      },
    });
    const details = await resolveEntryDetails(target, stateWith({}));
    expect(details).toHaveLength(1);
    expect(details[0].restricted).toBe(true);
    expect(details[0].name).toBe('未認識角色');
  });

  it('browser 已解鎖 profile → basic 摘要 + 區段數', async () => {
    const target = indexEntry({
      name: '諾薇亞 (Novia)',
      entityKey: 'novia',
      stack: 'browser',
      pageId: 'concepts/server/browser/profiles',
    });
    stubFetch({
      '/api/content/concepts/server/browser/profiles': {
        ok: true,
        data: {
          content: [
            {
              type: 'browser_profile',
              content: JSON.stringify({
                profiles: [
                  {
                    name: '諾薇亞 (Novia)',
                    entityKey: 'novia',
                    placeholder: false,
                    basic: { 種族: '生體機械', 職務: '程式碼執行者' },
                    sections: [{ label: '內在特質', content_html: '<p>x</p>' }],
                  },
                ],
              }),
            },
          ],
        },
      },
    });
    const details = await resolveEntryDetails(target, stateWith({}));
    expect(details[0].restricted).toBeUndefined();
    expect(details[0].summary).toContain('種族：生體機械');
    expect(details[0].summary.at(-1)).toContain('1 個區段');
  });

  it('diff：locked → restricted；一般條目 values 摘要；hidden 跳過', async () => {
    const pageId = 'concepts/server/translation/terms';
    const payload = {
      ok: true,
      data: {
        content: [
          {
            type: 'diff_table',
            content: JSON.stringify({
              subcategories: [
                {
                  label: '術語',
                  sections: [
                    {
                      label: '',
                      entries: [
                        { term: '原質', values: ['Essence', '構成萬物的單位'] },
                        { term: '鎖定概念', values: ['?'], locked: true },
                        { term: '原質', values: ['幽靈'], hidden: true },
                      ],
                    },
                  ],
                },
              ],
            }),
          },
        ],
      },
    };
    stubFetch({ [`/api/content/${pageId}`]: payload });

    const normal = await resolveEntryDetails(
      indexEntry({ name: '原質', stack: 'diff', pageId }),
      stateWith({})
    );
    expect(normal).toHaveLength(1); // hidden 的同名條目被跳過
    expect(normal[0].summary[0]).toBe('Essence ／ 構成萬物的單位');

    const locked = await resolveEntryDetails(
      indexEntry({ name: '鎖定概念', stack: 'diff', pageId }),
      stateWith({})
    );
    expect(locked[0].restricted).toBe(true);
  });

  it('頁面抓不到 → 空陣列（呼叫端顯示 not-found）', async () => {
    stubFetch({});
    const details = await resolveEntryDetails(xavierIndex, stateWith({}));
    expect(details).toEqual([]);
  });

  it('無 baseGate 掛 gated revisions 仍不 restricted（2026-07-17 語意修正）', async () => {
    // 「一個人」重現：無 baseGate + 一條 gated revision，讀者零旗標
    // ——條目永遠可見（revision 不鎖條目），base 內容照常呈現
    const pageId = 'concepts/server/records/characters';
    stubFetch({
      [`/api/content/${pageId}`]: {
        ok: true,
        data: {
          content: [
            {
              type: 'dossier',
              content: JSON.stringify({
                variants: [
                  {
                    id: 'u',
                    label: 'U',
                    subcategories: [
                      {
                        label: '人物',
                        groups: [
                          {
                            label: '',
                            entries: [
                              {
                                name: '一個人',
                                entityKey: 'a-man',
                                content_html: '<p>base 敘述。</p>',
                                revisions: [
                                  {
                                    id: 'a-man:01',
                                    gate: { requiresFlags: ['a-man:01'] },
                                    patch: {
                                      set: {
                                        content_html: '<p>揭露敘述。</p>',
                                      },
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
              }),
            },
          ],
        },
      },
    });
    const details = await resolveEntryDetails(
      indexEntry({ name: '一個人', entityKey: 'a-man', pageId }),
      stateWith({})
    );
    expect(details).toHaveLength(1);
    expect(details[0].restricted).toBeUndefined();
    expect(details[0].summary[0]).toBe('base 敘述。');
  });
});

// ── 嵌入 ref 可點守門（2026-07-17：可點 ⟺ terminal 查得到內容） ────

describe('isEntityRefUnlocked', () => {
  const entries = [
    indexEntry({ name: '艾斯維爾', entityKey: 'xavier-colsono' }),
    indexEntry({
      name: '一個人',
      entityKey: 'a-man',
      // 無 baseGate + gated revisions：永遠可見（revision 不鎖條目）
      revisionGates: [{ id: 'a-man:01', gate: { requiresFlags: ['a:01'] } }],
    }),
    indexEntry({
      name: '隱藏人物',
      entityKey: 'hidden-man',
      baseGate: { requiresFlags: ['h:01'] },
    }),
  ];

  it('entity-key：索引中任一條目已解鎖 → true（gated revisions 不影響）', () => {
    expect(
      isEntityRefUnlocked(entries, 'entity:xavier-colsono', stateWith({}))
    ).toBe(true);
    expect(isEntityRefUnlocked(entries, 'entity:a-man', stateWith({}))).toBe(
      true
    );
  });

  it('entity-key：baseGate 未過 → false；授旗後 → true', () => {
    expect(
      isEntityRefUnlocked(entries, 'entity:hidden-man', stateWith({}))
    ).toBe(false);
    expect(
      isEntityRefUnlocked(
        entries,
        'entity:hidden-man',
        stateWith({ flags: ['h:01'] })
      )
    ).toBe(true);
  });

  it('索引未載入（null）/ 查無此 key（資料失誤）→ false 不可點', () => {
    expect(
      isEntityRefUnlocked(null, 'entity:xavier-colsono', stateWith({}))
    ).toBe(false);
    expect(isEntityRefUnlocked(entries, 'entity:nobody', stateWith({}))).toBe(
      false
    );
  });

  it('舊格式路徑 ref：met:{ref} fallback + 觀測者 bypass；無效 ref false', () => {
    const ref = 'concepts/server/records/characters#entry:abc';
    expect(isEntityRefUnlocked(entries, ref, stateWith({}))).toBe(false);
    expect(
      isEntityRefUnlocked(entries, ref, stateWith({ flags: [`met:${ref}`] }))
    ).toBe(true);
    expect(
      isEntityRefUnlocked(
        entries,
        ref,
        stateWith({ view: 'observer', observerEver: true })
      )
    ).toBe(true);
    expect(isEntityRefUnlocked(entries, 'badref', stateWith({}))).toBe(false);
  });
});

// ── browser 完整檔案展開（S7-D-4） ─────────────────────────────────

describe('resolveBrowserExpand', () => {
  const pageId = 'concepts/server/browser/profiles';
  const target = indexEntry({
    name: '諾薇亞 (Novia)',
    entityKey: 'novia',
    stack: 'browser',
    pageId,
  });

  function stubBrowserPage(profiles: unknown[]) {
    stubFetch({
      [`/api/content/${pageId}`]: {
        ok: true,
        data: {
          content: [
            {
              type: 'browser_profile',
              content: JSON.stringify({ profiles }),
            },
          ],
        },
      },
    });
  }

  it('basic 全欄位（不限 4 欄）+ sections 全段落不截短', async () => {
    stubBrowserPage([
      {
        name: '諾薇亞 (Novia)',
        entityKey: 'novia',
        placeholder: false,
        basic: {
          種族: '生體機械',
          職務: '程式碼執行者',
          創造者: '瑞斯可·亞克',
          隸屬: '命運織者',
          狀態: '運作中',
        },
        sections: [
          {
            label: '內在特質',
            content_html: `<p>${'長段落'.repeat(60)}</p><p>第二段。</p>`,
          },
          { label: '角色背景', content_html: '<p>背景敘述。</p>' },
        ],
      },
    ]);
    const detail = await resolveBrowserExpand(target, stateWith({}));
    expect(detail).not.toBeNull();
    expect(detail!.restricted).toBeUndefined();
    // basic 全 5 欄（browserDetail 縮短形態只取 4）
    expect(detail!.basic).toHaveLength(5);
    expect(detail!.basic[4]).toBe('狀態：運作中');
    // sections 全段落，長段不截短
    expect(detail!.sections).toHaveLength(2);
    expect(detail!.sections[0].lines[0]).toBe('長段落'.repeat(60));
    expect(detail!.sections[0].lines[1]).toBe('第二段。');
    expect(detail!.sections[1].label).toBe('角色背景');
  });

  it('placeholder → restricted（佔位鎖定，不洩內容）', async () => {
    stubBrowserPage([
      {
        name: '諾薇亞 (Novia)',
        entityKey: 'novia',
        placeholder: true,
        basic: { 種族: '不可見' },
      },
    ]);
    const detail = await resolveBrowserExpand(target, stateWith({}));
    expect(detail!.restricted).toBe(true);
    expect(detail!.basic).toEqual([]);
    expect(detail!.sections).toEqual([]);
  });

  it('baseGate 未過 → restricted；通過後 patch 照旗標生效（2026-07-17 語意）', async () => {
    const profiles = [
      {
        name: '諾薇亞 (Novia)',
        entityKey: 'novia',
        placeholder: false,
        basic: { 職務: '???' },
        gate: { requiresFlags: ['novia:01'] },
        revisions: [
          {
            id: 'novia:01',
            gate: { requiresFlags: ['novia:01'] },
            patch: { set: { 'basic.職務': '程式碼執行者' } },
          },
        ],
      },
    ];
    stubBrowserPage(profiles);
    const gated = await resolveBrowserExpand(target, stateWith({}));
    expect(gated!.restricted).toBe(true);

    invalidateTerminalCache();
    stubBrowserPage(profiles);
    const passed = await resolveBrowserExpand(
      target,
      stateWith({ flags: ['novia:01'] })
    );
    expect(passed!.restricted).toBeUndefined();
    expect(passed!.basic).toEqual(['職務：程式碼執行者']);
  });

  it('無 baseGate 掛 gated revision → 可見且顯示 base 內容（revision 不鎖條目）', async () => {
    stubBrowserPage([
      {
        name: '諾薇亞 (Novia)',
        entityKey: 'novia',
        placeholder: false,
        basic: { 職務: '???' },
        revisions: [
          {
            id: 'novia:01',
            gate: { requiresFlags: ['novia:01'] },
            patch: { set: { 'basic.職務': '程式碼執行者' } },
          },
        ],
      },
    ]);
    const detail = await resolveBrowserExpand(target, stateWith({}));
    expect(detail!.restricted).toBeUndefined();
    expect(detail!.basic).toEqual(['職務：???']);
  });

  it('非 browser 目標 / profile 消失 → null', async () => {
    expect(
      await resolveBrowserExpand(
        indexEntry({ name: 'x', stack: 'dossier' }),
        stateWith({})
      )
    ).toBeNull();
    stubBrowserPage([{ name: '別人', entityKey: 'other' }]);
    expect(await resolveBrowserExpand(target, stateWith({}))).toBeNull();
  });
});

// ── ls 結構化分組（S7-C 驗收回饋） ─────────────────────────────────

describe('groupStackEntries', () => {
  const entries: TerminalIndexEntry[] = [
    indexEntry({ name: '艾斯維爾', category: '人物', group: '命運織者' }),
    indexEntry({ name: '諾薇亞', category: '人物', group: '命運織者' }),
    indexEntry({ name: '舊礦山', category: '地點' }),
    indexEntry({ name: '未分類條目' }),
    indexEntry({
      name: '被鎖條目',
      category: '人物',
      group: '命運織者',
      baseGate: { requiresFlags: ['nope'] },
    }),
    indexEntry({ name: '別棧條目', stack: 'diff', category: '術語' }),
  ];

  it('按 category → group 分組，順序 = 索引出現順序', () => {
    const { groups, unlockedCount, total } = groupStackEntries(
      entries,
      'dossier',
      stateWith({})
    );
    expect(total).toBe(5); // 別棧條目不計
    expect(unlockedCount).toBe(4); // 被鎖條目過濾
    expect(groups.map((g) => [g.category, g.group])).toEqual([
      ['人物', '命運織者'],
      ['地點', undefined],
      [undefined, undefined],
    ]);
    expect(groups[0].entries.map((e) => e.name)).toEqual([
      '艾斯維爾',
      '諾薇亞',
    ]);
  });

  it('未解鎖條目不進任何群組（名稱不洩漏）', () => {
    const { groups } = groupStackEntries(entries, 'dossier', stateWith({}));
    const all = groups.flatMap((g) => g.entries.map((e) => e.name));
    expect(all).not.toContain('被鎖條目');
  });
});

describe('significantChronoPeriods', () => {
  const chrono = (
    name: string,
    eventCount: number,
    baseGate?: TerminalIndexEntry['baseGate']
  ) =>
    indexEntry({
      name,
      stack: 'chrono',
      pageId: 'concepts/server/time_logs/chronicles',
      eventCount,
      baseGate,
    });

  it('按 eventCount 降序取前 limit 個；0 事件不列', () => {
    const entries = [
      chrono('平淡年', 0),
      chrono('小事年', 2),
      chrono('大事年', 9),
      chrono('中事年', 5),
    ];
    const top = significantChronoPeriods(entries, stateWith({}), 5);
    expect(top.map((e) => e.name)).toEqual(['大事年', '中事年', '小事年']);
  });

  it('同事件數維持索引順序（時間軸序）；超出 limit 截斷', () => {
    const entries = [chrono('前年', 3), chrono('後年', 3), chrono('峰年', 7)];
    const top = significantChronoPeriods(entries, stateWith({}), 2);
    expect(top.map((e) => e.name)).toEqual(['峰年', '前年']);
  });

  it('未解鎖 period 不進顯著時代', () => {
    const entries = [
      chrono('公開年', 4),
      chrono('隱藏年', 99, { requiresFlags: ['nope'] }),
    ];
    const top = significantChronoPeriods(entries, stateWith({}), 5);
    expect(top.map((e) => e.name)).toEqual(['公開年']);
  });
});

// ── 不截短（S7-C 驗收定案） ────────────────────────────────────────

describe('htmlToLines', () => {
  it('按 block 邊界切段、剝標記、濾空段', () => {
    const lines = htmlToLines(
      '<p>第一段內容</p><p></p><p>第二段<strong>粗體</strong>內容</p><ul><li>條列一</li><li>條列二</li></ul>'
    );
    expect(lines).toEqual([
      '第一段內容',
      '第二段 粗體 內容',
      '條列一',
      '條列二',
    ]);
  });

  it('br 也是切點；長文完整保留不截短', () => {
    const long = 'Ａ'.repeat(300);
    const lines = htmlToLines(`<p>短行<br/>${long}</p>`);
    expect(lines).toEqual(['短行', long]);
    expect(lines[1]).toHaveLength(300);
  });
});

// ── Tab 補全候選（S7-C 驗收回饋） ──────────────────────────────────

describe('completeInput', () => {
  const entries: TerminalIndexEntry[] = [
    indexEntry({
      name: '艾斯維爾·科索諾 Xavier Colsono',
      entityKey: 'xavier-colsono',
    }),
    indexEntry({ name: '諾薇亞 Novia', entityKey: 'novia' }),
    indexEntry({ name: '舊礦山 Old Mine Site' }),
    indexEntry({
      name: '未解鎖角色',
      baseGate: { requiresFlags: ['nope'] },
    }),
    indexEntry({ name: '諾薇亞 Novia', stack: 'browser' }), // 同名跨 stack
  ];

  it('空輸入與 query 空參數 → 空候選（預設空，不倒全部）', () => {
    expect(completeInput('', entries, stateWith({}))).toEqual([]);
    expect(completeInput('query ', entries, stateWith({}))).toEqual([]);
    expect(completeInput('query', entries, stateWith({}))).toEqual([]);
  });

  it('指令前綴補全（cl → clear）', () => {
    expect(completeInput('cl', entries, stateWith({}))).toContain('clear');
    expect(completeInput('q', entries, stateWith({}))).toContain('query ');
  });

  it('ls 參數補全（含裸 ls 與部分參數）', () => {
    expect(completeInput('ls ', entries, stateWith({}))).toEqual([
      'ls log',
      'ls browser',
      'ls clock',
      'ls compare',
    ]);
    expect(completeInput('ls c', entries, stateWith({}))).toEqual([
      'ls clock',
      'ls compare',
    ]);
  });

  it('query 條目補全：name/entityKey 皆可，未解鎖不出現、同名去重', () => {
    const byKey = completeInput('query xavier', entries, stateWith({}));
    expect(byKey).toEqual(['query 艾斯維爾·科索諾 Xavier Colsono']);

    const byName = completeInput('query 諾薇亞', entries, stateWith({}));
    expect(byName).toEqual(['query 諾薇亞 Novia']); // 跨 stack 同名只一筆

    const locked = completeInput('query 未解鎖', entries, stateWith({}));
    expect(locked).toEqual([]);
  });

  it('query 中段比對補位（includes 排在 startsWith 之後）', () => {
    const hits = completeInput('query no', entries, stateWith({}));
    // novia 是 entityKey startsWith；Colsono 是 name includes
    expect(hits[0]).toBe('query 諾薇亞 Novia');
    expect(hits).toContain('query 艾斯維爾·科索諾 Xavier Colsono');
  });

  it('query 別名比對（S7-D-2）：alias 命中回傳條目名', () => {
    const withAlias = [
      ...entries,
      indexEntry({
        name: '瑞斯可·亞克 Rethiscor Yaakov',
        entityKey: 'rethiscor-yaakov',
        aliases: ['主人'],
      }),
    ];
    expect(completeInput('query 主人', withAlias, stateWith({}))).toEqual([
      'query 瑞斯可·亞克 Rethiscor Yaakov',
    ]);
  });

  it('裸字：只補指令前綴，不倒出條目候選（裸名提交仍為 query 語意）', () => {
    // 條目名裸字 → 無指令命中 → 空候選（不列條目）
    expect(completeInput('舊礦', entries, stateWith({}))).toEqual([]);
    // 任意單字元（如 s）也不得倒出條目清單
    expect(completeInput('s', entries, stateWith({}))).toEqual([]);
    // 指令前綴照常補全
    expect(completeInput('l', entries, stateWith({}))).toEqual(['ls ']);
  });

  it('limit 截斷', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      indexEntry({ name: `條目${String(i).padStart(2, '0')}` })
    );
    expect(completeInput('query 條目', many, stateWith({}), 8)).toHaveLength(8);
  });
});

// ── ls 層級式頂層（S7-C 驗收回饋二輪） ─────────────────────────────

describe('summarizeCategories', () => {
  const entries: TerminalIndexEntry[] = [
    indexEntry({ name: '甲', category: '人物', group: '命運織者' }),
    indexEntry({ name: '乙', category: '人物', group: '總務高層' }),
    indexEntry({ name: '丙', category: '地點' }),
    indexEntry({ name: '丁' }),
    indexEntry({
      name: '鎖',
      category: '人物',
      baseGate: { requiresFlags: ['nope'] },
    }),
  ];

  it('同 category 跨 group 合併計數；無分類歸空字串', () => {
    const { categories, unlockedCount, total } = summarizeCategories(
      entries,
      'dossier',
      stateWith({})
    );
    expect(total).toBe(5);
    expect(unlockedCount).toBe(4);
    expect(categories).toEqual([
      { category: '人物', count: 2 }, // 鎖定條目不計
      { category: '地點', count: 1 },
      { category: '', count: 1 },
    ]);
  });
});
