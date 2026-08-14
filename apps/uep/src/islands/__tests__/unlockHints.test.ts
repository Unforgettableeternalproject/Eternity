/**
 * unlockHints 測試（2026-08-12 解鎖提示漸進解碼）
 *
 * 三塊：揭露比例映射、確定性遮蔽（單調、永不全露）、
 * zone 熟悉度追蹤 hook（location 變化計數、非 zone 不計）。
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInitialState } from '../../progress/types';
import type { ProgressState } from '../../progress/types';
import {
  ISLAND_UNLOCK_HINTS,
  maskUnlockHint,
  revealedUnlockHint,
  unlockHintRevealRatio,
  useZoneFamiliarityTracker,
} from '../unlockHints';
import { ISLAND_IDS } from '../types';

function stateWith(overrides: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...overrides };
}

describe('unlockHintRevealRatio', () => {
  it('初始只有基礎比例', () => {
    expect(unlockHintRevealRatio(stateWith({}), 'history')).toBeCloseTo(0.2);
  });

  it('造訪過該 zone 跳升；熟悉度線性累加', () => {
    const visited = stateWith({ flags: ['zone:visited:history'] });
    expect(unlockHintRevealRatio(visited, 'history')).toBeCloseTo(0.35);

    const familiar = stateWith({
      flags: ['zone:visited:history'],
      zoneFamiliarity: { history: 10 },
    });
    expect(unlockHintRevealRatio(familiar, 'history')).toBeCloseTo(0.55);
  });

  it('別區的足跡不影響這座島', () => {
    const other = stateWith({
      flags: ['zone:visited:echoes'],
      zoneFamiliarity: { echoes: 30 },
    });
    expect(unlockHintRevealRatio(other, 'history')).toBeCloseTo(0.2);
  });

  it('封頂 0.9——計數拉滿也永不揭露全句', () => {
    const maxed = stateWith({
      flags: ['zone:visited:history'],
      zoneFamiliarity: { history: 30 },
    });
    expect(unlockHintRevealRatio(maxed, 'history')).toBe(0.9);
  });
});

describe('maskUnlockHint', () => {
  it('五座島都有提示文案', () => {
    for (const id of ISLAND_IDS) {
      expect(ISLAND_UNLOCK_HINTS[id].length).toBeGreaterThan(10);
    }
  });

  it('確定性：同島同比例永遠產出同一結果', () => {
    const hint = ISLAND_UNLOCK_HINTS.history;
    expect(maskUnlockHint('history', hint, 0.4)).toBe(
      maskUnlockHint('history', hint, 0.4)
    );
  });

  it('比例 0 全遮（標點保留）、比例 1 全露', () => {
    const hint = ISLAND_UNLOCK_HINTS.storage;
    const fully = maskUnlockHint('storage', hint, 1);
    expect(fully).toBe(hint);

    const masked = maskUnlockHint('storage', hint, 0);
    expect(masked).not.toBe(hint);
    // 標點不遮：句子的節奏要看得出來
    expect(masked).toContain('，');
    expect(masked).toContain('▓');
    // 所有字母數字都被遮住
    expect([...masked].some((ch) => /[\p{L}\p{N}]/u.test(ch))).toBe(false);
  });

  it('單調揭露：比例上升時已露出的字不會退回遮蔽', () => {
    const hint = ISLAND_UNLOCK_HINTS.echoes;
    const low = [...maskUnlockHint('echoes', hint, 0.3)];
    const high = [...maskUnlockHint('echoes', hint, 0.7)];
    low.forEach((ch, i) => {
      if (ch !== '▓') expect(high[i]).toBe(ch);
    });
    // 高比例確實多露了字
    expect(high.filter((ch) => ch === '▓').length).toBeLessThan(
      low.filter((ch) => ch === '▓').length
    );
  });

  it('revealedUnlockHint 在最高熟悉度下仍留有遮蔽（封頂 0.9）', () => {
    const maxed = stateWith({
      flags: ['zone:visited:visuals'],
      zoneFamiliarity: { visuals: 30 },
    });
    expect(revealedUnlockHint(maxed, 'visuals')).toContain('▓');
  });
});

describe('useZoneFamiliarityTracker', () => {
  const originalPathname = window.location.pathname;

  beforeEach(() => {
    window.localStorage.clear();
    delete window.__uepProgress;
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.history.replaceState({}, '', originalPathname);
    delete window.__uepProgress;
  });

  it('進 zone 計 1，同 zone 換子頁再計；首頁與非 zone 頁不計', async () => {
    const { getProgressManager } = await import('../../progress');
    // 首頁 mount：zone 是 'home'，不計
    const { unmount } = renderHook(() => useZoneFamiliarityTracker());
    expect(
      getProgressManager().getState().zoneFamiliarity.history
    ).toBeUndefined();

    act(() => {
      window.history.pushState({}, '', '/history');
    });
    expect(getProgressManager().getState().zoneFamiliarity.history).toBe(1);

    // 同 zone 內以 query 切子頁 → 每次都計（刻意不去重）
    act(() => {
      window.history.pushState({}, '', '/history?page=1-1');
    });
    act(() => {
      window.history.pushState({}, '', '/history?page=1-2');
    });
    expect(getProgressManager().getState().zoneFamiliarity.history).toBe(3);

    // 非 zone 頁不計
    act(() => {
      window.history.pushState({}, '', '/portal');
    });
    expect(getProgressManager().getState().zoneFamiliarity.history).toBe(3);
    unmount();
  });

  it('直接在 zone 子頁 mount（整頁載入）也計 1', async () => {
    const { getProgressManager } = await import('../../progress');
    window.history.replaceState({}, '', '/echoes?song=abc');
    const { unmount } = renderHook(() => useZoneFamiliarityTracker());
    expect(getProgressManager().getState().zoneFamiliarity.echoes).toBe(1);
    unmount();
  });
});
