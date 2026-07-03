/**
 * Progress Store 單元測試
 *
 * store 是 module singleton，每個測試前用 vi.resetModules() 取得全新實例，
 * 並清空 localStorage 與 window bridge。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { PROGRESS_STORAGE_KEY, normalizeState } from '../adapters';
import type { ProgressState } from '../types';

async function freshStore() {
  vi.resetModules();
  const mod = await import('../progressStore');
  return mod;
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.__uepProgress;
});

describe('bootstrap', () => {
  it('無既有資料時建立初始狀態（探索者、無印記）', async () => {
    const { uepProgress } = await freshStore();
    const state = uepProgress.getState();
    expect(state.view).toBe('explorer');
    expect(state.observerEver).toBe(false);
    expect(state.flags).toEqual([]);
    expect(state.version).toBe(1);
  });

  it('從 localStorage 還原既有進度', async () => {
    const saved: Partial<ProgressState> = {
      version: 1,
      view: 'explorer',
      observerEver: true,
      flags: ['met:asvere'],
      completedPageIds: ['history/1-1'],
      islandsUnlocked: [],
      pageMarkers: {},
      updatedAt: '2026-07-03T00:00:00.000Z',
    };
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(saved));
    const { uepProgress } = await freshStore();
    expect(uepProgress.getState().flags).toEqual(['met:asvere']);
    expect(uepProgress.getState().observerEver).toBe(true);
  });

  it('localStorage 資料毀損時回到初始狀態而不噴錯', async () => {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, '{broken json!!');
    const { uepProgress } = await freshStore();
    expect(uepProgress.getState().view).toBe('explorer');
  });
});

describe('視角切換與觀測者印記', () => {
  it('切換至 observer 時寫入永久印記', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.setView('observer');
    expect(uepProgress.getState().view).toBe('observer');
    expect(uepProgress.getState().observerEver).toBe(true);
  });

  it('切回 explorer 後印記保留', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.setView('observer');
    uepProgress.setView('explorer');
    expect(uepProgress.getState().view).toBe('explorer');
    expect(uepProgress.getState().observerEver).toBe(true);
  });

  it('視角切換後持久化到 localStorage', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.setView('observer');
    const raw = JSON.parse(window.localStorage.getItem(PROGRESS_STORAGE_KEY)!);
    expect(raw.observerEver).toBe(true);
  });
});

describe('旗標', () => {
  it('授予旗標並去重', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.grantFlags(['met:asvere', 'arc1:done']);
    uepProgress.grantFlags(['met:asvere']);
    expect(uepProgress.getState().flags).toEqual(['met:asvere', 'arc1:done']);
    expect(uepProgress.hasFlag('met:asvere')).toBe(true);
    expect(uepProgress.hasFlag('met:unknown')).toBe(false);
  });

  it('重複授予不觸發通知', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.grantFlags(['a']);
    const listener = vi.fn();
    uepProgress.subscribe(listener);
    uepProgress.grantFlags(['a']);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('頁面完成與浮島', () => {
  it('標記頁面完成（冪等）', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.markPageCompleted('history/1-1');
    uepProgress.markPageCompleted('history/1-1');
    expect(uepProgress.getState().completedPageIds).toEqual(['history/1-1']);
  });

  it('解鎖浮島（冪等）', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.unlockIsland('concepts');
    uepProgress.unlockIsland('concepts');
    expect(uepProgress.getState().islandsUnlocked).toEqual(['concepts']);
  });
});

describe('掃描線進度', () => {
  it('maxMarkerIdx 只增不減，lastMarkerIdx 跟隨最新位置', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.updatePageMarker('history/1-1', 3, 3, 5);
    uepProgress.updatePageMarker('history/1-1', 1, 1, 5);
    const marker = uepProgress.getState().pageMarkers['history/1-1'];
    expect(marker.maxMarkerIdx).toBe(3);
    expect(marker.lastMarkerIdx).toBe(1);
    expect(marker.totalMarkers).toBe(5);
  });
});

describe('reset', () => {
  it('清除進度但保留觀測者印記', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.setView('observer');
    uepProgress.grantFlags(['met:asvere']);
    uepProgress.reset();
    const state = uepProgress.getState();
    expect(state.flags).toEqual([]);
    expect(state.view).toBe('explorer');
    expect(state.observerEver).toBe(true);
  });
});

describe('訂閱與事件', () => {
  it('mutation 觸發 subscriber 與 CustomEvent', async () => {
    const { uepProgress, PROGRESS_CHANGE_EVENT } = await freshStore();
    const listener = vi.fn();
    const eventListener = vi.fn();
    uepProgress.subscribe(listener);
    window.addEventListener(PROGRESS_CHANGE_EVENT, eventListener);
    uepProgress.grantFlags(['x']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][1].source).toBe('flags-granted');
    expect(eventListener).toHaveBeenCalledTimes(1);
    window.removeEventListener(PROGRESS_CHANGE_EVENT, eventListener);
  });

  it('取消訂閱後不再收到通知', async () => {
    const { uepProgress } = await freshStore();
    const listener = vi.fn();
    const unsub = uepProgress.subscribe(listener);
    unsub();
    uepProgress.grantFlags(['x']);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('setAdapter（S5 ServerAdapter 接點）', () => {
  it('遠端有資料時覆蓋本地（伺服器優先）', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.grantFlags(['local-flag']);
    const remoteState: ProgressState = {
      version: 1,
      view: 'explorer',
      observerEver: false,
      flags: ['remote-flag'],
      completedPageIds: [],
      islandsUnlocked: [],
      pageMarkers: {},
      updatedAt: '2026-07-03T00:00:00.000Z',
    };
    await uepProgress.setAdapter({
      load: () => Promise.resolve(remoteState),
      save: () => Promise.resolve(),
    });
    expect(uepProgress.getState().flags).toEqual(['remote-flag']);
  });

  it('遠端無資料時上傳本地進度', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.grantFlags(['local-flag']);
    const save = vi.fn(() => Promise.resolve());
    await uepProgress.setAdapter({ load: () => Promise.resolve(null), save });
    expect(save).toHaveBeenCalled();
    expect(uepProgress.getState().flags).toEqual(['local-flag']);
  });
});

describe('normalizeState', () => {
  it('欄位缺漏時以初始值補齊', () => {
    const result = normalizeState({ view: 'observer' });
    expect(result).not.toBeNull();
    expect(result!.view).toBe('observer');
    expect(result!.flags).toEqual([]);
    expect(result!.observerEver).toBe(false);
  });

  it('非物件輸入回傳 null', () => {
    expect(normalizeState('string')).toBeNull();
    expect(normalizeState(null)).toBeNull();
    expect(normalizeState(42)).toBeNull();
  });

  it('過濾陣列中的非字串元素', () => {
    const result = normalizeState({ flags: ['ok', 42, null, 'also-ok'] });
    expect(result!.flags).toEqual(['ok', 'also-ok']);
  });
});
