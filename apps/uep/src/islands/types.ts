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
  | 'top-left'
  | 'center-right'
  | 'center-left';

/**
 * 視窗外殼樣式（S9-C.1）
 * - `default`：中性白框 + 圖示標頭（concepts 終端沿用）
 * - `bare`：外殼不畫任何東西，材質／標頭／收合鈕全由島自理
 */
export type IslandShell = 'default' | 'bare';

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
  /** 外殼樣式（預設 default） */
  shell?: IslandShell;
  /**
   * 離場動畫時長（ms）。必須與該島 CSS 的收合動畫對齊——
   * DraggableIsland 以此設定保底計時器（reduced-motion 下 animationend
   * 不會觸發，只剩計時器負責收束）。未指定用 DEFAULT_LEAVE_ANIM_MS。
   */
  leaveMs?: number;
}

/** 預設離場動畫時長（ms）——與 islands.css 的 uep-island-leave 對齊 */
export const DEFAULT_LEAVE_ANIM_MS = 260;

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
export const ISLAND_SCHEMA_VERSION = 2;

/** 浮島 z-index 層帶：2000-2999（dock 1999、Minimap 1998 之上、Toast 10000 之下） */
export const ISLAND_Z_BASE = 2000;

/**
 * 小地圖 z-index（S10-0）。
 *
 * 原本硬編碼 300，會被 Reader 頂層（350）、IntroOverlay（500）、釘選便條
 * 各層（500-1500）、Storage 解鎖小物件（1899）逐一蓋過。提到 dock 之下
 * 一階，既脫離內容層，又維持既有的 Minimap < Dock < Island 相對次序。
 *
 * 不參與 focusOrder——小地圖是常駐參考件，不是可聚焦的視窗。
 */
export const MINIMAP_Z = ISLAND_Z_BASE - 2;

/**
 * 五座浮島的靜態定義。
 *
 * S9-C 起除 concepts 外全走 bare 外殼——v2 設計稿的四座島各自是一件物品
 * （紙／水／投影／便條），中性白框會把材質切斷。concepts 終端機的視覺
 * 本來就自成一格，維持 default。
 */
export const ISLAND_DEFINITIONS: Record<IslandId, IslandDefinition> = {
  history: {
    id: 'history',
    title: '旅程之書',
    icon: '📖',
    defaultCorner: 'bottom-right',
    width: 340,
    shell: 'bare',
    leaveMs: 380,
  },
  concepts: {
    id: 'concepts',
    title: '移動終端',
    icon: '›_',
    defaultCorner: 'top-right',
    width: 380,
    // S9-C.12 起五座島一致走 bare：終端自畫機殼標頭，島名字級才對得上
    // 另外四座。收合仍是自己的 CRT 關機動畫（艾斯維爾 2026-07-25）
    shell: 'bare',
    leaveMs: 420,
  },
  echoes: {
    id: 'echoes',
    title: '流浪回聲',
    icon: '♫',
    defaultCorner: 'center-right',
    // 300 = v2 水面提案的版面寬度（原 292 的緊湊橫排格局已由水池取代）
    width: 300,
    shell: 'bare',
    leaveMs: 420,
  },
  visuals: {
    id: 'visuals',
    title: '浮動幻影',
    icon: '🖼',
    defaultCorner: 'top-left',
    // 320：v2 投影格局在 360 下佔掉太多畫面（艾斯維爾 2026-07-25）
    width: 320,
    shell: 'bare',
    leaveMs: 460,
  },
  storage: {
    id: 'storage',
    title: '便條紙',
    icon: '✎',
    defaultCorner: 'center-left',
    width: 320,
    shell: 'bare',
    leaveMs: 400,
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

/**
 * 跨島關聯事件的 detail 內容。
 *
 * 互聯有兩個方向，目標島不同（艾斯維爾 2026-07-27 定案）：
 * - **storyKey**（劇情歌／插圖）→ History 島，列出該劇情點的段落
 * - **entityKey**（Concepts 條目）→ Echoes／Visuals 島，列出該 entity
 *   對應的歌與畫廊
 *
 * 所以目標島是 payload 的一部分而不是寫死——entityKey 一次可能要同時
 * 送給兩座島（一個 entity 可以既有歌又有畫廊）。
 */
export interface IslandRelatedDetail {
  /** 要顯示這則線索的島 */
  targetIsland: IslandId;
  /** 來源 zone（如 concepts/echoes/visuals） */
  sourceZone: IslandId;
  /**
   * 相關頁面。標題由**來源端**一併帶上——反查結果本來就含標題
   * （錨點端點回 pageTitle、entity 端點回 title），島端不必為了顯示
   * 一行字各自維護一份頁面索引。
   */
  items: IslandRelatedItem[];
  /** 來源說明（條目名／曲名／畫廊名），島端顯示用 */
  label?: string;
}

/** 線索卡的一列 */
export interface IslandRelatedItem {
  /** 頁面 id（帶 area prefix，如 history/u/1-1、echoes/characters/…） */
  pageId: string;
  /** 顯示標題 */
  title: string;
}
