/**
 * 便條釘選層 — 中央 Store（S9-A.4）
 *
 * 使用者把便條拖出浮島釘在頁面內容旁時，這裡負責記錄：
 *  - 便條釘在哪張 pathname（location.pathname）
 *  - 錨定方式（element 錨點 or page 級）+ 偏移
 *  - 頁面標籤（暗掉便條顯示「釘在 XXX」）
 *
 * ⚠️ **不進 ProgressState**——釘選是「這台瀏覽器把便利貼貼在這頁這個位置」
 * 的本機物理概念，不跨裝置。裝置 A 釘的便條，裝置 B 上不釘（但便條內容
 * 兩邊同步）。「暗掉」判定也是本地的——A 上暗、B 上正常。
 *
 * 跨 React island 共享沿 audioStore / progressStore 慣例：
 * module-level state + `window.__uepStoragePins` bridge + subscribe/notify。
 *
 * 生命週期接線（艾斯維爾 07/21 定案）：
 *  - 登出/reset → `clearAll()`（PROGRESS_CHANGE source='reset' 監聽）
 *  - 便條刪除 → 該便條的釘選一併 unpin（sweepOrphans 每次 progress-change
 *    掃 storageNotes 集合，凡是 pinned 但已不存在的一律 drop）
 *
 * 依賴方向：可 import progress；**禁止 import islands/islandRuntime**
 * （避免循環依賴，同 audioStore 慣例）。
 */

import { PROGRESS_CHANGE_EVENT, getProgressManager } from '../../progress';
import type { ProgressChangeDetail } from '../../progress';

/** 錨定方式：element = 錨在內容元素；page = 頁面級（互動頁降級 or 錨點失效退路） */
export type PinAnchorKind = 'element' | 'page';

/**
 * 一張釘選便條的完整狀態。
 * `noteId` 對應 ProgressState.storageNotes 的 id——本體變、釘選跟著變。
 */
export interface PinnedNote {
  /** 對應 ProgressState.storageNotes 的 id */
  noteId: string;
  /** 釘在哪頁（location.pathname） */
  pagePath: string;
  /** 用來導向 + 島 header 顯示（釘選時快照，避免導向時查不到） */
  zone: string | null;
  /** 頁面標籤（暗掉便條顯示「釘在 XXX」，導向 toast 用） */
  pageLabel: string;
  /** 錨定方式 */
  anchorKind: PinAnchorKind;
  /**
   * element 錨點 id（如 `p-3`）；`anchorKind = 'page'` 時為 null。
   * 與 contentAnchors.ts 的 anchorId 對接。
   */
  anchorId: string | null;
  /**
   * element：drop 點相對錨點左上角的偏移；page：相對容器頂端 / viewport 的偏移。
   */
  offsetX: number;
  offsetY: number;
  /** 釘選建立時間（ISO 8601，供 debug） */
  createdAt: string;
}

/** localStorage key，含 schema 版本以利未來遷移（Test Mode 環境隔離同 progress 慣例） */
export const PINNED_STORAGE_KEY = 'uep.storage.pinned.v1';

type Listener = (pins: PinnedNote[]) => void;

declare global {
  interface Window {
    __uepStoragePins?: typeof uepStoragePins;
  }
}

/* ── module-level 狀態 ── */
let pins: PinnedNote[] = bootstrap();
const listeners: Listener[] = [];

function bootstrap(): PinnedNote[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizePins(parsed);
  } catch {
    return [];
  }
}

/** 從 localStorage 讀回的資料格式驗證，剔除壞值 */
function normalizePins(raw: unknown): PinnedNote[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is PinnedNote =>
      typeof p === 'object' &&
      p !== null &&
      typeof (p as PinnedNote).noteId === 'string' &&
      typeof (p as PinnedNote).pagePath === 'string' &&
      typeof (p as PinnedNote).pageLabel === 'string' &&
      ((p as PinnedNote).anchorKind === 'element' ||
        (p as PinnedNote).anchorKind === 'page') &&
      (typeof (p as PinnedNote).anchorId === 'string' ||
        (p as PinnedNote).anchorId === null) &&
      typeof (p as PinnedNote).offsetX === 'number' &&
      Number.isFinite((p as PinnedNote).offsetX) &&
      typeof (p as PinnedNote).offsetY === 'number' &&
      Number.isFinite((p as PinnedNote).offsetY) &&
      typeof (p as PinnedNote).createdAt === 'string'
  );
}

function persist(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // localStorage 滿載或被禁用 → 靜默失敗，記憶體版仍生效
  }
}

function notify(): void {
  const snapshot = pins;
  listeners.forEach((fn) => fn(snapshot));
}

/**
 * 掃除孤兒釘選——凡 pinned 便條的 noteId 已不在 storageNotes 中的一律 drop。
 * 便條刪除、登出/reset（storageNotes 全清）、setAdapter hydrate（切帳號）
 * 都會觸發此路徑。
 *
 * 回傳是否有動作（給呼叫端決定要不要 notify）。
 */
function sweepOrphans(existingNoteIds: Set<string>): boolean {
  const before = pins.length;
  pins = pins.filter((p) => existingNoteIds.has(p.noteId));
  return pins.length !== before;
}

/* ── 公開 API ── */
export const uepStoragePins = {
  /** 目前所有釘選（不篩頁） */
  getAll(): PinnedNote[] {
    return pins;
  },

  /** 取當前頁的釘選（PinnedNoteLayer 逐頁過濾用） */
  getForPage(pagePath: string): PinnedNote[] {
    return pins.filter((p) => p.pagePath === pagePath);
  },

  /** 該便條是否已釘選（島 pool 判暗掉） */
  isPinned(noteId: string): boolean {
    return pins.some((p) => p.noteId === noteId);
  },

  /** 取某便條的釘選資訊（點暗掉便條 → 導向釘選頁時用） */
  getPinnedMeta(noteId: string): PinnedNote | null {
    return pins.find((p) => p.noteId === noteId) ?? null;
  },

  /**
   * 建立/覆蓋釘選。同一 noteId 已存在時**覆蓋**（拖動已釘的便條 → 更新位置）。
   * 語意：一張便條全站最多一個釘選實例（艾斯維爾定案）。
   */
  pin(pinned: PinnedNote): void {
    const idx = pins.findIndex((p) => p.noteId === pinned.noteId);
    if (idx >= 0) {
      pins = pins.map((p) => (p.noteId === pinned.noteId ? pinned : p));
    } else {
      pins = [...pins, pinned];
    }
    persist();
    notify();
  },

  /** 拆除釘選（該便條回到 pool 恢復可用） */
  unpin(noteId: string): void {
    const before = pins.length;
    pins = pins.filter((p) => p.noteId !== noteId);
    if (pins.length === before) return; // 未動 → 不通知
    persist();
    notify();
  },

  /**
   * 清空所有釘選（登出/reset 呼叫）。
   * 便條本體另由 ProgressState 管；這裡只清場上。
   */
  clearAll(): void {
    if (pins.length === 0) return;
    pins = [];
    persist();
    notify();
  },

  /** 訂閱變更；回傳取消訂閱函式 */
  subscribe(listener: Listener): () => void {
    listeners.push(listener);
    return () => {
      const i = listeners.indexOf(listener);
      if (i > -1) listeners.splice(i, 1);
    };
  },

  /** 測試專用：重置 module 狀態（vi.resetModules 不會清 localStorage） */
  _resetForTest(): void {
    pins = [];
    listeners.length = 0;
  },
};

/* ── 生命週期接線（PROGRESS_CHANGE：reset 清空、任何 mutation 掃孤兒） ── */
if (typeof window !== 'undefined') {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<ProgressChangeDetail>).detail;
    if (!detail) return;

    // 1. reset / hydrate（切帳號）→ 直接清空場上釘選（便條本體也全換）
    if (detail.source === 'reset' || detail.source === 'hydrate') {
      uepStoragePins.clearAll();
      return;
    }

    // 2. storage-note 或其他 mutation → 掃孤兒
    //    便條刪除時 pinned 的那張也一起 drop
    const existing = new Set(detail.state.storageNotes.map((n) => n.id));
    if (sweepOrphans(existing)) {
      persist();
      notify();
    }
  };
  window.addEventListener(PROGRESS_CHANGE_EVENT, handler);

  // Boot 時也掃一次——localStorage 有殘留但 progress 沒有對應便條的話（如
  // 上次 session 刪了便條，那時剛好無法 persist）
  try {
    const currentNotes = getProgressManager().getState().storageNotes;
    const existing = new Set(currentNotes.map((n) => n.id));
    if (sweepOrphans(existing)) persist();
  } catch {
    // getProgressManager 尚未就緒 → 忽略，之後 progress-change 會補掃
  }
}

/* ── window bridge（跨 React island 單例保證） ── */
if (typeof window !== 'undefined' && !window.__uepStoragePins) {
  window.__uepStoragePins = uepStoragePins;
}

/** 取全域單例（優先 window bridge，SSR fallback 為 module 實例） */
export function getPinnedStore(): typeof uepStoragePins {
  if (typeof window !== 'undefined' && window.__uepStoragePins) {
    return window.__uepStoragePins;
  }
  return uepStoragePins;
}
