/**
 * useCurrentLocation 測試（S9-A.2）
 *
 * 純函式 extractZone + hook 對 popstate/pushState 的即時反應。
 * 便條島與釘選層共用此 hook，需驗證跨路由變更能正確更新快照。
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearPageContext, setPageContext } from '../../utils/pageContext';
import {
  ZONE_LABELS,
  extractZone,
  useCurrentLocation,
} from '../useCurrentLocation';

describe('extractZone', () => {
  it('五 zone 均可辨識', () => {
    expect(extractZone('/history')).toBe('history');
    expect(extractZone('/history/1-1')).toBe('history');
    expect(extractZone('/echoes')).toBe('echoes');
    // 注意：extractZone 吃的是 pathname（不含 ?query），呼叫端傳入 location.pathname
    expect(extractZone('/concepts')).toBe('concepts');
    expect(extractZone('/visuals')).toBe('visuals');
    expect(extractZone('/storage')).toBe('storage');
  });

  it('非浮島 zone / 起始頁 / 空字串 → null', () => {
    expect(extractZone('/')).toBeNull();
    expect(extractZone('')).toBeNull();
    expect(extractZone('/admin')).toBeNull();
    expect(extractZone('/portal')).toBeNull();
  });

  it('ZONE_LABELS 五 zone 皆有中文名', () => {
    expect(ZONE_LABELS.history).toBe('歷史典藏庫');
    expect(ZONE_LABELS.echoes).toBe('回音蒐藏間');
    expect(ZONE_LABELS.concepts).toBe('概念調整房');
    expect(ZONE_LABELS.visuals).toBe('幻影重現室');
    expect(ZONE_LABELS.storage).toBe('某人的置物空間');
  });
});

describe('useCurrentLocation', () => {
  const originalPathname = window.location.pathname;

  beforeEach(() => {
    // 起始 pathname 對齊測試用值
    window.history.replaceState({}, '', '/history');
    document.title = '歷史典藏庫 - 邊際世界';
    delete window.__uepPageContext;
  });

  afterEach(() => {
    window.history.replaceState({}, '', originalPathname);
    delete window.__uepPageContext;
  });

  it('初始快照包含 pathname/zone/pageLabel', () => {
    const { result } = renderHook(() => useCurrentLocation());
    expect(result.current.pathname).toBe('/history');
    expect(result.current.zone).toBe('history');
    expect(result.current.pageLabel).toBe('歷史典藏庫 - 邊際世界');
  });

  // 【回歸：S9-A Codex #1】search 欄位需一起快照，pushState 到同 pathname 不同
  // query 時 hook 也要更新，否則 pinned 過濾會誤把別的子頁釘選顯示到當前頁。
  it('快照含 search；純 query 變更也觸發更新', () => {
    window.history.replaceState({}, '', '/history?page=abc');
    const { result } = renderHook(() => useCurrentLocation());
    expect(result.current.pathname).toBe('/history');
    expect(result.current.search).toBe('?page=abc');

    act(() => {
      window.history.pushState({}, '', '/history?page=xyz');
    });
    expect(result.current.pathname).toBe('/history');
    expect(result.current.search).toBe('?page=xyz');
  });

  it('無 query 時 search 為空字串', () => {
    window.history.replaceState({}, '', '/echoes');
    const { result } = renderHook(() => useCurrentLocation());
    expect(result.current.search).toBe('');
  });

  it('pushState 觸發 uep:location-change 事件並更新快照', () => {
    const { result } = renderHook(() => useCurrentLocation());
    act(() => {
      document.title = '回音蒐藏間 - 邊際世界';
      window.history.pushState({}, '', '/echoes');
    });
    expect(result.current.pathname).toBe('/echoes');
    expect(result.current.zone).toBe('echoes');
    expect(result.current.pageLabel).toBe('回音蒐藏間 - 邊際世界');
  });

  it('popstate 觸發重讀', () => {
    const { result } = renderHook(() => useCurrentLocation());
    act(() => {
      window.history.replaceState({}, '', '/storage');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.zone).toBe('storage');
  });

  // 【回歸：S9-A 驗收根因 E】pageLabel 不可從 document.title 倒推——
  // Reader fetch 完成後才發佈 pageContext，發佈當下（無任何導航事件）
  // hook 就要更新。
  it('pageContext 發佈 → pageLabel/pageTrail 即時更新且優先於 title', () => {
    const { result } = renderHook(() => useCurrentLocation());
    expect(result.current.pageLabel).toBe('歷史典藏庫 - 邊際世界'); // fallback

    act(() => {
      setPageContext('殘響之弧', ['第一章']);
    });
    expect(result.current.pageLabel).toBe('殘響之弧');
    expect(result.current.pageTrail).toEqual(['第一章']);

    act(() => {
      clearPageContext();
    });
    // 清空後退回 document.title fallback
    expect(result.current.pageLabel).toBe('歷史典藏庫 - 邊際世界');
    expect(result.current.pageTrail).toEqual([]);
  });
});
