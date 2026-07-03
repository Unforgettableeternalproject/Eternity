/**
 * UEP 進度系統 — 中央 Store（module singleton + window bridge）
 *
 * 跨 React island 共享模式沿用 UepToast/UepDialog 的做法：
 * module-level state + `window.__uepProgress` bridge + subscribe/notify。
 * 另外在每次變更時 dispatch `uep:progress-change` CustomEvent，
 * 讓非 React 的 Astro script 也能監聽。
 *
 * 所有 mutation 一律走此 store，禁止各元件自行讀寫 localStorage。
 */

import { LocalStorageAdapter } from './adapters';
import type { ProgressAdapter, ProgressState, ViewMode } from './types';
import { createInitialState } from './types';

/** 進度變更事件名稱（CustomEvent<ProgressChangeDetail>） */
export const PROGRESS_CHANGE_EVENT = 'uep:progress-change';

/** 進度變更事件的 detail 內容 */
export interface ProgressChangeDetail {
  state: ProgressState;
  /** 本次變更的來源操作，方便消費端過濾 */
  source:
    | 'init'
    | 'view-change'
    | 'flags-granted'
    | 'page-completed'
    | 'island-unlocked'
    | 'marker-update'
    | 'hydrate'
    | 'reset';
}

type Listener = (state: ProgressState, detail: ProgressChangeDetail) => void;

declare global {
  interface Window {
    __uepProgress?: typeof uepProgress;
  }
}

/* ── module-level 狀態 ── */
let adapter: ProgressAdapter = new LocalStorageAdapter();
let state: ProgressState = bootstrap();
const listeners: Listener[] = [];

/** 初始化：同步從 localStorage 讀取，避免 first paint 閃爍 */
function bootstrap(): ProgressState {
  if (typeof window === 'undefined') return createInitialState();
  const local = new LocalStorageAdapter().loadSync();
  return local ?? createInitialState();
}

function persist(): void {
  void adapter.save(state);
}

function notify(source: ProgressChangeDetail['source']): void {
  const detail: ProgressChangeDetail = { state, source };
  listeners.forEach((fn) => fn(state, detail));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<ProgressChangeDetail>(PROGRESS_CHANGE_EVENT, { detail })
    );
  }
}

function mutate(
  source: ProgressChangeDetail['source'],
  updater: (prev: ProgressState) => ProgressState
): void {
  state = { ...updater(state), updatedAt: new Date().toISOString() };
  persist();
  notify(source);
}

/* ── 公開 API ── */
export const uepProgress = {
  /** 取得目前狀態（唯讀快照，勿直接修改） */
  getState(): ProgressState {
    return state;
  },

  /**
   * 切換視角。切換至 observer 時同步寫入永久印記 observerEver。
   * 注意：劇透警告的確認流程由 UI 層負責（ViewSwitch），store 不做攔截。
   */
  setView(view: ViewMode): void {
    if (view === state.view) return;
    mutate('view-change', (prev) => ({
      ...prev,
      view,
      observerEver: prev.observerEver || view === 'observer',
    }));
  },

  /** 授予旗標（重複授予自動去重） */
  grantFlags(flags: string[]): void {
    const next = flags.filter((f) => !state.flags.includes(f));
    if (next.length === 0) return;
    mutate('flags-granted', (prev) => ({
      ...prev,
      flags: [...prev.flags, ...next],
    }));
  },

  /** 是否持有旗標 */
  hasFlag(flag: string): boolean {
    return state.flags.includes(flag);
  },

  /** 標記 History 頁面為已完成 */
  markPageCompleted(pageId: string): void {
    if (state.completedPageIds.includes(pageId)) return;
    mutate('page-completed', (prev) => ({
      ...prev,
      completedPageIds: [...prev.completedPageIds, pageId],
    }));
  },

  /** 解鎖浮島 */
  unlockIsland(islandId: string): void {
    if (state.islandsUnlocked.includes(islandId)) return;
    mutate('island-unlocked', (prev) => ({
      ...prev,
      islandsUnlocked: [...prev.islandsUnlocked, islandId],
    }));
  },

  /** 更新頁面掃描線進度（S2 掃描線系統呼叫） */
  updatePageMarker(
    pageId: string,
    maxMarkerIdx: number,
    lastMarkerIdx: number,
    totalMarkers: number
  ): void {
    const prev = state.pageMarkers[pageId];
    const nextMax = Math.max(prev?.maxMarkerIdx ?? 0, maxMarkerIdx);
    if (
      prev &&
      prev.maxMarkerIdx === nextMax &&
      prev.lastMarkerIdx === lastMarkerIdx
    )
      return;
    mutate('marker-update', (p) => ({
      ...p,
      pageMarkers: {
        ...p.pageMarkers,
        [pageId]: {
          maxMarkerIdx: nextMax,
          lastMarkerIdx,
          totalMarkers,
          updatedAt: new Date().toISOString(),
        },
      },
    }));
  },

  /**
   * 替換儲存 adapter（S5 登入後切換 ServerAdapter）。
   * adapter.load() 有資料時以其為準覆蓋本地狀態（伺服器優先策略）。
   */
  async setAdapter(next: ProgressAdapter): Promise<void> {
    adapter = next;
    const remote = await next.load();
    if (remote) {
      state = remote;
      notify('hydrate');
    } else {
      // 遠端無資料：把本地進度上傳作為初始值
      persist();
    }
  },

  /**
   * 重置進度。觀測者印記為永久標記，不隨 reset 清除。
   */
  reset(): void {
    mutate('reset', (prev) => ({
      ...createInitialState(),
      observerEver: prev.observerEver,
    }));
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
if (typeof window !== 'undefined' && !window.__uepProgress) {
  window.__uepProgress = uepProgress;
}

/** 取得全域單例（優先 window bridge，SSR fallback 為 module 實例） */
export function getProgressManager(): typeof uepProgress {
  if (typeof window !== 'undefined' && window.__uepProgress) {
    return window.__uepProgress;
  }
  return uepProgress;
}
