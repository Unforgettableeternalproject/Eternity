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

/**
 * 便條「地點」小標的快照內容（S10-1 便條擴充）。
 * 只存快照，不存 pageTrail——完整階層若未來需要由 pageLabel 反查即時取得，
 * 不在便條建立當下就序列化整條麵包屑（避免不定長陣列失控）。
 */
export interface StorageNoteLocationSnapshot {
  /** zone id 字串快照（來源頁面事後可能不存在，不做 IslandId 型別綁定） */
  zone: string;
  /**
   * 來自 Reader 路由發佈的 pageContext.pageLabel（不是 document.title），
   * 截斷上限見 STORAGE_NOTE_LOCATION_LABEL_MAX。
   */
  pageLabel: string;
}

/** 便條地點小標 pageLabel 字數上限 */
export const STORAGE_NOTE_LOCATION_LABEL_MAX = 60;

/**
 * 便條島的單張便條（S9）。本體隨 ProgressState 跨裝置同步；
 * 釘選態（貼在哪頁哪個位置）另存 localStorage（見 islands/storage/pinnedNotes），
 * 因為「把便利貼貼在這台螢幕這個位置」是本機物理概念，不跨裝置。
 */
export interface StorageNote {
  /** 建立時生成的穩定 id（時間戳 + 序號，不用亂數以利 SSR/測試可預期） */
  id: string;
  /** 便條文字（trim 後，上限 STORAGE_NOTE_TEXT_MAX 字） */
  text: string;
  /** 紙張傾斜角度，建立時算一次存下（不每次 render 亂數，SSR/測試穩定） */
  tilt: number;
  /** 建立時間（ISO 8601） */
  createdAt: string;
  /** 最後編輯時間（ISO 8601），便條列表排序鍵（最近編輯排最上） */
  updatedAt: string;
  /** 逐張小標「地點」快照，undefined = 使用者未勾選記錄地點（S10-1） */
  location?: StorageNoteLocationSnapshot;
  /**
   * 逐張小標「時間」快照，使用者時區 ISO 8601（含時區偏移，如 +08:00），
   * undefined = 未勾選（S10-1）。
   */
  capturedAt?: string;
}

/** 便條數量上限（進 ProgressState blob，避免撐爆 128KB 額度） */
export const STORAGE_NOTE_MAX = 30;
/** 單張便條字數上限 */
export const STORAGE_NOTE_TEXT_MAX = 200;

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
  /** 已解鎖的浮島 id（zone 首頁解鎖小物件點擊後授予） */
  islandsUnlocked: string[];
  /**
   * 使用者主動停用的浮島 id（S6 設定視窗寫入）。
   * 與 islandsUnlocked 分開存：停用 ≠ 未解鎖，重新啟用不需要再解鎖。
   */
  islandsDisabled: string[];
  /** 各頁面的掃描線進度，key 為 pageId */
  pageMarkers: Record<string, PageMarkerProgress>;
  /**
   * 各 History 頁面的迷霧線位置（S10-2 rush prevention）：
   * key = pageId，value = 0~1 的頁面比例，單調遞增。
   *
   * 這是連續量版的閱讀進度，取代 `pageMarkers` 的
   * `maxMarkerIdx / totalMarkers`——後者的分母包含 echo spot 與
   * visual clue 錨點，編輯內容就會讓讀者的百分比整個位移。
   *
   * 迷霧線以下的事件觸發器一律凍結，且只跟著掃描線連續推進，
   * 往下跳躍不算數；已 completed 的頁面不再受迷霧限制。
   */
  fogRatio: Record<string, number>;
  /**
   * 最後造訪的 History 頁面 id（S6-2 續讀顯示用）。
   * 與 pageMarkers 分開存：pageMarker 要通過第一個標記點才建立，
   * 換頁當下就該更新續讀顯示，所以平鋪一份「最後造訪」。
   */
  lastVisitedPageId: string | null;
  /** 最後造訪時間（ISO 8601），與 lastVisitedPageId 成對 */
  lastVisitedAt: string | null;
  /**
   * 「遺落的書籤」機率狀態（S6-2，History 浮島解鎖儀式）。
   * 每次首次讀完一篇 roll 一次：中了 visible=true（導航樹浮現條目）；
   * 沒中 chancePct 遞增；被忽視（導去別頁）時 visible=false 且機率重置。
   */
  lostBookmark: {
    /** 下次 roll 的出現機率（百分比，20 → 100） */
    chancePct: number;
    /** 條目目前是否浮現在導航樹 */
    visible: boolean;
  };
  /**
   * 閱讀時間統計（S6，History Island 的簡單統計用）。
   * totalMs 為 History 文章的累計停留時間（單次造訪有上限防掛機灌水），
   * 平均閱讀時間 = totalMs / completedPageIds.length。
   */
  readingStats: {
    totalMs: number;
  };
  /**
   * Terminal Island 已讀水位（S7-C 更動通知）：
   * key = entityKey，value = 上次確認的「已通過 revision 數」。
   * 首次遇到的 key 靜默建檔（不通知）；之後數值增加 → terminal
   * 輸出更動通知。放 ProgressState = 跟登入同步、跨裝置不重複通知。
   */
  conceptsReadLevel: Record<string, number>;
  /**
   * 便條島的便條本體（S9）。跨裝置同步；釘選態另存 localStorage。
   * 排序在消費端做（updatedAt desc），此處保留寫入順序即可。
   */
  storageNotes: StorageNote[];
  /** 最後更新時間（ISO 8601） */
  updatedAt: string;
}

/**
 * 遠端讀取結果（ServerAdapter 專用的四態語意）。
 *
 * `load()` 用單一個 `null` 同時表達「帳號沒有雲端進度」「讀不到伺服器」
 * 兩件完全相反的事，呼叫端只能一律當成「新帳號，把本地推上去」——於是
 * admin 的重置會被舊鏡像原地復原。
 * 這四個 kind 就是把那個 `null` 拆開。
 */
export type RemoteLoadResult =
  /** 遠端有進度 blob */
  | { kind: 'present'; state: ProgressState; observerEver: boolean }
  /**
   * 遠端**權威地**沒有進度：blob 為空但 rev > 0，代表這個帳號曾被寫過
   * 而現在是空的（典型情境：admin 剛重置）。必須採 canonical empty，
   * **絕不可**上傳本地鏡像——那正是被重置掉的那份。
   */
  | { kind: 'empty'; observerEver: boolean }
  /**
   * 帳號從未有過雲端進度（blob 為空且 rev === 0）：全新註冊。
   * 此時才可以把匿名期累積的本地進度上傳作為初始值。
   */
  | { kind: 'absent'; observerEver: boolean }
  /**
   * 讀不到伺服器（網路失敗／伺服器錯誤／已登出）。維持本地現狀，
   * 且因為手上沒有有效 rev，**不得**上傳。
   */
  | { kind: 'unavailable' };

/** 進度狀態的儲存介面 — LocalStorageAdapter（S1）/ ServerAdapter（S5） */
export interface ProgressAdapter {
  /** 讀取狀態；不存在或不可用時回傳 null */
  load(): Promise<ProgressState | null>;
  /** 寫入狀態 */
  save(state: ProgressState): Promise<void>;
  /**
   * 帶四態語意的遠端讀取（見 `RemoteLoadResult`）。有實作的 adapter
   * （ServerAdapter）會被 `setAdapter()` 優先採用；LocalStorageAdapter
   * 沒有遠端概念，退回 `load()` 即可。
   */
  loadRemote?(): Promise<RemoteLoadResult>;
  /**
   * 嚴格遠端讀取——**不得** fallback 本地鏡像。
   *
   * 用於「伺服器端資料已被第三方改寫」後的權威 hydrate。此時本地鏡像
   * 正是被判定過期的東西，`load()` 在網路失敗時退回它會讓呼叫端把過期
   * 資料當成伺服器事實，下一次 mutation 再帶著新時間戳覆蓋回去。
   *
   * @returns 快照；`null` 代表**讀不到**（網路/伺服器錯誤），呼叫端應
   *   保持現狀而非歸零。未實作此方法的 adapter（LocalStorageAdapter）
   *   本來就沒有遠端概念，呼叫端會略過。
   */
  loadAuthoritative?(): Promise<AuthoritativeSnapshot | null>;
}

/** 伺服器權威快照 */
export interface AuthoritativeSnapshot {
  /** 遠端進度；`null` 代表帳號目前沒有雲端進度（含 admin 剛清空） */
  state: ProgressState | null;
  /**
   * 伺服器 `observer_ever` 欄位的當前值。
   *
   * 必須獨立於 `state` 帶回：admin 清空 progress 時 blob 是 null 但印記
   * 保留，只看 blob 會把 observerEver 歸零，使 `pristineOnly`
   * （純潔者限定）內容對印記者誤判為可見而外洩劇透。
   */
  observerEver: boolean;
}

/**
 * 迷霧線 ratio 的儲存精度（小數點後 3 位 = 千分之一頁）。
 * 再細對讀者沒有意義，只會讓 blob 變胖。
 */
export const FOG_RATIO_PRECISION = 3;
/**
 * 迷霧線寫入的最小級距（0.5% 頁面高度）。
 *
 * ratio 是捲動連續量，不設級距等於每捲一格就把整包 ProgressState
 * （最大 128KB）序列化上傳一次。推到 1.0（讀到底）不受此限。
 */
export const FOG_RATIO_WRITE_STEP = 0.005;

/** 目前 schema 版本 */
export const PROGRESS_SCHEMA_VERSION = 1;

/** 遺落的書籤：初始出現機率（%） */
export const LOST_BOOKMARK_BASE_PCT = 20;

/** 建立初始狀態（首次進站的探索者） */
export function createInitialState(): ProgressState {
  return {
    version: PROGRESS_SCHEMA_VERSION,
    view: 'explorer',
    observerEver: false,
    flags: [],
    completedPageIds: [],
    islandsUnlocked: [],
    islandsDisabled: [],
    pageMarkers: {},
    fogRatio: {},
    lastVisitedPageId: null,
    lastVisitedAt: null,
    lostBookmark: { chancePct: LOST_BOOKMARK_BASE_PCT, visible: false },
    readingStats: { totalMs: 0 },
    conceptsReadLevel: {},
    storageNotes: [],
    updatedAt: new Date().toISOString(),
  };
}
