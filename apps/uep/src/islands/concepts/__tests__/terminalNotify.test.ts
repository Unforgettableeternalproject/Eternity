/**
 * terminalNotify 測試（S7 驗收 #10）— 水位 diff 純函式
 *
 * 驗證：首次建檔靜默、delta 計算、跨 stack 取最大、
 * 代表條目偏好非 browser、無 entityKey/無鏈條目不參與。
 */
import { describe, it, expect } from 'vitest';

import { createInitialState } from '../../../progress/types';
import type { ProgressState } from '../../../progress/types';
import type { TerminalIndexEntry } from '../terminalCore';
import { computeUnreadUpdates } from '../terminalNotify';

function stateWith(partial: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...partial };
}

function entry(
  overrides: Partial<TerminalIndexEntry> & { name: string }
): TerminalIndexEntry {
  return {
    stack: 'dossier',
    pageId: 'concepts/a',
    pageTitle: '人物列表',
    ...overrides,
  };
}

const gates = (flags: string[]) =>
  flags.map((f, i) => ({ id: `r${i}`, gate: { requiresFlags: [f] } }));

describe('computeUnreadUpdates', () => {
  it('首次遇到的 key 進 firstSeen（靜默建檔，不算未讀）', () => {
    const { firstSeen, updates } = computeUnreadUpdates(
      [entry({ name: '甲', entityKey: 'k1', revisionGates: gates(['a:01']) })],
      stateWith({ flags: ['a:01'] })
    );
    expect(firstSeen).toEqual({ k1: 1 });
    expect(updates).toHaveLength(0);
  });

  it('已建檔的 key：通過數高於水位 → 未讀更新（含 delta/passed）', () => {
    const entries = [
      entry({
        name: '甲',
        entityKey: 'k1',
        revisionGates: gates(['a:01', 'a:02']),
      }),
    ];
    const { updates } = computeUnreadUpdates(
      entries,
      stateWith({ flags: ['a:01', 'a:02'], conceptsReadLevel: { k1: 0 } })
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ key: 'k1', passed: 2, delta: 2 });

    // 水位已同步 → 無未讀
    const synced = computeUnreadUpdates(
      entries,
      stateWith({ flags: ['a:01', 'a:02'], conceptsReadLevel: { k1: 2 } })
    );
    expect(synced.updates).toHaveLength(0);
  });

  it('同 entityKey 跨 stack 取最大通過數；代表條目偏好非 browser', () => {
    const entries = [
      entry({
        name: 'B面',
        entityKey: 'k1',
        stack: 'browser',
        revisionGates: gates(['a:01']),
      }),
      entry({
        name: 'A面',
        entityKey: 'k1',
        stack: 'dossier',
        revisionGates: gates(['a:01', 'a:02']),
      }),
    ];
    const { updates } = computeUnreadUpdates(
      entries,
      stateWith({ flags: ['a:01', 'a:02'], conceptsReadLevel: { k1: 0 } })
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].passed).toBe(2);
    expect(updates[0].entry.stack).toBe('dossier'); // 非 browser 優先
  });

  it('無 entityKey 或無 revision 鏈的條目不參與水位', () => {
    const { firstSeen, updates } = computeUnreadUpdates(
      [entry({ name: '無鑰' }), entry({ name: '無鏈', entityKey: 'k2' })],
      stateWith({})
    );
    expect(firstSeen).toEqual({});
    expect(updates).toHaveLength(0);
  });

  it('水位單調語意：通過數低於水位（旗標撤銷）不出現負向更新', () => {
    const { updates } = computeUnreadUpdates(
      [
        entry({
          name: '甲',
          entityKey: 'k1',
          revisionGates: gates(['a:01', 'a:02']),
        }),
      ],
      stateWith({ flags: [], conceptsReadLevel: { k1: 2 } })
    );
    expect(updates).toHaveLength(0);
  });
});
