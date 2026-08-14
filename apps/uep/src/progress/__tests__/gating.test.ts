/**
 * Gating 三維條件求值器測試
 *
 * 條件矩陣：
 * - requiresFlags（觀測者 bypass）
 * - pristineOnly（觀測者不 bypass）
 * - 兩者組合
 */
import { describe, it, expect } from 'vitest';

import { normalizeState } from '../adapters';
import {
  evaluateGate,
  parseGateCondition,
  isProgressPage,
  isPristine,
  hasAllFlags,
  resolveInProgressContainer,
} from '../gating';
import type { ProgressState } from '../types';
import { createInitialState } from '../types';

/** 建立測試用狀態 */
function makeState(overrides: Partial<ProgressState> = {}): ProgressState {
  return { ...createInitialState(), ...overrides };
}

const pristineExplorer = makeState(); // 純潔探索者
const markedExplorer = makeState({ observerEver: true }); // 有印記的探索者
const observer = makeState({ view: 'observer', observerEver: true }); // 觀測者

describe('isPristine', () => {
  it('純潔探索者為 true', () => {
    expect(isPristine(pristineExplorer)).toBe(true);
  });
  it('有印記的探索者為 false', () => {
    expect(isPristine(markedExplorer)).toBe(false);
  });
  it('觀測者為 false', () => {
    expect(isPristine(observer)).toBe(false);
  });
  it('防禦性：view=observer 但 observerEver=false 時仍為 false', () => {
    expect(isPristine(makeState({ view: 'observer' }))).toBe(false);
  });
});

describe('evaluateGate — 無條件', () => {
  it('null/undefined/空條件一律可見', () => {
    expect(evaluateGate(pristineExplorer, null)).toBe(true);
    expect(evaluateGate(pristineExplorer, undefined)).toBe(true);
    expect(evaluateGate(observer, {})).toBe(true);
  });
});

describe('evaluateGate — requiresFlags', () => {
  const cond = { requiresFlags: ['met:asvere', 'arc1:done'] };

  it('探索者持有全部旗標 → 可見', () => {
    const state = makeState({ flags: ['met:asvere', 'arc1:done', 'extra'] });
    expect(evaluateGate(state, cond)).toBe(true);
  });

  it('探索者旗標不足（AND 語意）→ 不可見', () => {
    const state = makeState({ flags: ['met:asvere'] });
    expect(evaluateGate(state, cond)).toBe(false);
  });

  it('觀測者無旗標也可見（全知 bypass）', () => {
    expect(evaluateGate(observer, cond)).toBe(true);
  });

  it('有印記的探索者不因印記獲得 bypass，仍需旗標', () => {
    expect(evaluateGate(markedExplorer, cond)).toBe(false);
    const withFlags = makeState({
      observerEver: true,
      flags: ['met:asvere', 'arc1:done'],
    });
    expect(evaluateGate(withFlags, cond)).toBe(true);
  });

  it('空陣列視為無條件', () => {
    expect(evaluateGate(pristineExplorer, { requiresFlags: [] })).toBe(true);
  });
});

describe('evaluateGate — pristineOnly', () => {
  const cond = { pristineOnly: true };

  it('純潔探索者 → 可見', () => {
    expect(evaluateGate(pristineExplorer, cond)).toBe(true);
  });

  it('有印記的探索者 → 不可見', () => {
    expect(evaluateGate(markedExplorer, cond)).toBe(false);
  });

  it('觀測者 → 不可見（不 bypass，這是印記的代價）', () => {
    expect(evaluateGate(observer, cond)).toBe(false);
  });
});

describe('evaluateGate — 組合條件（番外情境）', () => {
  const cond = { requiresFlags: ['arc1:done'], pristineOnly: true };

  it('純潔探索者 + 持有旗標 → 可見', () => {
    const state = makeState({ flags: ['arc1:done'] });
    expect(evaluateGate(state, cond)).toBe(true);
  });

  it('純潔探索者 + 旗標不足 → 不可見', () => {
    expect(evaluateGate(pristineExplorer, cond)).toBe(false);
  });

  it('觀測者即使全知也不可見（pristine 優先擋下）', () => {
    expect(evaluateGate(observer, cond)).toBe(false);
  });

  it('有印記的探索者持有旗標也不可見', () => {
    const state = makeState({ observerEver: true, flags: ['arc1:done'] });
    expect(evaluateGate(state, cond)).toBe(false);
  });
});

describe('hasAllFlags', () => {
  it('AND 語意', () => {
    const state = makeState({ flags: ['a', 'b'] });
    expect(hasAllFlags(state, ['a'])).toBe(true);
    expect(hasAllFlags(state, ['a', 'b'])).toBe(true);
    expect(hasAllFlags(state, ['a', 'c'])).toBe(false);
    expect(hasAllFlags(state, [])).toBe(true);
  });
});

describe('parseGateCondition', () => {
  it('平鋪形狀', () => {
    expect(
      parseGateCondition({ requiresFlags: ['x'], pristineOnly: true })
    ).toEqual({ requiresFlags: ['x'], pristineOnly: true });
  });

  it('巢狀 gate 形狀優先', () => {
    expect(
      parseGateCondition({ gate: { requiresFlags: ['y'] }, other: 1 })
    ).toEqual({ requiresFlags: ['y'] });
  });

  it('無有效條件回傳 null', () => {
    expect(parseGateCondition({})).toBeNull();
    expect(parseGateCondition(null)).toBeNull();
    expect(parseGateCondition(undefined)).toBeNull();
    expect(parseGateCondition({ requiresFlags: [] })).toBeNull();
    expect(parseGateCondition({ pristineOnly: false })).toBeNull();
  });

  it('過濾非字串與空字串旗標', () => {
    expect(
      parseGateCondition({ requiresFlags: ['ok', 42, '', null, 'fine'] })
    ).toEqual({ requiresFlags: ['ok', 'fine'] });
  });
});

describe('isProgressPage', () => {
  it('metadata.progressPage === true → true', () => {
    expect(isProgressPage({ progressPage: true })).toBe(true);
  });

  it('未設定或明確 false → false', () => {
    expect(isProgressPage({})).toBe(false);
    expect(isProgressPage({ progressPage: false })).toBe(false);
    expect(isProgressPage(null)).toBe(false);
    expect(isProgressPage(undefined)).toBe(false);
  });

  it('非 boolean 值一律 false（防禦）', () => {
    expect(isProgressPage({ progressPage: 1 })).toBe(false);
    expect(isProgressPage({ progressPage: 'true' })).toBe(false);
    expect(isProgressPage({ progressPage: null })).toBe(false);
  });

  it('與 gate/locked/hidden 平鋪共存不干擾', () => {
    const meta = {
      progressPage: true,
      locked: true,
      hidden: false,
      gate: { pristineOnly: true },
    };
    expect(isProgressPage(meta)).toBe(true);
  });
});

describe('normalizeState 不變量', () => {
  it('view=observer 但 observerEver=false 時強制補上印記', () => {
    const result = normalizeState({ view: 'observer', observerEver: false });
    expect(result!.observerEver).toBe(true);
  });
});

/**
 * 祖先鏈判定：文章編輯器（只有 parentId）與 /admin/settings 的進度總覽
 * （有整棵樹）必須得到同一個答案，規則因此只有這一份。
 */
describe('resolveInProgressContainer', () => {
  type Node = { metadata?: Record<string, unknown>; parentId?: string | null };

  const loaderFor = (nodes: Record<string, Node>) => async (id: string) =>
    nodes[id] ?? null;

  /** chapter（自標）→ arc（未標）→ section */
  const threeLevel: Record<string, Node> = {
    ch1: { metadata: { progressPage: true }, parentId: null },
    arc1: { metadata: {}, parentId: 'ch1' },
  };

  it('三層巢狀：中間層未標記，仍要追溯到祖父層（只查一層會判錯）', async () => {
    expect(
      await resolveInProgressContainer('arc1', loaderFor(threeLevel))
    ).toBe(true);
  });

  it('直接父頁自標 → true', async () => {
    expect(await resolveInProgressContainer('ch1', loaderFor(threeLevel))).toBe(
      true
    );
  });

  it('沒有父頁（根層或新建頁）→ false', async () => {
    expect(await resolveInProgressContainer(null, loaderFor({}))).toBe(false);
    expect(await resolveInProgressContainer('', loaderFor({}))).toBe(false);
  });

  it('鏈上有豁免節點 → 切斷，判 false', async () => {
    const nodes: Record<string, Node> = {
      ...threeLevel,
      arc1: { metadata: { gateExempt: true }, parentId: 'ch1' },
    };
    expect(await resolveInProgressContainer('arc1', loaderFor(nodes))).toBe(
      false
    );
  });

  it('豁免節點自標進度頁時仍是容器（自標優先於豁免）', async () => {
    const nodes: Record<string, Node> = {
      ...threeLevel,
      arc1: {
        metadata: { gateExempt: true, progressPage: true },
        parentId: 'ch1',
      },
    };
    expect(await resolveInProgressContainer('arc1', loaderFor(nodes))).toBe(
      true
    );
  });

  it('祖先查不到（已刪）→ false，不往上繼續猜', async () => {
    expect(await resolveInProgressContainer('ghost', loaderFor({}))).toBe(
      false
    );
  });

  it('資料成環不會無限迴圈', async () => {
    const nodes: Record<string, Node> = {
      a: { metadata: {}, parentId: 'b' },
      b: { metadata: {}, parentId: 'a' },
    };
    expect(await resolveInProgressContainer('a', loaderFor(nodes))).toBe(false);
  });

  it('超過 maxDepth 即停止（防超深樹拖垮開頁）', async () => {
    const nodes: Record<string, Node> = {
      deep: { metadata: { progressPage: true } },
    };
    for (let i = 0; i < 12; i++) {
      nodes[`n${i}`] = {
        metadata: {},
        parentId: i === 11 ? 'deep' : `n${i + 1}`,
      };
    }
    expect(await resolveInProgressContainer('n0', loaderFor(nodes), 3)).toBe(
      false
    );
  });
});
