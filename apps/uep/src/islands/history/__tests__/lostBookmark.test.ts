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
  window.__uepSettings = {
    ...window.__uepSettings,
    'bookmark.baseChancePct': pct,
  };
}

/** 每次沒中的加碼幅度（同一張設定表的另一個鍵） */
function setStepChance(pct: number) {
  window.__uepSettings = {
    ...window.__uepSettings,
    'bookmark.stepChancePct': pct,
  };
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

describe('加碼幅度走站台設定', () => {
  it('沒中的加碼吃 bookmark.stepChancePct 而非寫死的 20', async () => {
    setBaseChance(10);
    setStepChance(5);
    const { store, lb } = await freshModules();
    lb.rollLostBookmark(store.getState(), () => 0.999);
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(15);
  });

  it('加碼設 0 = 關掉保底，機率恆為基礎值', async () => {
    setBaseChance(10);
    setStepChance(0);
    const { store, lb } = await freshModules();
    lb.rollLostBookmark(store.getState(), () => 0.999);
    lb.rollLostBookmark(store.getState(), () => 0.999);
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(10);
  });

  it('未設定時退回常數 20', async () => {
    setBaseChance(0);
    const { store, lb } = await freshModules();
    lb.rollLostBookmark(store.getState(), () => 0.999);
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(20);
  });

  it('步長調小仍到得了 100%——持久層不可用預設步長的 pity 上限夾取', async () => {
    setBaseChance(0);
    setStepChance(1);
    const { store, lb } = await freshModules();
    // 用 DevTools 的 guarantee 走一次「必中所需次數」的計算
    const cleanup = lb.mountLostBookmarkTestBridge();
    expect(window.__uepLostBookmarkTest!.guarantee()).toBe(100);
    expect(store.getState().lostBookmark.missCount).toBe(100);
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(100);
    cleanup();
  });

  it('保底關掉時 guarantee 回報實際機率，不謊稱 100', async () => {
    setBaseChance(30);
    setStepChance(0);
    const { store, lb } = await freshModules();
    const cleanup = lb.mountLostBookmarkTestBridge();
    // 拉滿沒中次數也沒用——加碼是 0，機率恆等於基礎值
    expect(window.__uepLostBookmarkTest!.guarantee()).toBe(30);
    expect(lb.lostBookmarkChancePct(store.getState())).toBe(30);
    cleanup();
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

  /* 這條路徑一度在 HistoryReader 裡手寫成 `unlockIsland + open + toast`，
     漏掉了自動教學與完成時的資格重驗，而測試全綠——因為沒有任何一條
     測試走真實的收束出口。以下四條就是為了守住那個缺口。 */
  describe('openLostBookmark', () => {
    async function ready() {
      const mods = await freshModules();
      mods.store.setView('explorer');
      return mods;
    }

    it('解鎖旅程之書並收掉書籤條目', async () => {
      const { store, lb } = await ready();
      store.updateLostBookmark({ visible: true });

      expect(lb.openLostBookmark()).toBe(true);
      expect(store.getState().islandsUnlocked).toContain('history');
      expect(store.getState().lostBookmark.visible).toBe(false);
    });

    it('請求旅程之書的教學——這是它唯一的自動觸發點', async () => {
      const { store, lb } = await ready();
      const guide = await import('../../guide/guideRequest');
      const seen: string[] = [];
      const unsubscribe = guide.subscribeGuide((id) => seen.push(id));

      store.updateLostBookmark({ visible: true });
      lb.openLostBookmark();
      unsubscribe();

      expect(seen).toEqual(['history']);
    });

    it('展開旅程之書', async () => {
      const { store, lb } = await ready();
      const runtime = await import('../../islandRuntime');
      store.updateLostBookmark({ visible: true });

      lb.openLostBookmark();
      expect(runtime.getIslandRuntime().getState().windows.history?.open).toBe(
        true
      );
    });

    /* 發現與收束之間隔著對話框與 1.4 秒甦醒動畫，這段時間夠使用者
       切成觀測者——resize 甚至不會 unmount Reader，計時器照樣走完 */
    it('資格在儀式途中消失時不解鎖', async () => {
      const { store, lb } = await ready();
      store.updateLostBookmark({ visible: true });
      store.setView('observer');

      expect(lb.openLostBookmark()).toBe(false);
      expect(store.getState().islandsUnlocked).not.toContain('history');
    });

    /* 書籤是累積機率換來的，取消解鎖不該連它一起花掉——不然使用者要
       從頭累積才能再遇到一次 */
    it('解鎖被取消時不消耗書籤條目', async () => {
      const { store, lb } = await ready();
      store.updateLostBookmark({ visible: true });
      store.setView('observer');

      lb.openLostBookmark();
      expect(store.getState().lostBookmark.visible).toBe(true);
    });
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
