/**
 * 跨區互聯線索轉交橋測試（S10-1 修補）
 *
 * 這座橋存在的唯一理由是「島收合時 HistoryIsland 沒有 mount」，所以每條
 * 主張都圍繞收合期間的行為：事件不能消失、chip 要亮、展開後要補送、
 * 換頁要一併作廢。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRelatedPendingFlag } from '../../interlinkTrigger';
import type { IslandRelatedDetail } from '../../types';
import {
  clearRelated,
  hasPendingRelated,
  pushIslandRelated,
  resetRelatedBridge,
  subscribeRelated,
} from '../relatedBridge';

function detail(label: string): IslandRelatedDetail {
  return {
    sourceZone: 'echoes',
    historyPageIds: [`history/${label}`],
    label,
  };
}

describe('relatedBridge', () => {
  beforeEach(resetRelatedBridge);
  afterEach(resetRelatedBridge);

  it('島收合（無訂閱者）時暫存線索並亮起 dock chip', () => {
    pushIslandRelated(detail('雨海終曲'));

    expect(hasPendingRelated()).toBe(true);
    expect(getRelatedPendingFlag('history')).toBe(true);
  });

  it('島展開後取走 pending 並熄掉 chip', () => {
    pushIslandRelated(detail('雨海終曲'));

    const received: (IslandRelatedDetail | null)[] = [];
    subscribeRelated((d) => received.push(d));

    expect(received).toEqual([detail('雨海終曲')]);
    expect(hasPendingRelated()).toBe(false);
    expect(getRelatedPendingFlag('history')).toBe(false);
  });

  it('島已展開時直接送達，不留 pending、不亮 chip', () => {
    const received: (IslandRelatedDetail | null)[] = [];
    subscribeRelated((d) => received.push(d));

    pushIslandRelated(detail('雨海終曲'));

    expect(received).toEqual([detail('雨海終曲')]);
    expect(hasPendingRelated()).toBe(false);
    expect(getRelatedPendingFlag('history')).toBe(false);
  });

  it('收合期間連續多則只留最後一則（一次一則，不排隊）', () => {
    pushIslandRelated(detail('第一則'));
    pushIslandRelated(detail('第二則'));

    const received: (IslandRelatedDetail | null)[] = [];
    subscribeRelated((d) => received.push(d));

    expect(received).toEqual([detail('第二則')]);
  });

  it('換頁時 pending 作廢，chip 一併熄掉', () => {
    pushIslandRelated(detail('雨海終曲'));

    clearRelated();

    expect(hasPendingRelated()).toBe(false);
    expect(getRelatedPendingFlag('history')).toBe(false);
  });

  it('換頁時已送達的線索也要收掉（島展開著時卡片不得跨頁殘留）', () => {
    const received: (IslandRelatedDetail | null)[] = [];
    subscribeRelated((d) => received.push(d));
    pushIslandRelated(detail('雨海終曲'));

    clearRelated();

    expect(received).toEqual([detail('雨海終曲'), null]);
  });

  it('取消訂閱後（島收合）線索回到暫存模式', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRelated(listener);
    unsubscribe();

    pushIslandRelated(detail('雨海終曲'));

    expect(listener).not.toHaveBeenCalled();
    expect(hasPendingRelated()).toBe(true);
    expect(getRelatedPendingFlag('history')).toBe(true);
  });

  it('島 mount 時無條件熄掉 chip（展開＝使用者看得到）', () => {
    pushIslandRelated(detail('雨海終曲'));
    const unsubscribe = subscribeRelated(() => {});
    unsubscribe();
    // 再次展開時已無 pending，但 chip 也不該殘留
    subscribeRelated(() => {});

    expect(getRelatedPendingFlag('history')).toBe(false);
  });
});
