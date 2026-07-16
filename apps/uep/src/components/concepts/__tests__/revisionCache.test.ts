/**
 * concepts/revisionCache 測試（Epic 2 S7）
 *
 * 驗證：fingerprint 命中/失效、flags 順序無關、view/observerEver
 * 參與指紋、invalidate 與 clear。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createInitialState } from '../../../progress/types';
import type { ProgressState } from '../../../progress/types';
import {
  getCachedEffectiveView,
  invalidatePageCache,
  clearAllRevisionCache,
  progressFingerprint,
} from '../revisionCache';

function stateWith(partial: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...partial };
}

beforeEach(() => {
  clearAllRevisionCache();
});

describe('progressFingerprint', () => {
  it('flags 順序無關（排序後等值）', () => {
    expect(progressFingerprint(stateWith({ flags: ['a:01', 'b:01'] }))).toBe(
      progressFingerprint(stateWith({ flags: ['b:01', 'a:01'] }))
    );
  });

  it('view 與 observerEver 參與指紋', () => {
    const base = progressFingerprint(stateWith({}));
    expect(
      progressFingerprint(stateWith({ view: 'observer', observerEver: true }))
    ).not.toBe(base);
    expect(progressFingerprint(stateWith({ observerEver: true }))).not.toBe(
      base
    );
  });
});

describe('getCachedEffectiveView', () => {
  it('同 fingerprint 第二次呼叫不執行 compute', () => {
    const compute = vi.fn(() => ({ n: 1 }));
    const s = stateWith({ flags: ['x:01'] });
    const first = getCachedEffectiveView('concepts/p', s, compute);
    const second = getCachedEffectiveView('concepts/p', s, compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(second).toBe(first); // 同一份引用
  });

  it('flags 變化 → fingerprint 不同 → 重新 compute', () => {
    const compute = vi.fn(() => ({}));
    getCachedEffectiveView('concepts/p', stateWith({}), compute);
    getCachedEffectiveView(
      'concepts/p',
      stateWith({ flags: ['x:01'] }),
      compute
    );
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('view 切換 → 重新 compute', () => {
    const compute = vi.fn(() => ({}));
    getCachedEffectiveView('concepts/p', stateWith({}), compute);
    getCachedEffectiveView(
      'concepts/p',
      stateWith({ view: 'observer', observerEver: true }),
      compute
    );
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('不同 page 各自快取', () => {
    const compute = vi.fn(() => ({}));
    const s = stateWith({});
    getCachedEffectiveView('concepts/a', s, compute);
    getCachedEffectiveView('concepts/b', s, compute);
    getCachedEffectiveView('concepts/a', s, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('invalidatePageCache 只清指定 page', () => {
    const compute = vi.fn(() => ({}));
    const s = stateWith({});
    getCachedEffectiveView('concepts/a', s, compute);
    getCachedEffectiveView('concepts/b', s, compute);
    invalidatePageCache('concepts/a');
    getCachedEffectiveView('concepts/a', s, compute); // miss → compute
    getCachedEffectiveView('concepts/b', s, compute); // hit
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it('clearAllRevisionCache 全清', () => {
    const compute = vi.fn(() => ({}));
    const s = stateWith({});
    getCachedEffectiveView('concepts/a', s, compute);
    clearAllRevisionCache();
    getCachedEffectiveView('concepts/a', s, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
