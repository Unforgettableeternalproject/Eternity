/**
 * UEP 進度系統 — 核心型別定義
 *
 * Epic 2 的地基：雙視角（探索者/觀測者）+ 旗標系統 + 閱讀進度。
 * 所有 zone 的內容解鎖判定都以這裡的 ProgressState 為唯一事實來源。
 */

/** 視角模式：探索者（進度限制）/ 觀測者（全開但無浮島） */
export type ViewMode = 'explorer' | 'observer';

/** 單一頁面的掃描線閱讀進度（S2 掃描線系統寫入） */
export interface PageMarkerProgress {
  /** 曾經到達的最遠標記點索引（進度判定用；哨兵索引 = totalMarkers） */
  maxMarkerIdx: number;
  /** 最後閱讀位置的標記點索引（「回到上次位置」用） */
  lastMarkerIdx: number;
  /**
   * 內容標記點總數（不含文末哨兵）。
   * 完成判定：maxMarkerIdx >= totalMarkers（= 通過哨兵，max 與 total 對齊）
   */
  totalMarkers: number;
  /** 最後更新時間（ISO 8601） */
  updatedAt: string;
}

/** 進度狀態 — localStorage / D1 progress 表的儲存單位 */
export interface ProgressState {
  /** schema 版本，未來遷移用 */
  version: number;
  /** 目前視角 */
  view: ViewMode;
  /**
   * 觀測者印記 — 曾切換至觀測者視角的永久標記，不可逆。
   * 影響 pristineOnly 內容的可見性（見 gating.ts）。
   * reset() 不會清除此欄位；註冊使用者以 D1 儲存值為準（S5）。
   */
  observerEver: boolean;
  /** 已授予的旗標（History FlagMarker 標註驅動授予） */
  flags: string[];
  /** 已完成閱讀的 History 頁面 id */
  completedPageIds: string[];
  /** 已解鎖的浮島 id（zone:visited:* 旗標的衍生快取） */
  islandsUnlocked: string[];
  /** 各頁面的掃描線進度，key 為 pageId */
  pageMarkers: Record<string, PageMarkerProgress>;
  /** 最後更新時間（ISO 8601） */
  updatedAt: string;
}

/** 進度狀態的儲存介面 — LocalStorageAdapter（S1）/ ServerAdapter（S5） */
export interface ProgressAdapter {
  /** 讀取狀態；不存在或不可用時回傳 null */
  load(): Promise<ProgressState | null>;
  /** 寫入狀態 */
  save(state: ProgressState): Promise<void>;
}

/** 目前 schema 版本 */
export const PROGRESS_SCHEMA_VERSION = 1;

/** 建立初始狀態（首次進站的探索者） */
export function createInitialState(): ProgressState {
  return {
    version: PROGRESS_SCHEMA_VERSION,
    view: 'explorer',
    observerEver: false,
    flags: [],
    completedPageIds: [],
    islandsUnlocked: [],
    pageMarkers: {},
    updatedAt: new Date().toISOString(),
  };
}
