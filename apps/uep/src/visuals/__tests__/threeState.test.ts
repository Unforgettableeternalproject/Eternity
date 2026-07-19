/**
 * Visuals 三態解鎖模型測試（S8 下半場 V-A.11）
 *
 * 表驅動：8 案狀態機 × 探索者/觀測者 × 閘通過與否，
 * 加上第一張圖恆等式與 null progress 保守值。
 */
import { describe, expect, it } from 'vitest';

import { createInitialState } from '../../progress';
import type { GateCondition, ProgressState } from '../../progress';
import { deriveGalleryUnlockFlag, resolveImageState } from '../threeState';
import type { ImageDisplayState, ImageGateData } from '../threeState';

function makeProgress(overrides: Partial<ProgressState> = {}): ProgressState {
  return { ...createInitialState(), ...overrides };
}

const LOCK_GATE: GateCondition = { requiresFlags: ['completed:history/ch1'] };
const PARTIAL_GATE: GateCondition = {
  requiresFlags: ['completed:history/ch2'],
};
const PASS_LOCK = makeProgress({ flags: ['completed:history/ch1'] });
const PASS_BOTH = makeProgress({
  flags: ['completed:history/ch1', 'completed:history/ch2'],
});
const PASS_PARTIAL_ONLY = makeProgress({ flags: ['completed:history/ch2'] });
const PASS_NONE = makeProgress();
const OBSERVER = makeProgress({ view: 'observer', observerEver: true });

describe('resolveImageState — 8 案狀態機（艾斯維爾 2026-07-19 定案）', () => {
  interface Case {
    name: string;
    data: ImageGateData;
    progress: ProgressState | null;
    expected: ImageDisplayState;
  }

  const cases: Case[] = [
    // 案 1：A + lock + partial → A →(lock)→ B →(partial)→ C
    {
      name: '案1 兩閘皆未過 → locked',
      data: {
        initialState: 'locked',
        lockGate: LOCK_GATE,
        partialGate: PARTIAL_GATE,
      },
      progress: PASS_NONE,
      expected: 'locked',
    },
    {
      name: '案1 lockGate 過、partialGate 未過 → partial',
      data: {
        initialState: 'locked',
        lockGate: LOCK_GATE,
        partialGate: PARTIAL_GATE,
      },
      progress: PASS_LOCK,
      expected: 'partial',
    },
    {
      name: '案1 兩閘皆過 → unlocked',
      data: {
        initialState: 'locked',
        lockGate: LOCK_GATE,
        partialGate: PARTIAL_GATE,
      },
      progress: PASS_BOTH,
      expected: 'unlocked',
    },
    {
      name: '案1 只過 partialGate（lockGate 未過）→ locked（AND 鏈不跳關）',
      data: {
        initialState: 'locked',
        lockGate: LOCK_GATE,
        partialGate: PARTIAL_GATE,
      },
      progress: PASS_PARTIAL_ONLY,
      expected: 'locked',
    },
    // 案 2：A + lock only → A →(lock)→ C（跳過 B）
    {
      name: '案2 lockGate 未過 → locked',
      data: { initialState: 'locked', lockGate: LOCK_GATE },
      progress: PASS_NONE,
      expected: 'locked',
    },
    {
      name: '案2 lockGate 過 → 直達 unlocked',
      data: { initialState: 'locked', lockGate: LOCK_GATE },
      progress: PASS_LOCK,
      expected: 'unlocked',
    },
    // 案 3：A 無條件 → 永遠 A
    {
      name: '案3 無任何條件 → 永遠 locked（未釋出內容）',
      data: { initialState: 'locked' },
      progress: PASS_BOTH,
      expected: 'locked',
    },
    // 案 4：B + 兩閘 → 以 partialGate 為主，lockGate 無視
    {
      name: '案4 partialGate 未過（lockGate 過也沒用）→ partial',
      data: {
        initialState: 'partial',
        lockGate: LOCK_GATE,
        partialGate: PARTIAL_GATE,
      },
      progress: PASS_LOCK,
      expected: 'partial',
    },
    {
      name: '案4 partialGate 過 → unlocked（不需 lockGate）',
      data: {
        initialState: 'partial',
        lockGate: LOCK_GATE,
        partialGate: PARTIAL_GATE,
      },
      progress: PASS_PARTIAL_ONLY,
      expected: 'unlocked',
    },
    // 案 5：B + lock only → lockGate 視為 partialGate
    {
      name: '案5 lockGate 未過 → partial',
      data: { initialState: 'partial', lockGate: LOCK_GATE },
      progress: PASS_NONE,
      expected: 'partial',
    },
    {
      name: '案5 lockGate 過（視為 partialGate）→ unlocked',
      data: { initialState: 'partial', lockGate: LOCK_GATE },
      progress: PASS_LOCK,
      expected: 'unlocked',
    },
    // 案 6：B 無條件 → 永遠 B
    {
      name: '案6 無任何條件 → 永遠 partial',
      data: { initialState: 'partial' },
      progress: PASS_BOTH,
      expected: 'partial',
    },
    // 案 7：C → 條件全無視
    {
      name: '案7 unlocked 設了條件也無視 → unlocked',
      data: {
        initialState: 'unlocked',
        lockGate: LOCK_GATE,
        partialGate: PARTIAL_GATE,
      },
      progress: PASS_NONE,
      expected: 'unlocked',
    },
    // 案 8：A + partial only → 永遠 A（無條件可離開鎖定）
    {
      name: '案8 只有 partialGate → 永遠 locked，partialGate 過也沒用',
      data: { initialState: 'locked', partialGate: PARTIAL_GATE },
      progress: PASS_PARTIAL_ONLY,
      expected: 'locked',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(resolveImageState(c.data, false, c.progress)).toBe(c.expected);
    });
  }
});

describe('resolveImageState — 預設值與不變量', () => {
  it('無資料一律視為解鎖（艾斯維爾 2026-07-19 拍板，防既有畫廊鎖黑）', () => {
    expect(resolveImageState(null, false, PASS_NONE)).toBe('unlocked');
    expect(resolveImageState(undefined, false, PASS_NONE)).toBe('unlocked');
    expect(resolveImageState({}, false, PASS_NONE)).toBe('unlocked');
  });

  it('非法 initialState 值防禦性視為解鎖', () => {
    expect(
      resolveImageState(
        { initialState: 'weird' as never, lockGate: LOCK_GATE },
        false,
        PASS_NONE
      )
    ).toBe('unlocked');
  });

  it('空物件 gate 視為未設定（案 3 而非案 1）', () => {
    expect(
      resolveImageState(
        { initialState: 'locked', lockGate: {} as GateCondition },
        false,
        PASS_BOTH
      )
    ).toBe('locked');
  });

  it('第一張圖恆等式：無論資料為何恆 unlocked', () => {
    expect(
      resolveImageState(
        { initialState: 'locked', lockGate: LOCK_GATE },
        true,
        PASS_NONE
      )
    ).toBe('unlocked');
    expect(resolveImageState({ initialState: 'partial' }, true, null)).toBe(
      'unlocked'
    );
  });

  it('progress 為 null → 保守停在初始狀態（不求值閘）', () => {
    expect(
      resolveImageState(
        { initialState: 'locked', lockGate: LOCK_GATE },
        false,
        null
      )
    ).toBe('locked');
    expect(
      resolveImageState(
        { initialState: 'partial', partialGate: PARTIAL_GATE },
        false,
        null
      )
    ).toBe('partial');
    // 初始 C 不受影響
    expect(resolveImageState({ initialState: 'unlocked' }, false, null)).toBe(
      'unlocked'
    );
  });
});

describe('resolveImageState — 觀測者/純潔者語意（沿 evaluateGate）', () => {
  it('觀測者 bypass requiresFlags → 直達 unlocked', () => {
    expect(
      resolveImageState(
        {
          initialState: 'locked',
          lockGate: LOCK_GATE,
          partialGate: PARTIAL_GATE,
        },
        false,
        OBSERVER
      )
    ).toBe('unlocked');
  });

  it('觀測者不 bypass 案 3（無條件永遠鎖定）', () => {
    expect(resolveImageState({ initialState: 'locked' }, false, OBSERVER)).toBe(
      'locked'
    );
  });

  it('pristineOnly 閘：觀測者/有印記者不通過', () => {
    const pristineGate: GateCondition = { pristineOnly: true };
    expect(
      resolveImageState(
        { initialState: 'partial', partialGate: pristineGate },
        false,
        OBSERVER
      )
    ).toBe('partial');
    // 有印記的探索者也不通過
    const marked = makeProgress({ observerEver: true });
    expect(
      resolveImageState(
        { initialState: 'partial', partialGate: pristineGate },
        false,
        marked
      )
    ).toBe('partial');
    // 純潔探索者通過
    expect(
      resolveImageState(
        { initialState: 'partial', partialGate: pristineGate },
        false,
        PASS_NONE
      )
    ).toBe('unlocked');
  });
});

describe('deriveGalleryUnlockFlag — 雙命名空間（對位 deriveSongUnlockFlag）', () => {
  it('有 entityKey → {entityKey}:gallery', () => {
    expect(
      deriveGalleryUnlockFlag('visuals/profiles/x', 'xavier-colsono')
    ).toBe('xavier-colsono:gallery');
  });

  it('無 entityKey → gallery:{pageId}', () => {
    expect(deriveGalleryUnlockFlag('visuals/illustrations/scene-1')).toBe(
      'gallery:visuals/illustrations/scene-1'
    );
    expect(deriveGalleryUnlockFlag('visuals/illustrations/scene-1', null)).toBe(
      'gallery:visuals/illustrations/scene-1'
    );
  });

  it('entityKey 空白字串 → fallback 到 gallery:{pageId}', () => {
    expect(deriveGalleryUnlockFlag('visuals/profiles/x', '  ')).toBe(
      'gallery:visuals/profiles/x'
    );
  });
});
