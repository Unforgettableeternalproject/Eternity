/**
 * tocSeen bridge 測試——目錄頁碼「上次看到」快照的跨 mount 生命週期。
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  clearSeenTocCounts,
  getSeenTocCounts,
  setSeenTocCounts,
} from '../tocSeen';

describe('tocSeen（目錄頁碼「上次看到」快照）', () => {
  beforeEach(() => {
    clearSeenTocCounts();
  });

  it('從未看過回傳 null', () => {
    expect(getSeenTocCounts()).toBeNull();
  });

  it('set 後可讀回，覆寫以最後一次為準', () => {
    setSeenTocCounts({ a: '1/2' });
    expect(getSeenTocCounts()).toEqual({ a: '1/2' });
    setSeenTocCounts({ a: '2/2', b: '封' });
    expect(getSeenTocCounts()).toEqual({ a: '2/2', b: '封' });
  });

  it('clear 後回到「從未看過」', () => {
    setSeenTocCounts({ a: '1/2' });
    clearSeenTocCounts();
    expect(getSeenTocCounts()).toBeNull();
  });

  it('狀態掛 window bridge（跨 bundle chunk 共享）', () => {
    setSeenTocCounts({ a: '1/2' });
    expect(window.__uepHistoryTocSeen).toEqual({ a: '1/2' });
  });
});
