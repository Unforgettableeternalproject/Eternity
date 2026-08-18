import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  resolveEntityBinding,
  hasDossierEntry,
  isOrphanEntityKey,
  invalidateEntityBindingCache,
} from '../entityBinding';
import type { ProgressState } from '../../../progress/types';

/**
 * entity 一對多綁定求值測試（T-7）
 *
 * 最重要的一條是「dossier 條目未解鎖但綁定仍生效」——那條若失敗，
 * 代表有人把 isEntryUnlocked 加回求值路徑，孤兒規則就會退化成
 * 「entity 反查依賴 Concepts 解鎖進度」（違反 2026-08-15 定案規則二）。
 */

function stateWith(flags: string[] = []): ProgressState {
  return {
    flags,
    view: 'explorer',
    observerEver: false,
  } as unknown as ProgressState;
}

/** dossier 頁的巢狀結構包裝 */
function dossierPage(entries: unknown[], variantId = 'u') {
  return {
    variants: [
      {
        id: variantId,
        subcategories: [{ label: '人物', groups: [{ label: '', entries }] }],
      },
    ],
  };
}

/** 轉正角色：base → 反派曲，turned → 轉正曲 */
const TURNCOAT = {
  name: '轉正角色',
  entityKey: 'eb-turncoat',
  revisions: [
    {
      id: 'base',
      gate: null,
      patch: { set: { 'bindings.echoes': 'echoes/eb/villain' } },
    },
    {
      id: 'eb-turncoat:turned',
      gate: { requiresFlags: ['eb-turncoat:turned'] },
      patch: {
        set: {
          'bindings.echoes': 'echoes/eb/hero',
          'bindings.visuals': 'visuals/eb/after',
        },
      },
    },
  ],
};

/** 有 baseGate（未解鎖）但登記了綁定——回歸鎖用 */
const SEALED = {
  name: '未解鎖角色',
  entityKey: 'eb-sealed',
  gate: { requiresFlags: ['eb-sealed:met'] },
  revisions: [
    {
      id: 'base',
      gate: null,
      patch: { set: { 'bindings.echoes': 'echoes/eb/sealed-theme' } },
    },
  ],
};

/** 只用條目層級 bindings，完全沒有 revision 鏈 */
const BASE_ONLY = {
  name: '單曲角色',
  entityKey: 'eb-baseonly',
  bindings: { echoes: 'echoes/eb/only-theme', visuals: 'visuals/eb/only-art' },
};

/** 條目層級 bindings 打底，revision 之後改指向 */
const BASE_THEN_REV = {
  name: '換曲角色',
  entityKey: 'eb-basethenrev',
  bindings: { echoes: 'echoes/eb/before' },
  revisions: [
    {
      id: 'eb-basethenrev:after',
      gate: { requiresFlags: ['eb-basethenrev:after'] },
      patch: { set: { 'bindings.echoes': 'echoes/eb/after' } },
    },
  ],
};

/** 有 dossier 條目但沒有任何綁定登記 */
const NO_BINDING = {
  name: '無綁定角色',
  entityKey: 'eb-nobinding',
  revisions: [
    {
      id: 'eb-nobinding:01',
      gate: null,
      patch: { set: { 'basic.陣營': '同盟' } },
    },
  ],
};

const INDEX = [
  { stack: 'dossier', pageId: 'concepts/eb/records', entityKey: 'eb-turncoat' },
  { stack: 'dossier', pageId: 'concepts/eb/records', entityKey: 'eb-sealed' },
  {
    stack: 'dossier',
    pageId: 'concepts/eb/records',
    entityKey: 'eb-nobinding',
  },
  { stack: 'dossier', pageId: 'concepts/eb/records', entityKey: 'eb-baseonly' },
  {
    stack: 'dossier',
    pageId: 'concepts/eb/records',
    entityKey: 'eb-basethenrev',
  },
  // 只有 browser 條目——孤兒（browser 不能替代 dossier 的「存在」）
  {
    stack: 'browser',
    pageId: 'concepts/eb/browser',
    entityKey: 'eb-browseronly',
  },
];

const PAGE_DATA: Record<string, unknown> = {
  'concepts/eb/records': dossierPage([
    TURNCOAT,
    SEALED,
    NO_BINDING,
    BASE_ONLY,
    BASE_THEN_REV,
  ]),
  'concepts/eb/browser': {
    profiles: [
      {
        name: '只有 browser 的角色',
        entityKey: 'eb-browseronly',
        revisions: [
          {
            id: 'base',
            gate: null,
            patch: { set: { 'bindings.echoes': 'echoes/eb/should-not' } },
          },
        ],
      },
    ],
  },
};

beforeEach(() => {
  invalidateEntityBindingCache();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/api/concepts/entity-index')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { entries: INDEX } }),
        });
      }
      const match = url.match(/\/api\/content\/(.+)$/);
      const data = match ? PAGE_DATA[match[1]] : undefined;
      if (!data) return Promise.resolve({ ok: false });
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: {
              content: [{ type: 'dossier', content: JSON.stringify(data) }],
            },
          }),
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveEntityBinding — 隨進度切換指向', () => {
  it('未通過轉正 gate 時給 base 綁定的反派曲', async () => {
    const result = await resolveEntityBinding(
      'eb-turncoat',
      'echoes',
      stateWith()
    );
    expect(result).toEqual({ status: 'bound', id: 'echoes/eb/villain' });
  });

  it('通過轉正 gate 後同一個 entityKey 給轉正曲', async () => {
    const result = await resolveEntityBinding(
      'eb-turncoat',
      'echoes',
      stateWith(['eb-turncoat:turned'])
    );
    expect(result).toEqual({ status: 'bound', id: 'echoes/eb/hero' });
  });

  it('同一條 revision 可同時切換 echoes 與 visuals', async () => {
    const progress = stateWith(['eb-turncoat:turned']);
    expect(
      await resolveEntityBinding('eb-turncoat', 'visuals', progress)
    ).toEqual({ status: 'bound', id: 'visuals/eb/after' });
  });

  it('該 zone 沒有綁定時是 unbound（visuals 在 base 階段未登記）', async () => {
    const result = await resolveEntityBinding(
      'eb-turncoat',
      'visuals',
      stateWith()
    );
    expect(result).toEqual({ status: 'unbound' });
  });
});

describe('resolveEntityBinding — 條目層級的初始綁定', () => {
  it('沒有任何 revision 也能綁定（不必為了綁定開一條 gate: null 的 revision）', async () => {
    expect(
      await resolveEntityBinding('eb-baseonly', 'echoes', stateWith())
    ).toEqual({ status: 'bound', id: 'echoes/eb/only-theme' });
    expect(
      await resolveEntityBinding('eb-baseonly', 'visuals', stateWith())
    ).toEqual({ status: 'bound', id: 'visuals/eb/only-art' });
  });

  it('revision 通過後覆蓋條目層級的初始指向', async () => {
    expect(
      await resolveEntityBinding('eb-basethenrev', 'echoes', stateWith())
    ).toEqual({ status: 'bound', id: 'echoes/eb/before' });
    expect(
      await resolveEntityBinding(
        'eb-basethenrev',
        'echoes',
        stateWith(['eb-basethenrev:after'])
      )
    ).toEqual({ status: 'bound', id: 'echoes/eb/after' });
  });

  it('revision 沒動到的 zone 維持條目層級的值', async () => {
    expect(
      await resolveEntityBinding(
        'eb-baseonly',
        'visuals',
        stateWith(['eb-basethenrev:after'])
      )
    ).toEqual({ status: 'bound', id: 'visuals/eb/only-art' });
  });
});

describe('🔒 回歸鎖：不拿內容自身的 gate 挑指向', () => {
  it('沒有登記綁定就是 unbound——不會去掃同 key 的內容猜一個', async () => {
    // 「綁著但還沒解鎖」必須表達得出來，指向與可見性是正交的兩個軸。
    // 若這條失敗，代表有人把「按 gate 通過與否挑最後一筆」的推論加了回來。
    expect(
      await resolveEntityBinding('eb-nobinding', 'echoes', stateWith())
    ).toEqual({ status: 'unbound' });
  });
});

describe('🔒 回歸鎖：權威資料拿不到時 fail closed', () => {
  // error 若又被壓回 unbound/orphan，呼叫端會退回 by-key 反查——而 by-key
  // 是全表掃描命中第一筆（無 ORDER BY），同 key 多候選時會顯示任意一筆，
  // 繞過 dossier 寫好的明確指向
  it('索引 fetch 失敗回 error，不是 unbound', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down')))
    );
    invalidateEntityBindingCache();
    expect(
      await resolveEntityBinding('eb-turncoat', 'echoes', stateWith())
    ).toEqual({ status: 'error' });
  });

  it('條目頁抓不到回 error，不是 unbound', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/concepts/entity-index')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true, data: { entries: INDEX } }),
          });
        }
        // 索引拿得到、頁面拿不到——不能因此斷言「這個 key 沒綁定」
        return Promise.resolve({ ok: false });
      })
    );
    invalidateEntityBindingCache();
    expect(
      await resolveEntityBinding('eb-turncoat', 'echoes', stateWith())
    ).toEqual({ status: 'error' });
  });
});

describe('resolveEntityBinding — 孤兒規則', () => {
  it('沒有任何 dossier 條目 → orphan', async () => {
    const result = await resolveEntityBinding(
      '完全不存在的-key',
      'echoes',
      stateWith()
    );
    expect(result).toEqual({ status: 'orphan' });
  });

  it('只有 browser 條目仍是孤兒——browser 不能替代 dossier 的存在', async () => {
    const result = await resolveEntityBinding(
      'eb-browseronly',
      'echoes',
      stateWith()
    );
    expect(result).toEqual({ status: 'orphan' });
  });

  it('有 dossier 條目但無綁定登記 → unbound（不是 orphan）', async () => {
    expect(
      await resolveEntityBinding('eb-nobinding', 'echoes', stateWith())
    ).toEqual({ status: 'unbound' });
    // 與孤兒的差別：hasDossierEntry 為真
    expect(hasDossierEntry('eb-nobinding', INDEX as never)).toBe(true);
  });
});

describe('🔒 回歸鎖：判存在性不判可見性', () => {
  it('dossier 條目未解鎖（baseGate 未通過）但綁定仍生效', async () => {
    // 讀者沒有 eb-sealed:met，條目本身在 Concepts 是隱藏的——
    // 但綁定不受影響。若這條失敗，代表 isEntryUnlocked 被加回求值路徑。
    const result = await resolveEntityBinding(
      'eb-sealed',
      'echoes',
      stateWith()
    );
    expect(result).toEqual({ status: 'bound', id: 'echoes/eb/sealed-theme' });
  });
});

describe('hasDossierEntry / isOrphanEntityKey', () => {
  it('只認 dossier stack', () => {
    expect(hasDossierEntry('eb-turncoat', INDEX as never)).toBe(true);
    expect(hasDossierEntry('eb-browseronly', INDEX as never)).toBe(false);
  });

  it('isOrphanEntityKey 在索引取不到時保守回 false，不誤報孤兒', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down')))
    );
    invalidateEntityBindingCache();
    expect(await isOrphanEntityKey('eb-turncoat')).toBe(false);
  });

  it('空字串不算孤兒（未填 key 不該報警示）', async () => {
    expect(await isOrphanEntityKey('')).toBe(false);
  });
});
