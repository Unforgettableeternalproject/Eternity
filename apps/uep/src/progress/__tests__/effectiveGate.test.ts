/**
 * B 步驟：Tree 感知求值測試
 *
 * effectiveGate + isEffectivelyCompleted + evaluateEffectiveGate 三劍客，
 * 覆蓋：
 * - progressPage 自動注入前一個進度 sibling 的 completed:*
 * - 父層繼承：父為進度頁時鏈條件下沉
 * - 遞迴 completed 驗證：孤兒 flag 不通過
 * - 容器體：arc 完成 = 底下所有 progressPage 葉節點完成
 * - 環保護、找不到節點的容錯
 */
import { describe, it, expect } from 'vitest';

import {
  effectiveGate,
  evaluateEffectiveGate,
  isEffectivelyCompleted,
} from '../gating';
import type { ProgressTreeAdapter, TreeNodeLike } from '../tree';
import type { ProgressState } from '../types';
import { createInitialState } from '../types';

interface TestNode extends TreeNodeLike {
  id: string;
  parentId: string | null;
  metadata: Record<string, unknown>;
}

/**
 * 建立一個 in-memory tree adapter。
 * `nodes` 依 sortOrder 傳入的順序決定；同 parentId 的節點自動判定 sibling 關係。
 */
function makeTree(nodes: TestNode[]): ProgressTreeAdapter {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const siblingsByParent = new Map<string | null, TestNode[]>();
  for (const node of nodes) {
    const bucket = siblingsByParent.get(node.parentId) ?? [];
    bucket.push(node);
    siblingsByParent.set(node.parentId, bucket);
  }

  function isProgressNode(n: TestNode): boolean {
    return n.metadata.progressPage === true;
  }

  function collectProgressLeaves(id: string, acc: string[] = []): string[] {
    const children = nodes.filter((n) => n.parentId === id);
    for (const child of children) {
      const grandChildren = nodes.filter((n) => n.parentId === child.id);
      if (grandChildren.length === 0) {
        if (isProgressNode(child)) acc.push(child.id);
      } else {
        collectProgressLeaves(child.id, acc);
      }
    }
    return acc;
  }

  return {
    getNode: (id) => byId.get(id),
    getParent: (id) => {
      const n = byId.get(id);
      return n && n.parentId ? byId.get(n.parentId) : undefined;
    },
    getParentId: (id) => byId.get(id)?.parentId ?? undefined,
    getPreviousProgressSiblingId: (id) => {
      const node = byId.get(id);
      if (!node) return undefined;
      const siblings = siblingsByParent.get(node.parentId) ?? [];
      const idx = siblings.findIndex((s) => s.id === id);
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (isProgressNode(siblings[i])) return siblings[i].id;
      }
      return undefined;
    },
    getProgressDescendantIds: (id) => collectProgressLeaves(id),
  };
}

function stateWith(overrides: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...overrides };
}

describe('effectiveGate — 手動 gate 保留', () => {
  const tree = makeTree([
    {
      id: 'page-1',
      parentId: null,
      metadata: { gate: { pristineOnly: true, requiresFlags: ['met:x'] } },
    },
  ]);

  it('無 progressPage / 無 parent 進度時，等同 parseGateCondition', () => {
    expect(effectiveGate('page-1', tree)).toEqual({
      requiresFlags: ['met:x'],
      pristineOnly: true,
    });
  });

  it('找不到節點 → null', () => {
    expect(effectiveGate('nonexistent', tree)).toBeNull();
  });
});

describe('effectiveGate — progressPage 鏈條件自動注入', () => {
  // 同層 A → B → C 都是進度頁
  const tree = makeTree([
    { id: 'A', parentId: null, metadata: { progressPage: true } },
    { id: 'B', parentId: null, metadata: { progressPage: true } },
    { id: 'C', parentId: null, metadata: { progressPage: true } },
  ]);

  it('第一個進度頁無鏈條件', () => {
    expect(effectiveGate('A', tree)).toBeNull();
  });

  it('第二個進度頁 → 需前一個 completed', () => {
    expect(effectiveGate('B', tree)).toEqual({
      requiresFlags: ['completed:A'],
    });
  });

  it('第三個進度頁 → 需 B completed', () => {
    expect(effectiveGate('C', tree)).toEqual({
      requiresFlags: ['completed:B'],
    });
  });
});

describe('effectiveGate — 跳過非進度頁 sibling', () => {
  // A(進度) → 番外(非進度) → B(進度) → C(進度)
  const tree = makeTree([
    { id: 'A', parentId: null, metadata: { progressPage: true } },
    { id: 'omake', parentId: null, metadata: {} },
    { id: 'B', parentId: null, metadata: { progressPage: true } },
    { id: 'C', parentId: null, metadata: { progressPage: true } },
  ]);

  it('B 的前一個進度頁為 A（跳過番外）', () => {
    expect(effectiveGate('B', tree)).toEqual({
      requiresFlags: ['completed:A'],
    });
  });

  it('番外自己無鏈條件（非進度頁）', () => {
    expect(effectiveGate('omake', tree)).toBeNull();
  });
});

describe('effectiveGate — 手動 gate + 進度鏈聯集', () => {
  const tree = makeTree([
    { id: 'A', parentId: null, metadata: { progressPage: true } },
    {
      id: 'B',
      parentId: null,
      metadata: {
        progressPage: true,
        gate: { requiresFlags: ['met:norvia'], pristineOnly: true },
      },
    },
  ]);

  it('B 的條件同時含手動旗標與自動 completed:A', () => {
    const gate = effectiveGate('B', tree);
    expect(gate?.requiresFlags).toEqual(
      expect.arrayContaining(['met:norvia', 'completed:A'])
    );
    expect(gate?.pristineOnly).toBe(true);
  });
});

describe('effectiveGate — 父層繼承（容器體）', () => {
  // chapter1(進度) 底下 arc1、arc2；chapter2(進度) 底下 arc3
  // arc 本身非進度頁，但因父層是進度頁 → 繼承 chapter 前一個進度 sibling 條件
  const tree = makeTree([
    { id: 'ch1', parentId: null, metadata: { progressPage: true } },
    { id: 'ch2', parentId: null, metadata: { progressPage: true } },
    { id: 'arc1', parentId: 'ch1', metadata: {} },
    { id: 'arc3', parentId: 'ch2', metadata: {} },
  ]);

  it('ch1 下的 arc1 無父層繼承（ch1 是第一個）', () => {
    expect(effectiveGate('arc1', tree)).toBeNull();
  });

  it('ch2 下的 arc3 繼承 ch2 的鏈條件 → 需 ch1 completed', () => {
    expect(effectiveGate('arc3', tree)).toEqual({
      requiresFlags: ['completed:ch1'],
    });
  });
});

describe('effectiveGate — 自身進度 + 父層進度雙重鏈', () => {
  // ch2(進度) 底下 s1(進度)、s2(進度)：s2 有兩層條件
  const tree = makeTree([
    { id: 'ch1', parentId: null, metadata: { progressPage: true } },
    { id: 'ch2', parentId: null, metadata: { progressPage: true } },
    { id: 's1', parentId: 'ch2', metadata: { progressPage: true } },
    { id: 's2', parentId: 'ch2', metadata: { progressPage: true } },
  ]);

  it('s2 需要 s1 completed 且 ch1 completed', () => {
    const gate = effectiveGate('s2', tree);
    expect(gate?.requiresFlags).toEqual(
      expect.arrayContaining(['completed:s1', 'completed:ch1'])
    );
  });
});

describe('isEffectivelyCompleted — leaf 遞迴驗證', () => {
  const tree = makeTree([
    { id: 'A', parentId: null, metadata: { progressPage: true } },
    { id: 'B', parentId: null, metadata: { progressPage: true } },
    { id: 'C', parentId: null, metadata: { progressPage: true } },
  ]);

  it('flags 無 completed:X → false', () => {
    expect(isEffectivelyCompleted('A', createInitialState(), tree)).toBe(false);
  });

  it('flags 有 completed:A 且 A 無 gate → true', () => {
    const state = stateWith({ flags: ['completed:A'] });
    expect(isEffectivelyCompleted('A', state, tree)).toBe(true);
  });

  it('孤兒偵測：flags 有 completed:C 但 B 未完成 → C 視為未完成', () => {
    const state = stateWith({ flags: ['completed:C'] });
    expect(isEffectivelyCompleted('C', state, tree)).toBe(false);
  });

  it('鏈完整：A、B、C 全部 completed → C 為 true', () => {
    const state = stateWith({
      flags: ['completed:A', 'completed:B', 'completed:C'],
    });
    expect(isEffectivelyCompleted('C', state, tree)).toBe(true);
  });

  it('找不到節點 → false', () => {
    expect(isEffectivelyCompleted('ghost', createInitialState(), tree)).toBe(
      false
    );
  });
});

describe('isEffectivelyCompleted — 容器體判定', () => {
  // arc1 下有 s1(進度)、s2(進度)、番外(非進度)
  const tree = makeTree([
    { id: 'arc1', parentId: null, metadata: {} },
    { id: 's1', parentId: 'arc1', metadata: { progressPage: true } },
    { id: 's2', parentId: 'arc1', metadata: { progressPage: true } },
    { id: 'omake', parentId: 'arc1', metadata: {} },
  ]);

  it('底下部分完成 → arc 未完成', () => {
    const state = stateWith({ flags: ['completed:s1'] });
    expect(isEffectivelyCompleted('arc1', state, tree)).toBe(false);
  });

  it('底下所有 progressPage 都完成 → arc 完成（番外不算）', () => {
    const state = stateWith({ flags: ['completed:s1', 'completed:s2'] });
    expect(isEffectivelyCompleted('arc1', state, tree)).toBe(true);
  });

  it('container 空 → 走 leaf 判定（fallback）', () => {
    // arc 沒有 progressPage children → 當 leaf 處理
    const emptyTree = makeTree([
      { id: 'arc-empty', parentId: null, metadata: {} },
    ]);
    const state = stateWith({ flags: ['completed:arc-empty'] });
    expect(isEffectivelyCompleted('arc-empty', state, emptyTree)).toBe(true);
  });
});

describe('evaluateEffectiveGate — 三維求值 + 遞迴 completed', () => {
  const tree = makeTree([
    { id: 'A', parentId: null, metadata: { progressPage: true } },
    { id: 'B', parentId: null, metadata: { progressPage: true } },
    { id: 'C', parentId: null, metadata: { progressPage: true } },
  ]);

  it('無條件 → 通過', () => {
    expect(evaluateEffectiveGate('A', createInitialState(), tree)).toBe(true);
  });

  it('孤兒 completed:B 存在但 A 未 completed → C 求值仍失敗', () => {
    // 情境：測試模式手動蓋 completed:B，但 B 依賴的 A 沒 completed
    const state = stateWith({ flags: ['completed:B'] });
    expect(evaluateEffectiveGate('C', state, tree)).toBe(false);
  });

  it('完整鏈 → 通過', () => {
    const state = stateWith({
      flags: ['completed:A', 'completed:B'],
    });
    expect(evaluateEffectiveGate('C', state, tree)).toBe(true);
  });

  it('觀測者 bypass requiresFlags 但不 bypass pristineOnly', () => {
    const treeP = makeTree([
      {
        id: 'X',
        parentId: null,
        metadata: { gate: { pristineOnly: true, requiresFlags: ['met:x'] } },
      },
    ]);
    const observer = stateWith({ view: 'observer', observerEver: true });
    expect(evaluateEffectiveGate('X', observer, treeP)).toBe(false);
  });

  it('觀測者對純進度鏈可 bypass', () => {
    const observer = stateWith({ view: 'observer', observerEver: true });
    expect(evaluateEffectiveGate('C', observer, tree)).toBe(true);
  });
});

describe('環保護', () => {
  it('自循環：A parent 指向自己 → 不當機且視為未完成', () => {
    // 手動構造病態資料
    const nodes: TestNode[] = [
      { id: 'A', parentId: 'A', metadata: { progressPage: true } },
    ];
    const cyclicAdapter: ProgressTreeAdapter = {
      getNode: (id) => nodes.find((n) => n.id === id),
      getParent: () => nodes[0],
      getParentId: () => 'A',
      getPreviousProgressSiblingId: () => undefined,
      getProgressDescendantIds: () => [],
    };
    expect(() =>
      effectiveGate('A', cyclicAdapter)
    ).not.toThrow();
    expect(() =>
      isEffectivelyCompleted('A', createInitialState(), cyclicAdapter)
    ).not.toThrow();
  });
});
