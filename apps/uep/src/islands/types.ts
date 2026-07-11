/**
 * UEP 浮島系統 — 核心型別定義（Epic 2 S6）
 *
 * 浮島（Island）是探索者專屬的漂浮工具視窗：History 書、Concepts 終端、
 * Echoes 播放清單、Visuals 展示器、Storage 便條紙。
 *
 * 職責切分：
 * - 「是否解鎖」由 progress 系統管（ProgressState.islandsUnlocked，跨裝置同步）
 * - 「視窗狀態」（開合/位置）由本模組管（localStorage，裝置本地）
 * - 觀測者/訪客沒有浮島（掛載守門見 islandRuntime.canUseIslands）
 */

/** 浮島 id — 與 zone id 一一對應 */
export type IslandId =
  | 'history'
  | 'concepts'
  | 'echoes'
  | 'visuals'
  | 'storage';

/** 展開視窗的預設停靠角落 */
export type IslandCorner =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

/** 浮島的靜態定義（清單固定，不做動態註冊） */
export interface IslandDefinition {
  id: IslandId;
  /** 顯示名稱（dock chip 與視窗標題） */
  title: string;
  /** dock chip 圖示字元 */
  icon: string;
  /** 展開視窗預設角落（未拖曳過時使用） */
  defaultCorner: IslandCorner;
  /** 展開視窗寬度（px，桌面） */
  width: number;
}

/** 單一浮島的視窗狀態（localStorage 持久化單位） */
export interface IslandWindowState {
  /** schema 版本，未來遷移用 */
  version: number;
  /** 是否展開（false = 收合進 dock） */
  open: boolean;
  /**
   * 使用者拖曳後的位置（viewport 座標）。
   * null = 未拖曳過，展開時用 defaultCorner 計算。
   */
  position: { left: number; top: number } | null;
  /** 最後更新時間（ISO 8601） */
  updatedAt: string;
}

/** 視窗狀態 schema 版本 */
export const ISLAND_SCHEMA_VERSION = 1;

/** 浮島 z-index 層帶：2000-2999（Minimap 300 之上、Toast 10000 之下） */
export const ISLAND_Z_BASE = 2000;

/**
 * 五座浮島的靜態定義。
 * S6 只有 history 有實體元件；其餘定義先就位，S7/S8 接上元件即可。
 */
export const ISLAND_DEFINITIONS: Record<IslandId, IslandDefinition> = {
  history: {
    id: 'history',
    title: '旅程之書',
    icon: '📖',
    defaultCorner: 'bottom-right',
    width: 340,
  },
  concepts: {
    id: 'concepts',
    title: '移動終端',
    icon: '›_',
    defaultCorner: 'bottom-right',
    width: 380,
  },
  echoes: {
    id: 'echoes',
    title: '流浪回聲',
    icon: '♫',
    defaultCorner: 'bottom-right',
    // 292 = 設計稿定案寬度（黑球=播放鍵、橫排舞台的緊湊格局）
    width: 292,
  },
  visuals: {
    id: 'visuals',
    title: '掌上畫廊',
    icon: '❏',
    defaultCorner: 'bottom-right',
    width: 360,
  },
  storage: {
    id: 'storage',
    title: '便條紙',
    icon: '✎',
    defaultCorner: 'bottom-right',
    width: 320,
  },
};

/** 固定順序的浮島 id 清單（dock 顯示順序） */
export const ISLAND_IDS: IslandId[] = [
  'history',
  'concepts',
  'echoes',
  'visuals',
  'storage',
];

/** 型別守衛：unknown 字串是否為合法 IslandId */
export function isIslandId(value: unknown): value is IslandId {
  return typeof value === 'string' && (ISLAND_IDS as string[]).includes(value);
}

/** 建立初始視窗狀態（首次解鎖：展開、預設位置） */
export function createInitialWindowState(): IslandWindowState {
  return {
    version: ISLAND_SCHEMA_VERSION,
    open: true,
    position: null,
    updatedAt: new Date().toISOString(),
  };
}

/* ── 跨島關聯事件合約（S7/S8 消費，S6 先定契約不實作） ──
 *
 * 情境：使用者在 Echoes 遊歷某曲目 / 在 Visuals 查看某畫廊時，
 * 來源端 dispatch 此事件，History Island（旅程之書）動態展示
 * 對應章節讓使用者快速跳轉。
 *
 * dispatch 在 window 層（與 uep:entity-activate 同模式），
 * 島不必與來源端同處一棵 React 樹。
 */

/** 跨島關聯事件名稱（CustomEvent<IslandRelatedDetail>） */
export const ISLAND_RELATED_EVENT = 'uep:island-related';

/** 跨島關聯事件的 detail 內容 */
export interface IslandRelatedDetail {
  /** 來源 zone（如 echoes/visuals） */
  sourceZone: IslandId;
  /** 相關的 History 頁面 id（帶 area prefix，如 history/u/1-1） */
  historyPageIds: string[];
  /** 來源說明（如曲名/畫廊名），島端顯示用 */
  label?: string;
}
