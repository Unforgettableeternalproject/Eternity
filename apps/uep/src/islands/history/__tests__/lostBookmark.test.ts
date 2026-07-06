/**
 * 「遺落的書籤」機率規則測試（S6-2）
 *
 * store 是 module singleton，每個測試前 vi.resetModules() 取得全新實例
 * （lostBookmark 內部走 getProgressManager()，必須與 store 同一批模組）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshModules() {
  vi.resetModules();
  const store = await import('../../../progress/progressStore');
  const lb = await import('../lostBookmark');
  return { store: store.uepProgress, lb };
}

/** 進入底線條件：探索者 + 到過 History + 島未解鎖 */
function makeEligible(store: { grantFlags: (flags: string[]) => void }): void {
  store.grantFlags(['zone:visited:history']);
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.__uepProgress;
});

describe('rollLostBookmark', () => {
  it('不符底線條件時 skipped（未到訪 / 已解鎖 / 觀測者）', async () => {
    const { store, lb } = await freshModules();
    // 未到訪
    expect(lb.rollLostBookmark(store.getState(), () => 0)).toBe('skipped');
    // 已解鎖
    makeEligible(store);
    store.unlockIsland('history');
    expect(lb.rollLostBookmark(store.getState(), () => 0)).toBe('skipped');
  });

  it('觀測者視角不 roll', async () => {
    const { store, lb } = await freshModules();
    makeEligible(store);
    store.setView('observer');
    expect(lb.rollLostBookmark(store.getState(), () => 0)).toBe('skipped');
  });

  it('中了 → visible=true；已浮現時不再 roll', async () => {
    const { store, lb } = await freshModules();
    makeEligible(store);
    // random=0 → 0 < 20 必中
    expect(lb.rollLostBookmark(store.getState(), () => 0)).toBe('shown');
    expect(store.getState().lostBookmark.visible).toBe(true);
    expect(lb.rollLostBookmark(store.getState(), () => 0)).toBe('skipped');
  });

  it('沒中 → 機率遞增 20%，直到 100 必中', async () => {
    const { store, lb } = await freshModules();
    makeEligible(store);
    const alwaysMiss = () => 0.999; // 99.9 只輸給 100
    expect(lb.rollLostBookmark(store.getState(), alwaysMiss)).toBe('missed');
    expect(store.getState().lostBookmark.chancePct).toBe(40);
    lb.rollLostBookmark(store.getState(), alwaysMiss); // 60
    lb.rollLostBookmark(store.getState(), alwaysMiss); // 80
    lb.rollLostBookmark(store.getState(), alwaysMiss); // 100
    expect(store.getState().lostBookmark.chancePct).toBe(100);
    // 100% 時任何亂數都中
    expect(lb.rollLostBookmark(store.getState(), alwaysMiss)).toBe('shown');
  });
});

describe('dismissLostBookmark（忽視懲罰）', () => {
  it('浮現時導頁 → 消失且機率重置 20', async () => {
    const { store, lb } = await freshModules();
    makeEligible(store);
    // 先累積機率再中
    lb.rollLostBookmark(store.getState(), () => 0.999); // 40
    lb.rollLostBookmark(store.getState(), () => 0); // shown
    lb.dismissLostBookmark(store.getState());
    const state = store.getState();
    expect(state.lostBookmark.visible).toBe(false);
    expect(state.lostBookmark.chancePct).toBe(20);
  });

  it('未浮現時 no-op（不誤重置遞增中的機率）', async () => {
    const { store, lb } = await freshModules();
    makeEligible(store);
    lb.rollLostBookmark(store.getState(), () => 0.999); // 40
    lb.dismissLostBookmark(store.getState());
    expect(store.getState().lostBookmark.chancePct).toBe(40);
  });
});

describe('isLostBookmarkVisible / settleLostBookmark', () => {
  it('解鎖後條目永久消失（visible 落回 false + 底線條件失效）', async () => {
    const { store, lb } = await freshModules();
    makeEligible(store);
    lb.rollLostBookmark(store.getState(), () => 0);
    expect(lb.isLostBookmarkVisible(store.getState())).toBe(true);
    // 儀式完成
    lb.settleLostBookmark();
    store.unlockIsland('history');
    expect(store.getState().lostBookmark.visible).toBe(false);
    expect(lb.isLostBookmarkVisible(store.getState())).toBe(false);
  });

  it('觀測者切換時條目隱藏但 visible 狀態保留', async () => {
    const { store, lb } = await freshModules();
    makeEligible(store);
    lb.rollLostBookmark(store.getState(), () => 0);
    store.setView('observer');
    expect(lb.isLostBookmarkVisible(store.getState())).toBe(false);
    expect(store.getState().lostBookmark.visible).toBe(true);
    store.setView('explorer');
    expect(lb.isLostBookmarkVisible(store.getState())).toBe(true);
  });
});
