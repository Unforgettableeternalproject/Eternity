/**
 * terminalBridge 測試 — entity-activate 轉交橋（Epic 2 S7-C）
 *
 * 驗證島收合期間的事件暫存與 mount 後補送。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { EntityActivateDetail } from '../../../embed';
import {
  pushEntityActivate,
  subscribeEntityActivate,
  resetEntityActivateBridge,
} from '../terminalBridge';

const detail = (entityKey: string): EntityActivateDetail => ({
  kind: 'character',
  ref: `entity:${entityKey}`,
  entityKey,
});

beforeEach(() => {
  resetEntityActivateBridge();
});

describe('terminalBridge', () => {
  it('已訂閱時直接送達', () => {
    const fn = vi.fn();
    subscribeEntityActivate(fn);
    pushEntityActivate(detail('xavier-colsono'));
    expect(fn).toHaveBeenCalledWith(detail('xavier-colsono'));
  });

  it('未訂閱時暫存，mount 後補送最後一筆', () => {
    pushEntityActivate(detail('first'));
    pushEntityActivate(detail('second')); // 連點：只留最後一筆
    const fn = vi.fn();
    subscribeEntityActivate(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(detail('second'));
  });

  it('取消訂閱後回到暫存模式', () => {
    const fn = vi.fn();
    const unsubscribe = subscribeEntityActivate(fn);
    unsubscribe();
    pushEntityActivate(detail('after-unmount'));
    expect(fn).not.toHaveBeenCalled();

    const fn2 = vi.fn();
    subscribeEntityActivate(fn2);
    expect(fn2).toHaveBeenCalledWith(detail('after-unmount'));
  });
});
