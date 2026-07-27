/**
 * 跨區互聯線索轉交橋測試（S10-1 修補）
 *
 * 這座橋存在的唯一理由是「島收合時島元件沒有 mount」，所以每條主張都圍繞
 * 收合期間的行為：事件不能消失、chip 要亮、展開後要補送、換頁要一併作廢。
 *
 * S10-1 後期改為每座島各留一份狀態——entityKey 的線索會同時送給 Echoes
 * 與 Visuals，共用單一 slot 會讓後到的蓋掉先到的。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRelatedPendingFlag } from '../interlinkTrigger';
import type { IslandId, IslandRelatedDetail } from '../types';
import {
  clearRelated,
  hasPendingRelated,
  pushIslandRelated,
  resetRelatedBridge,
  subscribeRelated,
} from '../relatedBridge';

function detail(
  label: string,
  targetIsland: IslandId = 'history'
): IslandRelatedDetail {
  return {
    targetIsland,
    sourceZone: 'echoes',
    items: [{ pageId: `${targetIsland}/${label}`, title: label }],
    label,
  };
}

describe('relatedBridge', () => {
  beforeEach(resetRelatedBridge);
  afterEach(resetRelatedBridge);

  it('島收合（無訂閱者）時暫存線索並亮起 dock chip', () => {
    pushIslandRelated(detail('雨海終曲'));

    expect(hasPendingRelated('history')).toBe(true);
    expect(getRelatedPendingFlag('history')).toBe(true);
  });

  it('島展開後取走 pending 並熄掉 chip', () => {
    pushIslandRelated(detail('雨海終曲'));

    const received: (IslandRelatedDetail | null)[] = [];
    subscribeRelated('history', (d) => received.push(d));

    expect(received).toEqual([detail('雨海終曲')]);
    expect(hasPendingRelated('history')).toBe(false);
    expect(getRelatedPendingFlag('history')).toBe(false);
  });

  it('島已展開時直接送達，不留 pending、不亮 chip', () => {
    const received: (IslandRelatedDetail | null)[] = [];
    subscribeRelated('history', (d) => received.push(d));

    pushIslandRelated(detail('雨海終曲'));

    expect(received).toEqual([detail('雨海終曲')]);
    expect(hasPendingRelated('history')).toBe(false);
    expect(getRelatedPendingFlag('history')).toBe(false);
  });

  it('收合期間連續多則只留最後一則（同島內一次一則，不排隊）', () => {
    pushIslandRelated(detail('第一則'));
    pushIslandRelated(detail('第二則'));

    const received: (IslandRelatedDetail | null)[] = [];
    subscribeRelated('history', (d) => received.push(d));

    expect(received).toEqual([detail('第二則')]);
  });

  /* 一個 entity 可以既有歌又有畫廊——兩則線索同時在飛，共用單一 slot
   * 的話後到的會把先到的蓋掉，讀者只會看到其中一座島有反應。 */
  it('不同島的線索各自獨立，不互相覆蓋', () => {
    pushIslandRelated(detail('艾斯維爾', 'echoes'));
    pushIslandRelated(detail('艾斯維爾', 'visuals'));

    expect(hasPendingRelated('echoes')).toBe(true);
    expect(hasPendingRelated('visuals')).toBe(true);
    expect(getRelatedPendingFlag('echoes')).toBe(true);
    expect(getRelatedPendingFlag('visuals')).toBe(true);

    const echoes: (IslandRelatedDetail | null)[] = [];
    const visuals: (IslandRelatedDetail | null)[] = [];
    subscribeRelated('echoes', (d) => echoes.push(d));
    subscribeRelated('visuals', (d) => visuals.push(d));

    expect(echoes).toEqual([detail('艾斯維爾', 'echoes')]);
    expect(visuals).toEqual([detail('艾斯維爾', 'visuals')]);
  });

  it('只有目標島的訂閱者會收到，其他島不受打擾', () => {
    const echoes = vi.fn();
    const history = vi.fn();
    subscribeRelated('echoes', echoes);
    subscribeRelated('history', history);

    pushIslandRelated(detail('艾斯維爾', 'echoes'));

    expect(echoes).toHaveBeenCalledTimes(1);
    expect(history).not.toHaveBeenCalled();
  });

  it('換頁時 pending 作廢，chip 一併熄掉', () => {
    pushIslandRelated(detail('雨海終曲'));

    clearRelated();

    expect(hasPendingRelated('history')).toBe(false);
    expect(getRelatedPendingFlag('history')).toBe(false);
  });

  it('換頁時所有島的 pending 與 chip 都要清掉', () => {
    pushIslandRelated(detail('艾斯維爾', 'echoes'));
    pushIslandRelated(detail('艾斯維爾', 'visuals'));

    clearRelated();

    expect(hasPendingRelated('echoes')).toBe(false);
    expect(hasPendingRelated('visuals')).toBe(false);
    expect(getRelatedPendingFlag('echoes')).toBe(false);
    expect(getRelatedPendingFlag('visuals')).toBe(false);
  });

  it('換頁時已送達的線索也要收掉（島展開著時卡片不得跨頁殘留）', () => {
    const received: (IslandRelatedDetail | null)[] = [];
    subscribeRelated('history', (d) => received.push(d));
    pushIslandRelated(detail('雨海終曲'));

    clearRelated();

    expect(received).toEqual([detail('雨海終曲'), null]);
  });

  it('取消訂閱後（島收合）線索回到暫存模式', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRelated('history', listener);
    unsubscribe();

    pushIslandRelated(detail('雨海終曲'));

    expect(listener).not.toHaveBeenCalled();
    expect(hasPendingRelated('history')).toBe(true);
    expect(getRelatedPendingFlag('history')).toBe(true);
  });

  it('島 mount 時無條件熄掉 chip（展開＝使用者看得到）', () => {
    pushIslandRelated(detail('雨海終曲'));
    const unsubscribe = subscribeRelated('history', () => {});
    unsubscribe();
    // 再次展開時已無 pending，但 chip 也不該殘留
    subscribeRelated('history', () => {});

    expect(getRelatedPendingFlag('history')).toBe(false);
  });
});
