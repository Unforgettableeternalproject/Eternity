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
  { stack: 'dossier', pageId: 'concepts/eb/records', entityKey: 'eb-turnauto' },
  { stack: 'dossier', pageId: 'concepts/eb/records', entityKey: 'eb-archived' },
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

/**
 * Echoes zone 索引（worker 以 sort_order ASC 產出，故陣列順序 = 「最早」）。
 * eb-nobinding 掛兩首：預設回退必須穩定取第一首。
 */
const ECHOES_INDEX = [
  // 轉正角色：反派曲無條件、轉正曲有 gate。dossier 完全不必寫綁定
  {
    id: 'echoes/eb/turn-villain',
    entityKey: 'eb-turnauto',
    locked: false,
  },
  {
    id: 'echoes/eb/turn-hero',
    entityKey: 'eb-turnauto',
    gate: { requiresFlags: ['eb-turnauto:turned'] },
    locked: false,
  },
  // 劇情歌走 storyKey，不該被當成任何實體的預設
  { id: 'echoes/eb/story', storyKey: 'eb-story-spot', locked: false },
  // 靜態封存凌駕 gate
  { id: 'echoes/eb/archived', entityKey: 'eb-archived', locked: true },
  { id: 'echoes/eb/nobinding-only', entityKey: 'eb-nobinding', locked: false },
];

const PAGE_DATA: Record<string, unknown> = {
  'concepts/eb/records': dossierPage([
    TURNCOAT,
    SEALED,
    NO_BINDING,
    BASE_ONLY,
    BASE_THEN_REV,
    { name: '自動轉正角色', entityKey: 'eb-turnauto' },
    { name: '封存角色', entityKey: 'eb-archived' },
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
      if (url.includes('/api/echoes/entity-index')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ ok: true, data: { entries: ECHOES_INDEX } }),
        });
      }
      if (url.includes('/api/visuals/entity-index')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { entries: [] } }),
        });
      }
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
    expect(result).toEqual({ id: 'echoes/eb/villain' });
  });

  it('通過轉正 gate 後同一個 entityKey 給轉正曲', async () => {
    const result = await resolveEntityBinding(
      'eb-turncoat',
      'echoes',
      stateWith(['eb-turncoat:turned'])
    );
    expect(result).toEqual({ id: 'echoes/eb/hero' });
  });

  it('同一條 revision 可同時切換 echoes 與 visuals', async () => {
    const progress = stateWith(['eb-turncoat:turned']);
    expect(
      await resolveEntityBinding('eb-turncoat', 'visuals', progress)
    ).toEqual({ id: 'visuals/eb/after' });
  });

  it('該 zone 沒有綁定時回 null（visuals 在 base 階段未登記）', async () => {
    const result = await resolveEntityBinding(
      'eb-turncoat',
      'visuals',
      stateWith()
    );
    expect(result).toBeNull();
  });
});

describe('resolveEntityBinding — 條目層級的初始綁定', () => {
  it('沒有任何 revision 也能綁定（不必為了綁定開一條 gate: null 的 revision）', async () => {
    expect(
      await resolveEntityBinding('eb-baseonly', 'echoes', stateWith())
    ).toEqual({ id: 'echoes/eb/only-theme' });
    expect(
      await resolveEntityBinding('eb-baseonly', 'visuals', stateWith())
    ).toEqual({ id: 'visuals/eb/only-art' });
  });

  it('revision 通過後覆蓋條目層級的初始指向', async () => {
    expect(
      await resolveEntityBinding('eb-basethenrev', 'echoes', stateWith())
    ).toEqual({ id: 'echoes/eb/before' });
    expect(
      await resolveEntityBinding(
        'eb-basethenrev',
        'echoes',
        stateWith(['eb-basethenrev:after'])
      )
    ).toEqual({ id: 'echoes/eb/after' });
  });

  it('revision 沒動到的 zone 維持條目層級的值', async () => {
    expect(
      await resolveEntityBinding(
        'eb-baseonly',
        'visuals',
        stateWith(['eb-basethenrev:after'])
      )
    ).toEqual({ id: 'visuals/eb/only-art' });
  });
});

describe('resolveEntityBinding — 孤兒規則', () => {
  it('沒有任何 dossier 條目 → null（孤兒）', async () => {
    const result = await resolveEntityBinding(
      '完全不存在的-key',
      'echoes',
      stateWith()
    );
    expect(result).toBeNull();
  });

  it('只有 browser 條目仍是孤兒——browser 不能替代 dossier 的存在', async () => {
    const result = await resolveEntityBinding(
      'eb-browseronly',
      'echoes',
      stateWith()
    );
    expect(result).toBeNull();
  });

  it('有 dossier 條目但無綁定登記 → 退到同 key 的內容', async () => {
    expect(
      await resolveEntityBinding('eb-nobinding', 'echoes', stateWith())
    ).toEqual({ id: 'echoes/eb/nobinding-only' });
    // 與孤兒的差別：hasDossierEntry 為真
    expect(hasDossierEntry('eb-nobinding', INDEX as never)).toBe(true);
  });

  it('🔑 轉正案例只靠歌自己的 gate——dossier 不寫任何綁定', async () => {
    expect(
      await resolveEntityBinding('eb-turnauto', 'echoes', stateWith())
    ).toEqual({ id: 'echoes/eb/turn-villain' });
    expect(
      await resolveEntityBinding(
        'eb-turnauto',
        'echoes',
        stateWith(['eb-turnauto:turned'])
      )
    ).toEqual({ id: 'echoes/eb/turn-hero' });
  });

  it('gate 未通過的內容不會被推論成預設', async () => {
    // eb-turnauto 未轉正時，轉正曲雖排在後面也不該被選中
    const before = await resolveEntityBinding(
      'eb-turnauto',
      'echoes',
      stateWith()
    );
    expect(before?.id).not.toBe('echoes/eb/turn-hero');
  });

  it('靜態封存（locked）凌駕 gate，不列入預設', async () => {
    expect(
      await resolveEntityBinding('eb-archived', 'echoes', stateWith())
    ).toBeNull();
  });

  it('該 zone 連預設候選都沒有時才是 null', async () => {
    expect(
      await resolveEntityBinding('eb-nobinding', 'visuals', stateWith())
    ).toBeNull();
  });

  it('孤兒不吃預設回退——沒有 dossier 條目就到此為止', async () => {
    // 索引裡有掛 eb-browseronly 的歌也一樣（此 key 只有 browser 條目）
    expect(
      await resolveEntityBinding('eb-browseronly', 'echoes', stateWith())
    ).toBeNull();
  });

  it('明確綁定優先於預設回退', async () => {
    expect(
      await resolveEntityBinding('eb-baseonly', 'echoes', stateWith())
    ).toEqual({ id: 'echoes/eb/only-theme' });
  });

  it('劇情內容（storyKey）不會被當成預設', async () => {
    expect(
      await resolveEntityBinding('eb-story-spot', 'echoes', stateWith())
    ).toBeNull();
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
    expect(result).toEqual({ id: 'echoes/eb/sealed-theme' });
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
