import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  clearUnlockNotice,
  hasPendingUnlockNotice,
  pushUnlockNotice,
  resetUnlockNoticeBridge,
  subscribeUnlockNotice,
} from '../unlockNotice';
import {
  getChipAttentionMark,
  clearAllChipAttention,
} from '../../chipAttention';

const notice = { slug: 'storage/boxes/tea-party', title: '茶會' };

describe('unlockNotice 橋', () => {
  beforeEach(() => {
    resetUnlockNoticeBridge();
    clearAllChipAttention();
  });

  it('島展開中（有 subscriber）→ 直接送達，不留 pending 也不亮 chip', () => {
    const seen = vi.fn();
    subscribeUnlockNotice(seen);
    pushUnlockNotice(notice);

    expect(seen).toHaveBeenCalledWith(notice);
    expect(hasPendingUnlockNotice()).toBe(false);
    // 島展開中標記 chip 會在收合那一刻變成已讀殘影（chipAttention 的已知陷阱）
    expect(getChipAttentionMark('storage')).toBeNull();
  });

  it('島收合中 → 留 pending 並亮 chip', () => {
    pushUnlockNotice(notice);

    expect(hasPendingUnlockNotice()).toBe(true);
    expect(getChipAttentionMark('storage')).toBe('有新的對話可以聊了');
  });

  it('之後展開島 → pending 立刻送達且清空', () => {
    pushUnlockNotice(notice);
    const seen = vi.fn();
    subscribeUnlockNotice(seen);

    expect(seen).toHaveBeenCalledWith(notice);
    expect(hasPendingUnlockNotice()).toBe(false);
  });

  it('同時間只保留最後一筆——後到的取代先到的', () => {
    const later = { slug: 'storage/boxes/later', title: '後來的' };
    pushUnlockNotice(notice);
    pushUnlockNotice(later);

    const seen = vi.fn();
    subscribeUnlockNotice(seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(later);
  });

  it('換頁清除 → pending 丟棄且通知已顯示者收回', () => {
    const seen = vi.fn();
    subscribeUnlockNotice(seen);
    pushUnlockNotice(notice);
    clearUnlockNotice();

    expect(seen).toHaveBeenLastCalledWith(null);
    expect(hasPendingUnlockNotice()).toBe(false);
  });

  it('取消訂閱後再推 → 回到 pending 模式', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeUnlockNotice(seen);
    unsubscribe();
    pushUnlockNotice(notice);

    expect(seen).not.toHaveBeenCalled();
    expect(hasPendingUnlockNotice()).toBe(true);
  });
});
