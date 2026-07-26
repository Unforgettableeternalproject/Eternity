/**
 * dock chip 標記式提示狀態測試（S9-D）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  UEP_CHIP_ATTENTION_EVENT,
  clearAllChipAttention,
  clearChipAttention,
  getChipAttentionMark,
  markChipAttention,
} from '../chipAttention';

describe('chipAttention', () => {
  beforeEach(() => {
    clearAllChipAttention();
  });

  afterEach(() => {
    clearAllChipAttention();
  });

  it('markChipAttention 後可讀到說明，並廣播事件', () => {
    const onChange = vi.fn();
    window.addEventListener(UEP_CHIP_ATTENTION_EVENT, onChange);
    markChipAttention('history', '閱讀進度已更新');
    expect(getChipAttentionMark('history')).toBe('閱讀進度已更新');
    expect(onChange).toHaveBeenCalledTimes(1);
    window.removeEventListener(UEP_CHIP_ATTENTION_EVENT, onChange);
  });

  it('標記不會自己過期——時間推進後仍在', () => {
    vi.useFakeTimers();
    markChipAttention('history', '閱讀進度已更新');
    vi.advanceTimersByTime(60_000);
    expect(getChipAttentionMark('history')).toBe('閱讀進度已更新');
    vi.useRealTimers();
  });

  it('同島重複標記以最後一次的說明為準，同值不重複廣播', () => {
    markChipAttention('history', '第一次');
    const onChange = vi.fn();
    window.addEventListener(UEP_CHIP_ATTENTION_EVENT, onChange);

    markChipAttention('history', '第一次');
    expect(onChange).not.toHaveBeenCalled();

    markChipAttention('history', '第二次');
    expect(getChipAttentionMark('history')).toBe('第二次');
    expect(onChange).toHaveBeenCalledTimes(1);
    window.removeEventListener(UEP_CHIP_ATTENTION_EVENT, onChange);
  });

  it('clearChipAttention 只清指定島，其他島不受影響', () => {
    markChipAttention('history', 'A');
    markChipAttention('storage', 'B');
    clearChipAttention('history');
    expect(getChipAttentionMark('history')).toBeNull();
    expect(getChipAttentionMark('storage')).toBe('B');
  });

  it('清除不存在的標記不廣播事件', () => {
    const onChange = vi.fn();
    window.addEventListener(UEP_CHIP_ATTENTION_EVENT, onChange);
    clearChipAttention('visuals');
    clearAllChipAttention();
    expect(onChange).not.toHaveBeenCalled();
    window.removeEventListener(UEP_CHIP_ATTENTION_EVENT, onChange);
  });

  it('clearAllChipAttention 清光所有標記並廣播一次', () => {
    markChipAttention('history', 'A');
    markChipAttention('echoes', 'B');
    const onChange = vi.fn();
    window.addEventListener(UEP_CHIP_ATTENTION_EVENT, onChange);

    clearAllChipAttention();
    expect(getChipAttentionMark('history')).toBeNull();
    expect(getChipAttentionMark('echoes')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    window.removeEventListener(UEP_CHIP_ATTENTION_EVENT, onChange);
  });

  it('沒有任何標記時 getChipAttentionMark 回傳 null', () => {
    expect(getChipAttentionMark('visuals')).toBeNull();
  });
});
