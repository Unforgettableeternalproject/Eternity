import { describe, it, expect } from 'vitest';
import {
  isGateBlocked,
  isHiddenFromReader,
  isInHiddenClearing,
  visibleEntries,
  visibleRoomAreas,
} from '../storageVisibility';
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

describe('hidden 條目', () => {
  it('isHiddenFromReader：hidden 或 gate 未過都視同不存在', () => {
    expect(isHiddenFromReader(node({ hidden: true }), makeProgress())).toBe(
      true
    );
    expect(
      isHiddenFromReader(
        node({ gate: { requiresFlags: ['uep:tea-party'] } }),
        makeProgress()
      )
    ).toBe(true);
    expect(isHiddenFromReader(node({ locked: true }), makeProgress())).toBe(
      false
    );
    expect(isHiddenFromReader(node({}), makeProgress())).toBe(false);
  });

  it('hidden 不受進度與觀測者影響', () => {
    const observer = makeProgress({
      view: 'observer',
      flags: ['uep:tea-party'],
    });
    expect(isHiddenFromReader(node({ hidden: true }), observer)).toBe(true);
    expect(isHiddenFromReader(node({ hidden: true }), null)).toBe(true);
  });

  it('isGateBlocked 不因 hidden 改變（解鎖通知只看 gate）', () => {
    expect(isGateBlocked(node({ hidden: true }), makeProgress())).toBe(false);
  });

  it('visibleEntries 排除 hidden，計數分母一併扣除', () => {
    const entries = [node({}), node({ hidden: true }), node({ locked: true })];
    const result = visibleEntries(entries, makeProgress());
    expect(result).toEqual([entries[0], entries[2]]);
  });
});

describe('hidden clearing', () => {
  const clearings = [
    {
      slug: 'storage/boxes',
      metadata: {},
      children: [{ slug: 'storage/boxes/a', metadata: {} }],
    },
    {
      slug: 'storage/extras',
      metadata: { hidden: true },
      children: [{ slug: 'storage/extras/b', metadata: {} }],
    },
  ];

  it('isInHiddenClearing：hidden clearing 本身與底下條目都擋', () => {
    expect(isInHiddenClearing(clearings, 'storage/extras')).toBe(true);
    expect(isInHiddenClearing(clearings, 'storage/extras/b')).toBe(true);
    expect(isInHiddenClearing(clearings, 'storage/boxes')).toBe(false);
    expect(isInHiddenClearing(clearings, 'storage/boxes/a')).toBe(false);
    expect(isInHiddenClearing(clearings, 'storage/unknown')).toBe(false);
  });

  it('visibleRoomAreas：房間地圖排除 hidden clearing，找不到節點的房間保留', () => {
    const areas = [
      { slug: 'storage/boxes' },
      { slug: 'storage/extras' },
      { slug: 'storage/changelog' },
    ];
    expect(visibleRoomAreas(areas, clearings)).toEqual([areas[0], areas[2]]);
  });
});
