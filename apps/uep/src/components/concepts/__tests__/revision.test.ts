/**
 * concepts/revision 測試 — Effective View Resolver（Epic 2 S7）
 *
 * 驗證四件事：
 * 1. applyDotPath/removeDotPath：dot-notation 路徑操作 + 污染防禦
 * 2. applyRevisions：patch 疊加語意（set/remove、宣告順序、deep clone）
 * 3. isEntryUnlocked：「未解鎖條目 = 隱藏」守門 + 觀測者 bypass
 * 4. resolveEffectiveViewForPage：四種 stack 的遍歷/過濾/舊格式相容
 */

import { describe, it, expect } from 'vitest';

import { createInitialState } from '../../../progress/types';
import type { ProgressState } from '../../../progress/types';
import {
  applyDotPath,
  removeDotPath,
  applyRevisions,
  isEntryUnlocked,
  isDossierContent,
  isBrowserContent,
  isChronoContent,
  isDiffContent,
  resolveEffectiveViewForPage,
} from '../revision';
import type {
  BrowserContent,
  ChronoContent,
  ConceptsRevision,
  DiffContent,
  DossierContent,
} from '../types';

function stateWith(partial: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...partial };
}

// ── applyDotPath / removeDotPath ──────────────────────────────────

describe('applyDotPath', () => {
  it('頂層欄位設值', () => {
    const obj: Record<string, unknown> = { name: '舊' };
    applyDotPath(obj, 'name', '新');
    expect(obj.name).toBe('新');
  });

  it('巢狀路徑設值（basic.種族）', () => {
    const obj: Record<string, unknown> = { basic: { 種族: '人類' } };
    applyDotPath(obj, 'basic.種族', '未知');
    expect((obj.basic as Record<string, unknown>)['種族']).toBe('未知');
  });

  it('中間節點不存在時自動建立物件', () => {
    const obj: Record<string, unknown> = {};
    applyDotPath(obj, 'basic.能力', '?');
    expect((obj.basic as Record<string, unknown>)['能力']).toBe('?');
  });

  it('陣列索引路徑（sections.0.content_html）', () => {
    const obj: Record<string, unknown> = {
      sections: [{ label: '背景', content_html: '<p>舊</p>' }],
    };
    applyDotPath(obj, 'sections.0.content_html', '<p>新</p>');
    expect((obj.sections as { content_html: string }[])[0].content_html).toBe(
      '<p>新</p>'
    );
  });

  it('中間節點是 primitive 時放棄操作（不覆蓋）', () => {
    const obj: Record<string, unknown> = { basic: 'primitive' };
    applyDotPath(obj, 'basic.種族', '未知');
    expect(obj.basic).toBe('primitive');
  });

  it('__proto__ 污染路徑被擋下', () => {
    const obj: Record<string, unknown> = {};
    applyDotPath(obj, '__proto__.polluted', true);
    applyDotPath(obj, 'a.__proto__.polluted', true);
    applyDotPath(obj, 'constructor.prototype.polluted', true);
    expect(
      ({} as Record<string, unknown>).polluted,
      'Object prototype 不可被污染'
    ).toBeUndefined();
    expect(Object.keys(obj)).toEqual([]);
  });
});

describe('removeDotPath', () => {
  it('刪除頂層與巢狀欄位；不存在的路徑安靜跳過', () => {
    const obj: Record<string, unknown> = {
      spoiler: 2,
      basic: { 能力: '?', 出處: '三區' },
    };
    removeDotPath(obj, 'spoiler');
    removeDotPath(obj, 'basic.能力');
    removeDotPath(obj, 'nothing.here');
    expect(obj.spoiler).toBeUndefined();
    expect(obj.basic).toEqual({ 出處: '三區' });
  });
});

// ── applyRevisions ────────────────────────────────────────────────

const XAVIER_R1: ConceptsRevision = {
  id: 'xavier-colsono:01',
  gate: { requiresFlags: ['xavier-colsono:01'] },
  patch: { set: { content_html: '<p>叛逃事件的中心人物。</p>' } },
};

const XAVIER_R2: ConceptsRevision = {
  id: 'xavier-colsono:02',
  gate: { requiresFlags: ['xavier-colsono:02'] },
  patch: {
    set: { content_html: '<p>已離開叛亂者監獄。</p>', name: '？？？' },
    remove: ['spoiler'],
  },
};

const baseEntry = () => ({
  name: '艾斯維爾·科索諾 Xavier Colsono',
  content_html: '<p>?</p>',
  spoiler: 1,
});

describe('applyRevisions', () => {
  it('無 revisions → 回傳 base 等值 clone（不共用引用）', () => {
    const base = { name: 'a', nested: { x: 1 } };
    const out = applyRevisions(base, undefined, stateWith({}));
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
    expect(out.nested).not.toBe(base.nested);
  });

  it('gate 未通過的 revision 不套用', () => {
    const out = applyRevisions(baseEntry(), [XAVIER_R1], stateWith({}));
    expect(out.content_html).toBe('<p>?</p>');
  });

  it('單 revision 通過 → set 套用', () => {
    const out = applyRevisions(
      baseEntry(),
      [XAVIER_R1],
      stateWith({ flags: ['xavier-colsono:01'] })
    );
    expect(out.content_html).toBe('<p>叛逃事件的中心人物。</p>');
    expect(out.name).toBe('艾斯維爾·科索諾 Xavier Colsono'); // 未動欄位保留
  });

  it('多 revision 依宣告順序累積（後蓋前）+ remove 刪除欄位', () => {
    const out = applyRevisions(
      baseEntry(),
      [XAVIER_R1, XAVIER_R2],
      stateWith({ flags: ['xavier-colsono:01', 'xavier-colsono:02'] })
    );
    expect(out.content_html).toBe('<p>已離開叛亂者監獄。</p>');
    expect(out.name).toBe('？？？');
    expect(out.spoiler).toBeUndefined();
  });

  it('亂序解鎖（持 02 不持 01）→ 仍按宣告順序、通過就套，結果確定', () => {
    const out = applyRevisions(
      baseEntry(),
      [XAVIER_R1, XAVIER_R2],
      stateWith({ flags: ['xavier-colsono:02'] })
    );
    // R1 跳過、R2 套用
    expect(out.content_html).toBe('<p>已離開叛亂者監獄。</p>');
    expect(out.spoiler).toBeUndefined();
  });

  it('不修改原始 base 資料（deep clone）', () => {
    const base = baseEntry();
    applyRevisions(
      base,
      [XAVIER_R1, XAVIER_R2],
      stateWith({ flags: ['xavier-colsono:01', 'xavier-colsono:02'] })
    );
    expect(base.content_html).toBe('<p>?</p>');
    expect(base.spoiler).toBe(1);
  });

  it('patch.set 的值不與輸出共用引用（防多條目共用 patch 物件）', () => {
    const sharedSections = [{ label: 'x', content_html: '<p>共用</p>' }];
    const rev: ConceptsRevision = {
      id: 'r',
      gate: null,
      patch: { set: { sections: sharedSections } },
    };
    const out = applyRevisions(
      { name: 'a' } as Record<string, unknown>,
      [rev],
      stateWith({})
    );
    expect(out.sections).toEqual(sharedSections);
    expect(out.sections).not.toBe(sharedSections);
  });

  it('觀測者 bypass requiresFlags → 所有 revision 全套用', () => {
    const out = applyRevisions(
      baseEntry(),
      [XAVIER_R1, XAVIER_R2],
      stateWith({ view: 'observer', observerEver: true })
    );
    expect(out.content_html).toBe('<p>已離開叛亂者監獄。</p>');
  });
});

// ── isEntryUnlocked ───────────────────────────────────────────────

describe('isEntryUnlocked', () => {
  it('無 revisions / 空陣列 → 永遠解鎖', () => {
    expect(isEntryUnlocked(undefined, stateWith({}))).toBe(true);
    expect(isEntryUnlocked([], stateWith({}))).toBe(true);
  });

  it('首個 revision gate=null → base 無條件可見', () => {
    const revs: ConceptsRevision[] = [{ id: 'base', gate: null, patch: {} }];
    expect(isEntryUnlocked(revs, stateWith({}))).toBe(true);
  });

  it('全部 gate 未通過 → 隱藏；任一通過 → 可見', () => {
    const revs = [XAVIER_R1, XAVIER_R2];
    expect(isEntryUnlocked(revs, stateWith({}))).toBe(false);
    expect(
      isEntryUnlocked(revs, stateWith({ flags: ['xavier-colsono:02'] }))
    ).toBe(true);
  });

  it('觀測者 bypass requiresFlags → 可見', () => {
    expect(
      isEntryUnlocked(
        [XAVIER_R1],
        stateWith({ view: 'observer', observerEver: true })
      )
    ).toBe(true);
  });

  it('pristineOnly 條目：觀測者不 bypass（印記代價）', () => {
    const revs: ConceptsRevision[] = [
      { id: 'p', gate: { pristineOnly: true }, patch: {} },
    ];
    expect(isEntryUnlocked(revs, stateWith({}))).toBe(true);
    expect(
      isEntryUnlocked(revs, stateWith({ view: 'observer', observerEver: true }))
    ).toBe(false);
    expect(isEntryUnlocked(revs, stateWith({ observerEver: true }))).toBe(
      false
    );
  });

  it('base gate（S7 驗收 #4）：未過隱藏、通過可見', () => {
    const baseGate = { requiresFlags: ['met:xavier'] };
    expect(isEntryUnlocked(undefined, stateWith({}), baseGate)).toBe(false);
    expect(
      isEntryUnlocked(undefined, stateWith({ flags: ['met:xavier'] }), baseGate)
    ).toBe(true);
    // null / 未定義 = 無 base gate（舊語意）
    expect(isEntryUnlocked(undefined, stateWith({}), null)).toBe(true);
  });

  it('base gate 未過但任一 revision gate 通過 → 仍可見（後期揭露）', () => {
    const baseGate = { requiresFlags: ['met:xavier'] };
    expect(
      isEntryUnlocked(
        [XAVIER_R2],
        stateWith({ flags: ['xavier-colsono:02'] }),
        baseGate
      )
    ).toBe(true);
    expect(isEntryUnlocked([XAVIER_R2], stateWith({}), baseGate)).toBe(false);
  });

  it('base gate：觀測者 bypass requiresFlags → 可見', () => {
    const baseGate = { requiresFlags: ['met:xavier'] };
    expect(
      isEntryUnlocked(
        undefined,
        stateWith({ view: 'observer', observerEver: true }),
        baseGate
      )
    ).toBe(true);
  });

  it('baseVisible=true → 無視 base gate 與 revision gate，一律可見', () => {
    // 全部 revision gate 未過（無 baseVisible 會隱藏）
    expect(
      isEntryUnlocked([XAVIER_R1, XAVIER_R2], stateWith({}), null, true)
    ).toBe(true);
    // base gate 未過也一樣可見
    const baseGate = { requiresFlags: ['met:xavier'] };
    expect(isEntryUnlocked(undefined, stateWith({}), baseGate, true)).toBe(
      true
    );
    // baseVisible=false 走原語意
    expect(
      isEntryUnlocked([XAVIER_R1, XAVIER_R2], stateWith({}), null, false)
    ).toBe(false);
  });
});

// ── type guards + resolveEffectiveViewForPage ─────────────────────

const dossierData = (): DossierContent => ({
  variants: [
    {
      id: 'u',
      label: 'U',
      subcategories: [
        {
          label: '三區',
          groups: [
            {
              label: '無組織',
              entries: [
                { name: '奧蘭 Orland' },
                {
                  name: '艾斯維爾·科索諾 Xavier Colsono',
                  entityKey: 'xavier-colsono',
                  revisions: [XAVIER_R1],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

const browserData = (): BrowserContent => ({
  profiles: [
    {
      name: '艾斯維爾·科索諾 (Xavier Colsono)',
      placeholder: true,
      entityKey: 'xavier-colsono',
      revisions: [
        {
          id: 'xavier-colsono:01',
          gate: null, // placeholder 佔位語意：base 無條件可見（鎖定佔位）
          patch: {},
        },
        {
          id: 'xavier-colsono:02',
          gate: { requiresFlags: ['xavier-colsono:01'] },
          patch: {
            set: {
              placeholder: false,
              basic: { 出處: '三區' },
              'sections.0.content_html': '<p>已揭露的背景。</p>',
            },
          },
        },
      ],
      sections: [{ label: '角色背景', content_html: '<p>???</p>' }],
    },
  ],
});

const chronoData = (): ChronoContent => ({
  fieldDefs: [{ id: 'main', icon: '☀', label: '主線事件', style: 'flat' }],
  periods: [
    {
      era: 'ad',
      yearNum: 420,
      year: 'AD 0420',
      fields: { main: { items: ['？？？'] } },
      entityKey: 'incident-0420',
      revisions: [
        { id: 'base', gate: null, patch: {} },
        {
          id: 'incident-0420:01',
          gate: { requiresFlags: ['incident-0420:01'] },
          patch: { set: { 'fields.main.items': ['六月十九日叛逃事件'] } },
        },
      ],
    },
  ],
});

const diffData = (): DiffContent => ({
  subcategories: [
    {
      label: '理論',
      sections: [
        {
          label: '未被歸類',
          entries: [
            { term: '魔法', values: ['一種特殊能量釋放現象。'] },
            {
              term: '原質',
              values: ['？？？'],
              entityKey: 'essence',
              revisions: [
                {
                  id: 'essence:01',
                  gate: { requiresFlags: ['essence:01'] },
                  patch: { set: { values: ['構成萬物的最基本單位。'] } },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe('type guards', () => {
  it('四種 stack 互斥辨識', () => {
    const d = dossierData();
    const b = browserData();
    const c = chronoData();
    const f = diffData();
    expect([
      isDossierContent(d),
      isBrowserContent(d),
      isChronoContent(d),
      isDiffContent(d),
    ]).toEqual([true, false, false, false]);
    expect(isBrowserContent(b)).toBe(true);
    expect(isDiffContent(b)).toBe(false);
    expect(isChronoContent(c)).toBe(true);
    expect(isDiffContent(f)).toBe(true);
    expect(isDossierContent(f)).toBe(false);
  });
});

describe('resolveEffectiveViewForPage', () => {
  it('dossier：未解鎖條目被過濾、解鎖條目 patch 套用、revisions 剝除', () => {
    const locked = resolveEffectiveViewForPage(dossierData(), stateWith({}));
    const entries0 = locked.variants[0].subcategories[0].groups[0].entries;
    expect(entries0.map((e) => e.name)).toEqual(['奧蘭 Orland']);

    const unlocked = resolveEffectiveViewForPage(
      dossierData(),
      stateWith({ flags: ['xavier-colsono:01'] })
    );
    const entries1 = unlocked.variants[0].subcategories[0].groups[0].entries;
    expect(entries1).toHaveLength(2);
    const xavier = entries1[1];
    expect(xavier.content_html).toBe('<p>叛逃事件的中心人物。</p>');
    expect(xavier.entityKey).toBe('xavier-colsono'); // entityKey 保留
    expect(xavier.revisions).toBeUndefined(); // revisions 剝除
  });

  it('browser：placeholder base 可見，旗標後 patch 揭露內容', () => {
    const locked = resolveEffectiveViewForPage(browserData(), stateWith({}));
    expect(locked.profiles).toHaveLength(1); // base gate=null → 佔位可見
    expect(locked.profiles[0].placeholder).toBe(true);

    const unlocked = resolveEffectiveViewForPage(
      browserData(),
      stateWith({ flags: ['xavier-colsono:01'] })
    );
    const profile = unlocked.profiles[0];
    expect(profile.placeholder).toBe(false);
    expect(profile.basic).toEqual({ 出處: '三區' });
    expect(profile.sections?.[0].content_html).toBe('<p>已揭露的背景。</p>');
  });

  it('chrono：event 粒度 patch 替換事件列', () => {
    const locked = resolveEffectiveViewForPage(chronoData(), stateWith({}));
    expect(locked.periods[0].fields.main.items).toEqual(['？？？']);

    const unlocked = resolveEffectiveViewForPage(
      chronoData(),
      stateWith({ flags: ['incident-0420:01'] })
    );
    expect(unlocked.periods[0].fields.main.items).toEqual([
      '六月十九日叛逃事件',
    ]);
  });

  it('diff：未解鎖條目過濾 + values 整段替換', () => {
    const locked = resolveEffectiveViewForPage(diffData(), stateWith({}));
    expect(
      locked.subcategories[0].sections[0].entries.map((e) => e.term)
    ).toEqual(['魔法']);

    const unlocked = resolveEffectiveViewForPage(
      diffData(),
      stateWith({ flags: ['essence:01'] })
    );
    const essence = unlocked.subcategories[0].sections[0].entries[1];
    expect(essence.values).toEqual(['構成萬物的最基本單位。']);
  });

  it('舊格式資料（條目全無 revisions）內容等值通過', () => {
    const legacy: DiffContent = {
      subcategories: [
        {
          label: '理論',
          sections: [
            { label: '', entries: [{ term: '魔力', values: ['能量單元'] }] },
          ],
        },
      ],
    };
    const out = resolveEffectiveViewForPage(legacy, stateWith({}));
    expect(out).toEqual(legacy);
  });

  it('觀測者：全部條目可見且全 revision 套用', () => {
    const out = resolveEffectiveViewForPage(
      dossierData(),
      stateWith({ view: 'observer', observerEver: true })
    );
    const entries = out.variants[0].subcategories[0].groups[0].entries;
    expect(entries).toHaveLength(2);
    expect(entries[1].content_html).toBe('<p>叛逃事件的中心人物。</p>');
  });

  it('dossier：base gate 未過的條目隱藏，通過後可見且剝除 gate（S7 驗收 #4）', () => {
    const data: DossierContent = {
      variants: [
        {
          id: 'u',
          label: 'U',
          subcategories: [
            {
              label: '三區',
              groups: [
                {
                  label: '',
                  entries: [
                    { name: '甲', gate: { requiresFlags: ['met:a'] } },
                    { name: '乙' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const locked = resolveEffectiveViewForPage(data, stateWith({}));
    expect(
      locked.variants[0].subcategories[0].groups[0].entries.map((e) => e.name)
    ).toEqual(['乙']);

    const unlocked = resolveEffectiveViewForPage(
      data,
      stateWith({ flags: ['met:a'] })
    );
    const entries = unlocked.variants[0].subcategories[0].groups[0].entries;
    expect(entries.map((e) => e.name)).toEqual(['甲', '乙']);
    expect(entries[0].gate).toBeUndefined();
  });

  it('dossier：群組 gate 未過整組隱藏（S7 驗收 #3）', () => {
    const data: DossierContent = {
      variants: [
        {
          id: 'u',
          label: 'U',
          subcategories: [
            {
              label: '三區',
              groups: [
                { label: '公開', entries: [{ name: '甲' }] },
                {
                  label: '機密',
                  gate: { requiresFlags: ['sec:01'] },
                  entries: [{ name: '乙' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const locked = resolveEffectiveViewForPage(data, stateWith({}));
    expect(
      locked.variants[0].subcategories[0].groups.map((g) => g.label)
    ).toEqual(['公開']);

    const unlocked = resolveEffectiveViewForPage(
      data,
      stateWith({ flags: ['sec:01'] })
    );
    expect(
      unlocked.variants[0].subcategories[0].groups.map((g) => g.label)
    ).toEqual(['公開', '機密']);

    // 觀測者 bypass requiresFlags → 群組可見
    const observer = resolveEffectiveViewForPage(
      data,
      stateWith({ view: 'observer', observerEver: true })
    );
    expect(observer.variants[0].subcategories[0].groups).toHaveLength(2);
  });

  it('dossier：baseVisible=true 的條目即使全 revision gate 未過仍可見（base 預設顯示）', () => {
    const data: DossierContent = {
      variants: [
        {
          id: 'u',
          label: 'U',
          subcategories: [
            {
              label: '三區',
              groups: [
                {
                  label: '',
                  entries: [
                    {
                      name: '一個人',
                      entityKey: 'a-man',
                      baseVisible: true,
                      content_html: '<p>他是一個普通人</p>',
                      revisions: [
                        {
                          id: 'a-man:01',
                          gate: { requiresFlags: ['progress:man'] },
                          patch: {
                            set: {
                              content_html: '<p>他現在是一個更好的人</p>',
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
    };
    // 無旗標：base 內容可見、patch 未套用、baseVisible 剝除
    const locked = resolveEffectiveViewForPage(data, stateWith({}));
    const entry = locked.variants[0].subcategories[0].groups[0].entries[0];
    expect(entry.name).toBe('一個人');
    expect(entry.content_html).toBe('<p>他是一個普通人</p>');
    expect(entry.baseVisible).toBeUndefined();

    // 旗標到位：patch 照常套用
    const unlocked = resolveEffectiveViewForPage(
      data,
      stateWith({ flags: ['progress:man'] })
    );
    expect(
      unlocked.variants[0].subcategories[0].groups[0].entries[0].content_html
    ).toBe('<p>他現在是一個更好的人</p>');
  });
});
