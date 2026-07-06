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
  isIndexEntryUnlocked,
  passedRevisionCount,
  resolveStackAlias,
  queryIndex,
  findByEntityKey,
  listStackEntries,
  stripHtml,
  truncate,
  resolveEntryDetails,
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
  const gated = indexEntry({
    name: '艾斯維爾',
    entityKey: 'xavier-colsono',
    revisionGates: [
      { id: 'base', gate: null },
      { id: 'xavier:01', gate: { requiresFlags: ['xavier:01'] } },
      { id: 'xavier:02', gate: { requiresFlags: ['xavier:02'] } },
    ],
  });
  const fullyGated = indexEntry({
    name: '隱藏人物',
    revisionGates: [{ id: 'r1', gate: { requiresFlags: ['secret:01'] } }],
  });

  it('無 gate 摘要 = 無進度閘', () => {
    expect(
      isIndexEntryUnlocked(indexEntry({ name: '普通' }), stateWith({}))
    ).toBe(true);
  });

  it('base 無 gate → 初始即解鎖；全 gated 條目未持旗標 → 隱藏', () => {
    expect(isIndexEntryUnlocked(gated, stateWith({}))).toBe(true);
    expect(isIndexEntryUnlocked(fullyGated, stateWith({}))).toBe(false);
    expect(
      isIndexEntryUnlocked(fullyGated, stateWith({ flags: ['secret:01'] }))
    ).toBe(true);
  });

  it('觀測者 bypass requiresFlags', () => {
    expect(
      isIndexEntryUnlocked(
        fullyGated,
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
      revisionGates: [{ id: 'r1', gate: { requiresFlags: ['no:01'] } }],
    }),
    indexEntry({ name: '原質', stack: 'diff' }),
    indexEntry({ name: '月桂 Laurel', stack: 'browser' }),
  ];

  it('name substring 比對（case-insensitive）', () => {
    expect(queryIndex(entries, 'xavier', stateWith({}))).toHaveLength(1);
    expect(queryIndex(entries, '艾斯維爾', stateWith({}))).toHaveLength(1);
    expect(queryIndex(entries, 'XAVIER', stateWith({}))).toHaveLength(1);
  });

  it('entityKey 也可比對，且帶 key 條目排前', () => {
    // 'l' 同時命中 'Xavier Colsono'（帶 key）與 '月桂 Laurel'（無 key）
    const hits = queryIndex(entries, 'l', stateWith({}));
    expect(hits).toHaveLength(2);
    expect(hits[0].entityKey).toBe('xavier-colsono');
    expect(hits[1].name).toBe('月桂 Laurel');
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
        revisionGates: [{ id: 'r1', gate: { requiresFlags: ['no:01'] } }],
      }),
      indexEntry({ name: '丙', stack: 'diff' }),
    ];
    const result = listStackEntries(entries, 'dossier', stateWith({}));
    expect(result.total).toBe(2);
    expect(result.unlocked.map((e) => e.name)).toEqual(['甲']);
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
      name: '諾薇亞 (Norvia)',
      entityKey: 'norvia',
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
                    name: '諾薇亞 (Norvia)',
                    entityKey: 'norvia',
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
});
