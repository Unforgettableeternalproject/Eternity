import { describe, it, expect } from 'vitest';
import { isGateBlocked, visibleEntries } from '../storageVisibility';
import type { ProgressState } from '../../../progress';

function makeProgress(partial: Partial<ProgressState> = {}): ProgressState {
  return {
    flags: [],
    completedPageIds: [],
    pageMarkers: {},
    fogRatio: {},
    ...partial,
  } as ProgressState;
}

function node(metadata: Record<string, unknown> | null) {
  return { metadata };
}

describe('isGateBlocked', () => {
  it('無 gate → 不擋', () => {
    expect(isGateBlocked(node(null), makeProgress())).toBe(false);
  });

  it('completed 旗標未滿足 → 擋（progression 鎖）', () => {
    const entry = node({ gate: { requiresFlags: ['completed:history/ch1'] } });
    expect(isGateBlocked(entry, makeProgress())).toBe(true);
  });

  it('completed 旗標已滿足 → 不擋', () => {
    const entry = node({ gate: { requiresFlags: ['completed:history/ch1'] } });
    const progress = makeProgress({ flags: ['completed:history/ch1'] });
    expect(isGateBlocked(entry, progress)).toBe(false);
  });

  it('uep 自訂旗標未滿足 → 擋（flag 鎖）', () => {
    const entry = node({ gate: { requiresFlags: ['uep:tea-party'] } });
    expect(isGateBlocked(entry, makeProgress())).toBe(true);
  });

  it('uep 自訂旗標已滿足 → 不擋', () => {
    const entry = node({ gate: { requiresFlags: ['uep:tea-party'] } });
    expect(
      isGateBlocked(entry, makeProgress({ flags: ['uep:tea-party'] }))
    ).toBe(false);
  });

  it('static 鎖不算擋——要顯示成封箱卡片，不是藏起來', () => {
    const entry = node({ locked: true });
    expect(isGateBlocked(entry, makeProgress())).toBe(false);
  });

  it('static 鎖 + gate 未通過 → 仍以 gate 為準（擋）', () => {
    const entry = node({
      locked: true,
      gate: { requiresFlags: ['uep:tea-party'] },
    });
    expect(isGateBlocked(entry, makeProgress())).toBe(true);
  });

  it('無 progress（SSR / 載入前）→ 一律不擋，避免閃現後再消失', () => {
    const entry = node({ gate: { requiresFlags: ['uep:tea-party'] } });
    expect(isGateBlocked(entry, null)).toBe(false);
  });
});

describe('visibleEntries', () => {
  it('被擋的條目不進結果，static 鎖保留', () => {
    const entries = [
      node({}),
      node({ gate: { requiresFlags: ['uep:tea-party'] } }),
      node({ locked: true }),
      node({ gate: { requiresFlags: ['completed:history/ch1'] } }),
    ];
    const result = visibleEntries(entries, makeProgress());
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(entries[0]);
    expect(result[1]).toBe(entries[2]);
  });

  it('計數分母與列表同源——不洩漏被藏起來的條目數', () => {
    const entries = [
      node({}),
      node({ gate: { requiresFlags: ['uep:a'] } }),
      node({ gate: { requiresFlags: ['uep:b'] } }),
    ];
    expect(visibleEntries(entries, makeProgress())).toHaveLength(1);
    const unlocked = makeProgress({ flags: ['uep:a', 'uep:b'] });
    expect(visibleEntries(entries, unlocked)).toHaveLength(3);
  });
});
