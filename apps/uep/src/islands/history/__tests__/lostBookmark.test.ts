/**
 * 「遺落的書籤」機率規則測試（S6-2）
 *
 * store 是 module singleton，每個測試前 vi.resetModules() 取得全新實例
 * （lostBookmark 內部走 getProgressManager()，必須與 store 同一批模組）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* 書籤 eligible 走 canUseIslands（浮島限已登入探索者）——mock auth，
   預設已登入；未登入不出書籤由 canUseIslands 統一守門 */
const authMock = vi.hoisted(() => ({ loggedIn: true }));
vi.mock('../../../auth', () => ({
  getReaderAuth: () => ({
    isLoggedIn: () => authMock.loggedIn,
    subscribe: () => () => {}, // islandRuntime 登入收合監聽用
  }),
}));

async function freshModules() {
  vi.resetModules();
  const store = await import('../../../progress/progressStore');
  const lb = await import('../lostBookmark');
  return { store: store.uepProgress, lb };
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.__uepProgress;
  delete window.__uepSettings;
});

/** 站台設定（`/admin/settings` 站台分頁）在前台的形狀 */
function setBaseChance(pct: number) {
  window.__uepSettings = { 'bookmark.baseChancePct': pct };
}

describe('rollLostBookmark', () => {
  /**
   * 2026-07-26：「未到訪 History」不再是底線條件（`zone:visited:*` 已廢除）。
   * roll 的觸發信號是 page-completed，只有在 History Reader 裡讀完一篇
   * 才會發生，人必然已在 zone 內——該條件恆真而非守門。詳見 unlockRitual.ts。
   */
  it('已解鎖時 skipped', async () => {
    const { store, lb } = await freshModules();
    store.unlockIsland('history');
    expect(lb.rollLostBookmark(store.getState(), () => 0)).toBe('skipped');
  });

  it('乾淨狀態（無任何旗標）即可 roll', async () => {
    const { store, lb } = await freshModules();
    expect(lb.rollLostBookmark(store.getState(), () => 0)).toBe('shown');
  });

  it('觀測者視角不 roll', async () => {
    const { store, lb } = await freshModules();
    store.setView('observer');
    expect(lb.rollLostBookmark(store.getState(), () => 0)).toBe('skipped');
  });

  it('中了 → visible=true；已浮現時不再 roll', async () => {
    const { store, lb } = await freshModules();
    // random=0 → 0 < 20 必中
    expect(lb.rollLostBookmark(store.getState(), () => 0)).toBe('shown');
    expect(store.getState().lostBookmark.visible).toBe(true);
    expect(lb.rollLostBookmark(store.getState(), () => 0)).toBe('skipped');
  });

  it('沒中 → 機率遞增 20%，直到 100 必中', async () => {
    const { store, lb } = await freshModules();
    const alwaysMiss = () => 0.999; // 99.9 只輸給 100
    expect(lb.rollLostBookmark(store.getState(), alwaysMiss)).toBe('missed');
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(40);
    lb.rollLostBookmark(store.getState(), alwaysMiss); // 60
    lb.rollLostBookmark(store.getState(), alwaysMiss); // 80
    lb.rollLostBookmark(store.getState(), alwaysMiss); // 100
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(100);
    // 100% 時任何亂數都中
    expect(lb.rollLostBookmark(store.getState(), alwaysMiss)).toBe('shown');
  });
});

/**
 * 站台設定 `bookmark.baseChancePct` 必須影響**第一次** roll。
 *
 * S10-3 之前持久狀態存的是絕對機率、初始值寫死 20，設定只在 dismiss 與
 * DevTools reset 時才寫進去——新讀者第一輪永遠是 20%，把值調成別的要等
 * 書籤先出現一次再被忽視才生效。
 */
describe('基礎機率走站台設定', () => {
  it('新讀者第一次 roll 就吃設定值', async () => {
    setBaseChance(60);
    const { store, lb } = await freshModules();
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(60);
    // 50 < 60 中；沒吃到設定的話 50 > 20 會 miss
    expect(lb.rollLostBookmark(store.getState(), () => 0.5)).toBe('shown');
  });

  it('設定調低同樣即時生效', async () => {
    setBaseChance(5);
    const { store, lb } = await freshModules();
    expect(lb.rollLostBookmark(store.getState(), () => 0.1)).toBe('missed');
    // 沒中的遞增疊在新的基礎值上
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(25);
  });

  it('設定中途被改：持久的是沒中次數，不是當初算出來的機率', async () => {
    setBaseChance(20);
    const { store, lb } = await freshModules();
    lb.rollLostBookmark(store.getState(), () => 0.999); // miss → 40%
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(40);

    setBaseChance(50);
    // 一次沒中的遞增仍在，基礎值換成新的
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(70);
  });

  it('設定未載入（首訪第一頁）退回常數 20', async () => {
    const { store, lb } = await freshModules();
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(20);
  });

  it('基礎值加遞增超過 100 時封頂', async () => {
    setBaseChance(90);
    const { store, lb } = await freshModules();
    lb.rollLostBookmark(store.getState(), () => 0.999);
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(100);
  });
});

describe('dismissLostBookmark（忽視懲罰）', () => {
  it('浮現時導頁 → 消失且機率回到基礎值', async () => {
    const { store, lb } = await freshModules();
    // 先累積機率再中
    lb.rollLostBookmark(store.getState(), () => 0.999); // 40
    lb.rollLostBookmark(store.getState(), () => 0); // shown
    lb.dismissLostBookmark(store.getState());
    const state = store.getState();
    expect(state.lostBookmark.visible).toBe(false);
    expect(state.lostBookmark.missCount).toBe(0);
    expect(lb.lostBookmarkChancePct(state)).toBe(20);
  });

  it('重置回的是當下的設定值而非寫死的 20', async () => {
    setBaseChance(45);
    const { store, lb } = await freshModules();
    lb.rollLostBookmark(store.getState(), () => 0.999);
    lb.rollLostBookmark(store.getState(), () => 0); // shown
    lb.dismissLostBookmark(store.getState());
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(45);
  });

  it('未浮現時 no-op（不誤重置遞增中的機率）', async () => {
    const { store, lb } = await freshModules();
    lb.rollLostBookmark(store.getState(), () => 0.999); // 40
    lb.dismissLostBookmark(store.getState());
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(40);
  });
});

describe('isLostBookmarkVisible / settleLostBookmark', () => {
  it('解鎖後條目永久消失（visible 落回 false + 底線條件失效）', async () => {
    const { store, lb } = await freshModules();
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
    lb.rollLostBookmark(store.getState(), () => 0);
    store.setView('observer');
    expect(lb.isLostBookmarkVisible(store.getState())).toBe(false);
    expect(store.getState().lostBookmark.visible).toBe(true);
    store.setView('explorer');
    expect(lb.isLostBookmarkVisible(store.getState())).toBe(true);
  });
});

describe('mountLostBookmarkTestBridge（S6-3 dev hook）', () => {
  it('掛上 window.__uepLostBookmarkTest，cleanup 後移除', async () => {
    const { lb } = await freshModules();
    const cleanup = lb.mountLostBookmarkTestBridge();
    expect(window.__uepLostBookmarkTest).toBeTruthy();
    cleanup();
    expect(window.__uepLostBookmarkTest).toBeUndefined();
  });

  it('force/guarantee/reset/status 直接操作書籤狀態', async () => {
    const { store, lb } = await freshModules();
    const cleanup = lb.mountLostBookmarkTestBridge();
    const bridge = window.__uepLostBookmarkTest!;

    bridge.force();
    expect(store.getState().lostBookmark.visible).toBe(true);

    bridge.reset();
    expect(store.getState().lostBookmark.visible).toBe(false);
    expect(store.getState().lostBookmark.missCount).toBe(0);

    bridge.guarantee();
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(100);
    // 100% 之後 roll 必中
    expect(bridge.roll()).toBe('shown');

    expect(bridge.status()).toMatchObject({
      visible: true,
      chancePct: 100,
      eligible: true,
    });
    cleanup();
  });

  it('openGate 廣播儀式頁開啟事件', async () => {
    const { lb } = await freshModules();
    const cleanup = lb.mountLostBookmarkTestBridge();
    let opened = 0;
    const onOpen = () => {
      opened += 1;
    };
    window.addEventListener(lb.LOST_BOOKMARK_OPEN_GATE_EVENT, onOpen);
    window.__uepLostBookmarkTest!.openGate();
    window.removeEventListener(lb.LOST_BOOKMARK_OPEN_GATE_EVENT, onOpen);
    expect(opened).toBe(1);
    cleanup();
  });
});
