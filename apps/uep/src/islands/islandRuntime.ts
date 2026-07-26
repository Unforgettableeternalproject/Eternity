/**
 * UEP 浮島系統 — 中央 Runtime（module singleton + window bridge）
 *
 * 跨 React island 共享模式沿用 progressStore / UepToast 的做法：
 * module-level state + `window.__uepIslands` bridge + subscribe/notify，
 * 每次變更 dispatch `uep:island-change` CustomEvent。
 *
 * Runtime 只管「視窗狀態」：開合、位置、焦點順序（z-index）。
 * 「能不能用」的守門（視角/解鎖/停用）是 progress 的事，見下方 gating helpers。
 */

import { getReaderAuth } from '../auth';
import { PROGRESS_CHANGE_EVENT, getProgressManager } from '../progress';
import type { ProgressChangeDetail, ProgressState } from '../progress';

import { clearAllChipAttention } from './chipAttention';
import { clearTerminalLog } from './concepts/terminalLog';
import { clearPhantomGallery } from './visuals/phantomBridge';
import {
  clearAllWindowStates,
  loadWindowState,
  saveWindowState,
} from './persistence';
import type { IslandId, IslandWindowState } from './types';
import { ISLAND_IDS, ISLAND_Z_BASE, createInitialWindowState } from './types';

/** 浮島變更事件名稱（CustomEvent<IslandChangeDetail>） */
export const ISLAND_CHANGE_EVENT = 'uep:island-change';

/** 浮島變更事件的 detail 內容 */
export interface IslandChangeDetail {
  state: IslandRuntimeState;
  /** 本次變更的來源操作，方便消費端過濾 */
  source: 'open' | 'close' | 'move' | 'focus' | 'hydrate' | 'reset';
}

/** Runtime 全體狀態快照（唯讀） */
export interface IslandRuntimeState {
  /** 各浮島的視窗狀態（尚未 hydrate 的島不在其中） */
  windows: Partial<Record<IslandId, IslandWindowState>>;
  /** 焦點順序（越後面越上層），只含目前展開的島 */
  focusOrder: IslandId[];
}

type Listener = (state: IslandRuntimeState, detail: IslandChangeDetail) => void;

declare global {
  interface Window {
    __uepIslands?: typeof uepIslands;
  }
}

/* ── module-level 狀態 ── */
let state: IslandRuntimeState = bootstrap();
const listeners: Listener[] = [];

/** 初始化：同步從 localStorage 讀回各島視窗狀態，開著的島進焦點序 */
function bootstrap(): IslandRuntimeState {
  const windows: IslandRuntimeState['windows'] = {};
  const focusOrder: IslandId[] = [];
  if (typeof window !== 'undefined') {
    for (const id of ISLAND_IDS) {
      const stored = loadWindowState(id);
      if (stored) {
        windows[id] = stored;
        if (stored.open) focusOrder.push(id);
      }
    }
  }
  return { windows, focusOrder };
}

function notify(source: IslandChangeDetail['source']): void {
  const detail: IslandChangeDetail = { state, source };
  listeners.forEach((fn) => fn(state, detail));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<IslandChangeDetail>(ISLAND_CHANGE_EVENT, { detail })
    );
  }
}

/** 更新單島視窗狀態並持久化 */
function mutateWindow(
  id: IslandId,
  source: IslandChangeDetail['source'],
  updater: (prev: IslandWindowState) => IslandWindowState,
  focusUpdater?: (prev: IslandId[]) => IslandId[]
): void {
  const prev = state.windows[id] ?? createInitialWindowState();
  const nextWindow = { ...updater(prev), updatedAt: new Date().toISOString() };
  state = {
    windows: { ...state.windows, [id]: nextWindow },
    focusOrder: focusUpdater
      ? focusUpdater(state.focusOrder)
      : state.focusOrder,
  };
  saveWindowState(id, nextWindow);
  notify(source);
}

/** 從焦點序移除後推到最上層 */
function toTop(order: IslandId[], id: IslandId): IslandId[] {
  return [...order.filter((i) => i !== id), id];
}

/* ── 公開 API ── */
export const uepIslands = {
  /** 取得目前狀態（唯讀快照，勿直接修改） */
  getState(): IslandRuntimeState {
    return state;
  },

  /** 取得單島視窗狀態（未 hydrate 時回傳 null） */
  getWindow(id: IslandId): IslandWindowState | null {
    return state.windows[id] ?? null;
  },

  /** 展開浮島並取得焦點 */
  open(id: IslandId): void {
    mutateWindow(
      id,
      'open',
      (prev) => ({ ...prev, open: true }),
      (order) => toTop(order, id)
    );
  },

  /** 收合浮島（回 dock） */
  close(id: IslandId): void {
    const win = state.windows[id];
    if (!win || !win.open) return;
    mutateWindow(
      id,
      'close',
      (prev) => ({ ...prev, open: false }),
      (order) => order.filter((i) => i !== id)
    );
  },

  /** 展開 ↔ 收合 */
  toggle(id: IslandId): void {
    if (state.windows[id]?.open) {
      this.close(id);
    } else {
      this.open(id);
    }
  },

  /**
   * 全島一律收合進 dock（位置保留）——登入事件的入場整理用
   * （S7-C 驗收定案：登入瞬間不直接彈出整群浮島）。
   * 無開啟島時 no-op（不寫入、不通知）。
   */
  collapseAll(): void {
    const openIds = ISLAND_IDS.filter((id) => state.windows[id]?.open);
    if (openIds.length === 0) return;
    const windows = { ...state.windows };
    const stamp = new Date().toISOString();
    for (const id of openIds) {
      const next = { ...windows[id]!, open: false, updatedAt: stamp };
      windows[id] = next;
      saveWindowState(id, next);
    }
    state = { windows, focusOrder: [] };
    notify('close');
  },

  /**
   * 全面重置（S7 驗收 #9/#13）：清除所有島的視窗狀態（開合＋位置）
   * 與 localStorage 持久化，並清空 terminal 輸出歷史——登出與進度
   * reset 用（同瀏覽器換帳號不得看到上一個帳號的查詢紀錄）。
   * 登入維持 collapseAll（位置保留），兩者語意刻意不同。
   */
  resetAll(): void {
    clearAllWindowStates();
    clearTerminalLog();
    // 浮動幻影的目前投射與 pending 提示一併清除（同瀏覽器換帳號
    // 不得看到上一個帳號投射的畫廊——同 terminal 歷史語意）
    clearPhantomGallery();
    // 未過期的 chip 閃爍同理：換帳號後不該有上一個帳號的提示殘留在 dock
    clearAllChipAttention();
    state = { windows: {}, focusOrder: [] };
    notify('reset');
  },

  /** 更新拖曳後的位置（viewport 座標） */
  setPosition(id: IslandId, position: { left: number; top: number }): void {
    mutateWindow(id, 'move', (prev) => ({ ...prev, position }));
  },

  /** 將浮島推到焦點最上層 */
  focus(id: IslandId): void {
    if (!state.windows[id]?.open) return;
    const idx = state.focusOrder.indexOf(id);
    if (idx === state.focusOrder.length - 1) return; // 已是最上層
    state = { ...state, focusOrder: toTop(state.focusOrder, id) };
    notify('focus');
  },

  /** 取得浮島目前的 z-index（焦點越後越高；不在焦點序 = 底層） */
  zIndexOf(id: IslandId): number {
    const idx = state.focusOrder.indexOf(id);
    return ISLAND_Z_BASE + (idx === -1 ? 0 : idx + 1);
  },

  /** 訂閱狀態變更，回傳取消訂閱函式 */
  subscribe(listener: Listener): () => void {
    listeners.push(listener);
    return () => {
      const i = listeners.indexOf(listener);
      if (i > -1) listeners.splice(i, 1);
    };
  },
};

/* ── window bridge（跨 React island 單例保證） ── */
if (typeof window !== 'undefined' && !window.__uepIslands) {
  window.__uepIslands = uepIslands;
  // 登入事件（訪客 → 登入的轉變）：全島收合進 dock（S7-C 驗收定案）。
  // 頁面載入恢復既有 session 不經歷 null→session 轉變——換頁/重載
  // 照常還原上次開合狀態；refresh()/印記同步的 notify 也不會誤觸。
  // 登出事件（session → null）：全面重置（S7 驗收 #9）——視窗狀態
  // 與 terminal 歷史全清，同瀏覽器換帳號不得殘留上一帳號的痕跡。
  const auth = getReaderAuth();
  let wasLoggedIn = auth.isLoggedIn();
  auth.subscribe((session) => {
    const loggedIn = session !== null;
    if (loggedIn && !wasLoggedIn) uepIslands.collapseAll();
    if (!loggedIn && wasLoggedIn) uepIslands.resetAll();
    wasLoggedIn = loggedIn;
  });
  // 進度 reset（S7 驗收 #13）：小工具狀態一併清空。
  // 走 CustomEvent 不走 store 訂閱——避免 progress → islands 反向耦合。
  window.addEventListener(PROGRESS_CHANGE_EVENT, (e) => {
    const detail = (e as CustomEvent<ProgressChangeDetail>).detail;
    if (detail?.source === 'reset') uepIslands.resetAll();
  });
}

/** 取得全域單例（優先 window bridge，SSR fallback 為 module 實例） */
export function getIslandRuntime(): typeof uepIslands {
  if (typeof window !== 'undefined' && window.__uepIslands) {
    return window.__uepIslands;
  }
  return uepIslands;
}

/* ── gating helpers（progress 是唯一事實來源） ── */

/*
 * 2026-07-26 移除 `ZONE_VISITED_FLAG_PREFIX` / `zoneVisitedFlag()` /
 * `hasVisitedZone()`（艾斯維爾定案）。
 *
 * 「到過該 zone」原本是 S6 通用解鎖小物件的浮現條件；四 zone 改用專屬
 * 解鎖儀式後，儀式本身就發生在 Reader 內部，這個條件恆真而不再是守門，
 * 卻因為 mount effect 與遠端 hydrate 的競態而讓儀式整片消失。
 * 詳見 unlockRitual.ts。
 *
 * 既有使用者的 progress 裡仍留有 `zone:visited:*` 旗標，刻意不做清理——
 * 沒有任何消費端，屬無害殘留；主動改寫使用者資料的風險高於留著。
 */

/** 浮島是桌面版專屬功能；與既有 RWD 斷點保持一致。 */
export const ISLAND_DESKTOP_MIN_WIDTH = 761;

/** SSR 先放行，client hydration 後再依實際 viewport 守門。 */
export function isDesktopIslandViewport(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= ISLAND_DESKTOP_MIN_WIDTH;
}

/**
 * 浮島系統整體是否可用：**已登入的探索者**才有浮島
 * （艾斯維爾 2026-07-06 定案；觀測者/訪客都沒有）。
 *
 * 登入判定讀 auth singleton 而非參數——理由：登出後 ServerAdapter 的
 * write-through 鏡像仍含 islandsUnlocked，若守門不含登入，殘留狀態會讓
 * 島原地復活。此函式是所有守門的根（IslandHost / 解鎖小物件 /
 * shouldMountIsland → embed 可點判定 / 書籤儀式 eligible），在根上
 * 綁登入可一次涵蓋全部消費端。
 *
 * ⚠️ 消費端注意：auth 變化不保證觸發 progress notify（logout 的
 * setAdapter 在 localStorage 鏡像為空時不 notify）——React 消費端需
 * 另以 useReaderAuth() 訂閱 auth 變化（IslandHost / useUnlockEligibility
 * 已接）。
 */
export function canUseIslands(progress: ProgressState): boolean {
  return (
    isDesktopIslandViewport() &&
    progress.view === 'explorer' &&
    getReaderAuth().isLoggedIn()
  );
}

/** 指定浮島是否已解鎖（zone 首頁小物件點擊後授予） */
export function isIslandUnlocked(
  progress: ProgressState,
  id: IslandId
): boolean {
  return progress.islandsUnlocked.includes(id);
}

/** 指定浮島是否被使用者主動停用（設定視窗寫入） */
export function isIslandDisabled(
  progress: ProgressState,
  id: IslandId
): boolean {
  return progress.islandsDisabled.includes(id);
}

/** 指定浮島是否應該掛載 = 探索者 + 已解鎖 + 未被使用者停用 */
export function shouldMountIsland(
  progress: ProgressState,
  id: IslandId
): boolean {
  return (
    canUseIslands(progress) &&
    isIslandUnlocked(progress, id) &&
    !isIslandDisabled(progress, id)
  );
}

/** 便捷：解鎖浮島（轉呼叫 progress store，集中入口方便未來加儀式 hook） */
export function unlockIsland(id: IslandId): void {
  getProgressManager().unlockIsland(id);
}
