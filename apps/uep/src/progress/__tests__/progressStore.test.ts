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

/** 完整的遠端 ProgressState，只覆寫測試關心的欄位 */
function makeRemote(overrides: Partial<ProgressState> = {}): ProgressState {
  return {
    version: 1,
    view: 'explorer',
    observerEver: false,
    flags: [],
    completedPageIds: [],
    islandsUnlocked: [],
    islandsDisabled: [],
    pageMarkers: {},
    lastVisitedPageId: null,
    lastVisitedAt: null,
    lostBookmark: { chancePct: 20, visible: false },
    readingStats: { totalMs: 0 },
    conceptsReadLevel: {},
    storageNotes: [],
    updatedAt: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
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

  it('revokeFlags 撤銷旗標；不存在的旗標不觸發通知（S6-3）', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.grantFlags(['a', 'b', 'c']);
    uepProgress.revokeFlags(['b', 'nope']);
    expect(uepProgress.getState().flags).toEqual(['a', 'c']);

    const listener = vi.fn();
    uepProgress.subscribe(listener);
    uepProgress.revokeFlags(['nope']); // 全部不存在 → no-op
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

  it('relockIsland 重新上鎖；未解鎖時不觸發通知（S6-3）', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.unlockIsland('history');
    uepProgress.unlockIsland('concepts');
    uepProgress.relockIsland('history');
    expect(uepProgress.getState().islandsUnlocked).toEqual(['concepts']);

    const listener = vi.fn();
    uepProgress.subscribe(listener);
    uepProgress.relockIsland('history'); // 已不在清單 → no-op
    expect(listener).not.toHaveBeenCalled();
  });

  it('setIslandDisabled 停用/啟用往返（冪等，不動解鎖清單）', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.unlockIsland('history');
    uepProgress.setIslandDisabled('history', true);
    uepProgress.setIslandDisabled('history', true); // 重複停用 no-op
    expect(uepProgress.getState().islandsDisabled).toEqual(['history']);
    expect(uepProgress.getState().islandsUnlocked).toEqual(['history']);
    uepProgress.setIslandDisabled('history', false);
    expect(uepProgress.getState().islandsDisabled).toEqual([]);
  });

  it('addReadingTime 累加閱讀時間，非法值防禦', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.addReadingTime(60_000);
    uepProgress.addReadingTime(30_000);
    uepProgress.addReadingTime(-5); // 負值 no-op
    uepProgress.addReadingTime(NaN); // NaN no-op
    expect(uepProgress.getState().readingStats.totalMs).toBe(90_000);
  });

  it('舊 blob 沒有 islandsDisabled 欄位時 normalize 補空陣列', async () => {
    const legacy = {
      version: 1,
      view: 'explorer',
      observerEver: false,
      flags: [],
      completedPageIds: [],
      islandsUnlocked: ['history'],
      pageMarkers: {},
      updatedAt: '2026-07-05T00:00:00.000Z',
    };
    expect(normalizeState(legacy)!.islandsDisabled).toEqual([]);
    expect(normalizeState(legacy)!.readingStats).toEqual({ totalMs: 0 });
    // S7-C 新增欄位：舊 blob 沒有時補空表；壞值逐項剔除
    expect(normalizeState(legacy)!.conceptsReadLevel).toEqual({});
    expect(
      normalizeState({
        ...legacy,
        conceptsReadLevel: {
          'xavier-colsono': 2,
          bad: 'x',
          negative: -1,
          inf: Infinity,
        },
      })!.conceptsReadLevel
    ).toEqual({ 'xavier-colsono': 2 });
    // S6-2 新增欄位：舊 blob 沒有時補 null / 初始值
    expect(normalizeState(legacy)!.lastVisitedPageId).toBeNull();
    expect(normalizeState(legacy)!.lastVisitedAt).toBeNull();
    expect(normalizeState(legacy)!.lostBookmark).toEqual({
      chancePct: 20,
      visible: false,
    });
    // chancePct 超界時 clamp 到 0~100
    expect(
      normalizeState({
        ...legacy,
        lostBookmark: { chancePct: 250, visible: true },
      })!.lostBookmark
    ).toEqual({ chancePct: 100, visible: true });
  });

  it('updateConceptsReadLevel 水位單調不降，非法值防禦', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.updateConceptsReadLevel({ 'xavier-colsono': 2, novia: 0 });
    expect(uepProgress.getState().conceptsReadLevel).toEqual({
      'xavier-colsono': 2,
      novia: 0,
    });
    // 低於現值 / 相等 → no-op；非法值剔除
    uepProgress.updateConceptsReadLevel({
      'xavier-colsono': 1,
      novia: 0,
      bad: NaN,
    });
    expect(uepProgress.getState().conceptsReadLevel).toEqual({
      'xavier-colsono': 2,
      novia: 0,
    });
    // 高於現值 → 更新
    uepProgress.updateConceptsReadLevel({ 'xavier-colsono': 3 });
    expect(uepProgress.getState().conceptsReadLevel['xavier-colsono']).toBe(3);
  });

  it('markPageVisited 記錄最後造訪頁與時間', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.markPageVisited('history/u/1');
    const state = uepProgress.getState();
    expect(state.lastVisitedPageId).toBe('history/u/1');
    expect(typeof state.lastVisitedAt).toBe('string');
    uepProgress.markPageVisited('history/u/1/1-1');
    expect(uepProgress.getState().lastVisitedPageId).toBe('history/u/1/1-1');
    uepProgress.markPageVisited(''); // 空字串 no-op
    expect(uepProgress.getState().lastVisitedPageId).toBe('history/u/1/1-1');
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
      islandsDisabled: [],
      pageMarkers: {},
      lastVisitedPageId: null,
      lastVisitedAt: null,
      lostBookmark: { chancePct: 20, visible: false },
      readingStats: { totalMs: 0 },
      conceptsReadLevel: {},
      storageNotes: [],
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

  it('hydrate: false 只換 adapter，不讀遠端也不動狀態', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.grantFlags(['local-flag']);
    const load = vi.fn(() => Promise.resolve(makeRemote()));
    await uepProgress.setAdapter(
      { load, save: () => Promise.resolve() },
      { hydrate: false }
    );
    expect(load).not.toHaveBeenCalled();
    expect(uepProgress.getState().flags).toEqual(['local-flag']);
  });

  /* ── hydrate 競態（2026-07-26 回歸）──────────────────────────────
   * `await load()` 是一段空窗期，UI 並沒有停下來。舊實作直接
   * `state = remote`，這期間的寫入全部蒸發；因為多數是 mount effect
   * 寫的、hydrate 又不會讓 effect 重跑，這一輪就永遠回不來。
   * 實際災情：四區解鎖儀式在首次載入時全部消失，要重新整理才出現。
   */
  describe('hydrate 空窗期的 mutation', () => {
    /** 建立一個「load 卡住、可手動放行」的 adapter */
    function deferredAdapter(remote: ProgressState) {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      return {
        adapter: {
          load: async () => {
            await gate;
            return remote;
          },
          save: () => Promise.resolve(),
        },
        release,
      };
    }

    it('空窗期授予的旗標不會被遠端快照吞掉', async () => {
      const { uepProgress } = await freshStore();
      const { adapter, release } = deferredAdapter(
        makeRemote({ flags: ['remote-flag'] })
      );

      const pending = uepProgress.setAdapter(adapter);
      // ReaderShell mount effect 等等，就發生在這個縫隙裡
      uepProgress.grantFlags(['granted-during-hydrate']);
      release();
      await pending;

      const { flags } = uepProgress.getState();
      expect(flags).toContain('remote-flag');
      expect(flags).toContain('granted-during-hydrate');
    });

    it('空窗期的完成頁與解鎖同樣保留，且結果有回寫', async () => {
      const { uepProgress } = await freshStore();
      const save = vi.fn(() => Promise.resolve());
      const { adapter, release } = deferredAdapter(
        makeRemote({
          completedPageIds: ['history/remote'],
          islandsUnlocked: ['echoes'],
        })
      );

      const pending = uepProgress.setAdapter({ ...adapter, save });
      uepProgress.markPageCompleted('history/local');
      uepProgress.unlockIsland('history');
      release();
      await pending;

      const state = uepProgress.getState();
      expect(state.completedPageIds).toEqual(
        expect.arrayContaining(['history/remote', 'history/local'])
      );
      expect(state.islandsUnlocked).toEqual(
        expect.arrayContaining(['echoes', 'history'])
      );
      // 合併結果必須落地，否則只活在記憶體、重載即失
      expect(save).toHaveBeenCalled();
    });

    it('觀測者印記任一邊落下就算數', async () => {
      const { uepProgress } = await freshStore();
      const { adapter, release } = deferredAdapter(
        makeRemote({ observerEver: false })
      );

      const pending = uepProgress.setAdapter(adapter);
      uepProgress.setView('observer');
      release();
      await pending;

      expect(uepProgress.getState().observerEver).toBe(true);
    });

    it('空窗期沒有 mutation 時，維持伺服器優先（不做多餘合併）', async () => {
      const { uepProgress } = await freshStore();
      uepProgress.grantFlags(['local-only']);
      await uepProgress.setAdapter({
        load: () => Promise.resolve(makeRemote({ flags: ['remote-flag'] })),
        save: () => Promise.resolve(),
      });
      expect(uepProgress.getState().flags).toEqual(['remote-flag']);
    });

    /**
     * 【回歸 2026-07-26，Codex 複核 blocker 1】
     *
     * hydrate 途中 adapter 被換掉（最常見：載入到一半使用者登出）時，
     * 稍後回來的舊帳號快照必須整個作廢。少了 generation guard：
     * state 被舊帳號資料覆蓋，且 persist() 會透過**新的** adapter
     * 把它寫回本機，登出的清除形同無效。
     */
    it('hydrate 途中 adapter 被更替 → 舊遠端結果整個作廢', async () => {
      const { uepProgress } = await freshStore();
      const { adapter: slowServer, release } = deferredAdapter(
        makeRemote({ flags: ['old-account'], observerEver: true })
      );

      const pending = uepProgress.setAdapter(slowServer);

      // 載入還沒回來，使用者就登出了：切回本地 adapter 並清空
      const localSave = vi.fn(() => Promise.resolve());
      await uepProgress.setAdapter(
        { load: () => Promise.resolve(null), save: localSave },
        { hydrate: false }
      );
      uepProgress.reset({ keepObserverEver: false });
      localSave.mockClear();

      release();
      await pending;

      const state = uepProgress.getState();
      expect(state.flags).toEqual([]);
      expect(state.observerEver).toBe(false);
      // 舊帳號的資料不得被寫回本機
      expect(localSave).not.toHaveBeenCalled();
    });
  });

  /* ── 伺服器權威 hydrate（版本衝突後的收斂）─────────────────────── */
  describe('hydrateAuthoritative', () => {
    /** 帶 loadAuthoritative 的假 server adapter，快照可隨時抽換 */
    function serverAdapter(
      snapshot: () => {
        state: ProgressState | null;
        observerEver: boolean;
      } | null
    ) {
      return {
        load: () => Promise.resolve(snapshot()?.state ?? null),
        save: vi.fn(() => Promise.resolve()),
        loadAuthoritative: () => Promise.resolve(snapshot()),
      };
    }

    it('遠端有資料 → 直接採用，不與本地聯集', async () => {
      const { uepProgress } = await freshStore();
      const adapter = serverAdapter(() => ({
        state: makeRemote({ flags: ['admin-edited'] }),
        observerEver: false,
      }));
      await uepProgress.setAdapter(adapter);

      uepProgress.grantFlags(['even-more-local']);
      await uepProgress.hydrateAuthoritative();

      // admin 的版本是唯一事實，本地那份正是被判定過期的東西
      expect(uepProgress.getState().flags).toEqual(['admin-edited']);
    });

    /**
     * 【回歸 2026-07-26，Codex 複核 blocker 3】
     * admin 清空後遠端是 null，此時**不得**把本地推上去——那等於原地
     * 復原他的清除，而且會再撞一次版本檢查形成 409 循環。
     */
    it('遠端為 null → 歸零且不上傳本地', async () => {
      const { uepProgress } = await freshStore();
      let snap: { state: ProgressState | null; observerEver: boolean } | null =
        { state: makeRemote({ flags: ['before-admin'] }), observerEver: false };
      const adapter = serverAdapter(() => snap);
      await uepProgress.setAdapter(adapter);
      expect(uepProgress.getState().flags).toEqual(['before-admin']);

      // admin 清空了這個帳號的進度
      snap = { state: null, observerEver: false };
      adapter.save.mockClear();
      await uepProgress.hydrateAuthoritative();

      expect(uepProgress.getState().flags).toEqual([]);
      expect(adapter.save).not.toHaveBeenCalled();
    });

    /**
     * 【回歸 2026-07-26，Codex re-review #2】
     * 讀不到伺服器時必須保持現狀。舊實作走 `load()`，它在 GET 失敗時
     * fallback 本地鏡像，等於把過期資料當成伺服器事實採用，下一次
     * mutation 再帶著新版本號寫回去，繞過整個衝突偵測。
     */
    it('讀不到伺服器 → 保持現狀，不歸零也不採用本地鏡像', async () => {
      const { uepProgress } = await freshStore();
      const adapter = serverAdapter(() => ({
        state: makeRemote({ flags: ['server-truth'] }),
        observerEver: false,
      }));
      await uepProgress.setAdapter(adapter);
      uepProgress.grantFlags(['local-since']);

      // 伺服器讀取失敗
      const failing = {
        load: () => Promise.resolve(null),
        save: vi.fn(() => Promise.resolve()),
        loadAuthoritative: () => Promise.resolve(null),
      };
      await uepProgress.setAdapter(failing, { hydrate: false });
      const before = uepProgress.getState();

      await uepProgress.hydrateAuthoritative();

      expect(uepProgress.getState()).toBe(before);
      expect(failing.save).not.toHaveBeenCalled();
    });

    /**
     * 【回歸 2026-07-26，Codex re-review #3】內容洩漏防線。
     * admin 清空 progress 時 blob 變 null 但 DB 的 observer_ever 保留。
     * 若跟著 blob 把 observerEver 歸零，前端會誤判使用者是純潔者，
     * 讓 pristineOnly（純潔者限定）內容對印記者顯示出來。
     */
    it('遠端為 null 但伺服器仍有印記 → observerEver 必須保留', async () => {
      const { uepProgress } = await freshStore();
      const adapter = serverAdapter(() => ({
        state: null,
        observerEver: true,
      }));
      await uepProgress.setAdapter(adapter, { hydrate: false });

      await uepProgress.hydrateAuthoritative();

      expect(uepProgress.getState().flags).toEqual([]);
      expect(uepProgress.getState().observerEver).toBe(true);
    });

    it('伺服器印記為準——blob 說有、伺服器說沒有時以伺服器為準', async () => {
      const { uepProgress } = await freshStore();
      const adapter = serverAdapter(() => ({
        state: makeRemote({ observerEver: true }),
        observerEver: false,
      }));
      await uepProgress.setAdapter(adapter, { hydrate: false });

      await uepProgress.hydrateAuthoritative();

      expect(uepProgress.getState().observerEver).toBe(false);
    });
  });
});

describe('sweepOrphanCompletions', () => {
  // 建立三頁鏈：A → B → C（B 依賴 A、C 依賴 B）的 tree adapter
  function makeChainTree() {
    const nodes = new Map<string, { metadata: Record<string, unknown> }>([
      ['A', { metadata: { progressPage: true } }],
      ['B', { metadata: { progressPage: true } }],
      ['C', { metadata: { progressPage: true } }],
    ]);
    const order = ['A', 'B', 'C'];
    return {
      getNode: (id: string) => nodes.get(id),
      getParent: () => undefined,
      getParentId: () => null,
      getPreviousProgressSiblingId: (id: string) => {
        const idx = order.indexOf(id);
        return idx > 0 ? order[idx - 1] : undefined;
      },
      getProgressDescendantIds: () => [],
    };
  }

  it('孤兒 completed:C（B 未完成）→ 清除', async () => {
    window.localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        view: 'explorer',
        observerEver: false,
        flags: ['completed:C'],
        completedPageIds: [],
        islandsUnlocked: [],
        pageMarkers: {},
        updatedAt: '2026-07-03T00:00:00.000Z',
      })
    );
    const { uepProgress } = await freshStore();
    const removed = uepProgress.sweepOrphanCompletions(makeChainTree());
    expect(removed).toEqual(['completed:C']);
    expect(uepProgress.getState().flags).toEqual([]);
  });

  it('合法鏈 A→B→C 全部 completed → 都保留', async () => {
    window.localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        view: 'explorer',
        observerEver: false,
        flags: ['completed:A', 'completed:B', 'completed:C'],
        completedPageIds: [],
        islandsUnlocked: [],
        pageMarkers: {},
        updatedAt: '2026-07-03T00:00:00.000Z',
      })
    );
    const { uepProgress } = await freshStore();
    const removed = uepProgress.sweepOrphanCompletions(makeChainTree());
    expect(removed).toEqual([]);
    expect(uepProgress.getState().flags).toHaveLength(3);
  });

  it('混合：completed:A 合法保留、completed:C（B 缺失）清除', async () => {
    window.localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        view: 'explorer',
        observerEver: false,
        flags: ['completed:A', 'completed:C', 'met:novia'],
        completedPageIds: [],
        islandsUnlocked: [],
        pageMarkers: {},
        updatedAt: '2026-07-03T00:00:00.000Z',
      })
    );
    const { uepProgress } = await freshStore();
    const removed = uepProgress.sweepOrphanCompletions(makeChainTree());
    expect(removed).toEqual(['completed:C']);
    // 非 completed:* 的自訂旗標（met:novia）不受影響
    expect(uepProgress.getState().flags).toEqual(['completed:A', 'met:novia']);
  });

  it('未識別頁面（tree 中不存在）保守保留', async () => {
    window.localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        view: 'explorer',
        observerEver: false,
        flags: ['completed:ghost'],
        completedPageIds: [],
        islandsUnlocked: [],
        pageMarkers: {},
        updatedAt: '2026-07-03T00:00:00.000Z',
      })
    );
    const { uepProgress } = await freshStore();
    const removed = uepProgress.sweepOrphanCompletions(makeChainTree());
    expect(removed).toEqual([]);
    expect(uepProgress.getState().flags).toEqual(['completed:ghost']);
  });

  it('無 completed:* 旗標 → no-op、不觸發 mutate', async () => {
    window.localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        view: 'explorer',
        observerEver: false,
        flags: ['met:novia'],
        completedPageIds: [],
        islandsUnlocked: [],
        pageMarkers: {},
        updatedAt: '2026-07-03T00:00:00.000Z',
      })
    );
    const { uepProgress } = await freshStore();
    const before = uepProgress.getState().updatedAt;
    const removed = uepProgress.sweepOrphanCompletions(makeChainTree());
    expect(removed).toEqual([]);
    // 沒觸發 mutate → updatedAt 不變
    expect(uepProgress.getState().updatedAt).toBe(before);
  });

  it('static-locked 頁面的 completed:* 亦視為孤兒清除（2026-07-03 修）', async () => {
    // 靜態鎖頁面不可能被合法完成，即使 flag 存在也應被視為孤兒
    const nodes = new Map<string, { metadata: Record<string, unknown> }>([
      ['locked-page', { metadata: { locked: true, progressPage: true } }],
    ]);
    const tree = {
      getNode: (id: string) => nodes.get(id),
      getParent: () => undefined,
      getParentId: () => null,
      getPreviousProgressSiblingId: () => undefined,
      getProgressDescendantIds: () => [],
    };
    window.localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        view: 'explorer',
        observerEver: false,
        flags: ['completed:locked-page'],
        completedPageIds: [],
        islandsUnlocked: [],
        pageMarkers: {},
        updatedAt: '2026-07-03T00:00:00.000Z',
      })
    );
    const { uepProgress } = await freshStore();
    const removed = uepProgress.sweepOrphanCompletions(tree);
    expect(removed).toEqual(['completed:locked-page']);
    expect(uepProgress.getState().flags).toEqual([]);
  });

  it('清理後發 sweep 事件並持久化', async () => {
    window.localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        view: 'explorer',
        observerEver: false,
        flags: ['completed:C'],
        completedPageIds: [],
        islandsUnlocked: [],
        pageMarkers: {},
        updatedAt: '2026-07-03T00:00:00.000Z',
      })
    );
    const { uepProgress, PROGRESS_CHANGE_EVENT } = await freshStore();
    let receivedSource: string | null = null;
    const handler = (evt: Event) => {
      receivedSource = (evt as CustomEvent).detail.source;
    };
    window.addEventListener(PROGRESS_CHANGE_EVENT, handler);
    uepProgress.sweepOrphanCompletions(makeChainTree());
    window.removeEventListener(PROGRESS_CHANGE_EVENT, handler);
    expect(receivedSource).toBe('sweep');
    // 持久化：localStorage 已更新
    const raw = JSON.parse(window.localStorage.getItem(PROGRESS_STORAGE_KEY)!);
    expect(raw.flags).toEqual([]);
  });
});

describe('normalizeState', () => {
  it('欄位缺漏時以初始值補齊（observer 視角依不變量補上印記）', () => {
    const result = normalizeState({ view: 'observer' });
    expect(result).not.toBeNull();
    expect(result!.view).toBe('observer');
    expect(result!.flags).toEqual([]);
    // 不變量：處於觀測者視角必然有印記
    expect(result!.observerEver).toBe(true);
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
