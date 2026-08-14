/**
 * Echoes content 視圖守門測試（S8 全區驗證 #1 回歸）
 *
 * `?page=` deep link 可帶任意 echoes ID——守門必須擋下 song（繞過
 * `?song=` 解鎖防護）、hidden、tree-aware locked 與不存在的 node。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  buildProgressTreeAdapter,
  createInitialState,
} from '../../../progress';
import type { ProgressState } from '../../../progress';

/* auth mock：EchoesReader 經 audio/islands 模組間接接線 readerAuth，
 * 測試不打真實 fetch（同 EchoesIsland 測試慣例） */
vi.mock('../../../auth', () => ({
  getReaderAuth: () => ({
    isLoggedIn: () => false,
    subscribe: () => () => {},
  }),
  useReaderAuth: () => null,
}));

import { isContentNodeViewable } from '../EchoesReader';

function makeProgress(overrides: Partial<ProgressState> = {}): ProgressState {
  return { ...createInitialState(), ...overrides };
}

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'echoes/areas/main',
    title: '主要區域',
    slug: 'areas/main',
    sortOrder: 0,
    pageType: 'subcategory',
    depth: 2,
    status: 'synced',
    metadata: {},
    children: [],
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('isContentNodeViewable — ?page= deep link 守門', () => {
  it('一般 subcategory（無 gate 無鎖）→ 可視', () => {
    expect(isContentNodeViewable(makeNode(), makeProgress())).toBe(true);
  });

  it('node 不存在 → 拒絕', () => {
    expect(isContentNodeViewable(undefined, makeProgress())).toBe(false);
  });

  it.each([['song'], ['homepage'], ['zone']])(
    'pageType %s → 拒絕（song 不得經 content 路徑繞過 ?song= 防護）',
    (pageType) => {
      expect(
        isContentNodeViewable(makeNode({ pageType }), makeProgress())
      ).toBe(false);
    }
  );

  it('hidden node → 拒絕', () => {
    expect(
      isContentNodeViewable(
        makeNode({ metadata: { hidden: true } }),
        makeProgress()
      )
    ).toBe(false);
  });

  it('gate 未達成 → 拒絕；達成 → 可視', () => {
    const node = makeNode({
      metadata: { gate: { requiresFlags: ['completed:history/ch1'] } },
    });
    expect(isContentNodeViewable(node, makeProgress())).toBe(false);
    expect(
      isContentNodeViewable(
        node,
        makeProgress({ flags: ['completed:history/ch1'] })
      )
    ).toBe(true);
  });

  it('tree-aware：progressPage 容器繼承的完成鏈生效', () => {
    const first = makeNode({ id: 'echoes/areas/sub-a', children: [] });
    const second = makeNode({ id: 'echoes/areas/sub-b', children: [] });
    const cluster = {
      id: 'echoes/areas',
      metadata: { progressPage: true },
      children: [first, second],
    };
    const tree = buildProgressTreeAdapter([
      { id: 'echoes', metadata: {}, children: [cluster] },
    ]);
    // 無 tree：本頁無 gate → 可視（守門不傳 tree 時的舊缺陷）
    expect(isContentNodeViewable(second, makeProgress())).toBe(true);
    // 有 tree：依賴前一節點 completion → 拒絕
    expect(isContentNodeViewable(second, makeProgress(), tree)).toBe(false);
    // 完整鏈達成 → 可視
    const progress = makeProgress({
      flags: ['completed:echoes/areas', 'completed:echoes/areas/sub-a'],
      completedPageIds: ['echoes/areas', 'echoes/areas/sub-a'],
    });
    expect(isContentNodeViewable(second, progress, tree)).toBe(true);
  });
});
