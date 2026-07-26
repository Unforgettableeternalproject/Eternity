/**
 * 浮動幻影 — 資料橋（S8 下半場 V-C）
 *
 * 島的內容來源全部事件驅動（設計文件 §3-3）：映照（Reader 按鈕）、
 * entity 嵌入提示、Visual Clue（V-D）。三種來源與島本體分屬不同
 * React root/bundle，module-level 變數跨不過去（S8-B 教訓：分類色
 * 跨 island 只能靠 window/store 內資料）——pending 值一律放 window，
 * 沿 echoSuggestionBridge 前例。
 *
 * 「目前投射」與「提示」語意刻意不同：
 * - 目前投射（current）：持續狀態，島收合 unmount 再展開仍要續示，
 *   讀取**不**清除；登出/進度 reset 由 islandRuntime.resetAll 清除
 * - 提示（suggestion）：一次性 pending，島 mount 時消費即清（同 echo）
 */

import type { GateCondition } from '../../progress';
import type { ImageDisplayState } from '../../visuals';
import { ISLAND_RELATED_EVENT } from '../types';
import type { IslandRelatedDetail } from '../types';

/** 島內展示的單張圖片（ImageItem 的三態子集；file 為裸 R2 key） */
export interface PhantomImage {
  id: string;
  file: string;
  caption: string;
  sortOrder: number;
  isSpriteSheet?: boolean;
  initialState?: ImageDisplayState;
  lockGate?: GateCondition | null;
  partialGate?: GateCondition | null;
}

/** 投射進浮動幻影的 gallery 快照 */
export interface PhantomGallery {
  /** Visuals gallery 頁 id（`visuals/...`） */
  id: string;
  title: string;
  /** 陳列走廊的統一實體身分；鑲框室等為 null */
  entityKey?: string | null;
  /** 頁面 id 第二段（profiles/illustrations/...） */
  divisionId?: string | null;
  /**
   * gallery 閘快照（投射當下的 metadata.gate；unknown——worker 回寬鬆
   * 型別，narrowing 交給 parseGateCondition）。島依 progress 變化重驗
   * gallery 閘（pristineOnly 可在投射後失效）——缺快照的舊投射視為
   * 無條件（向後相容）。
   */
  gate?: unknown;
  /** 靜態鎖快照（metadata.locked）——重驗時凌駕推導旗標 */
  locked?: boolean;
  images: PhantomImage[];
  /**
   * 浮動幻影首次展示／切換時應聚焦的圖片 id。未設定或找不到時回第一張；
   * gallery clue 的預設圖與區間內 image gate 共用此欄位。
   */
  initialImageId?: string | null;
  /** 觸發目前 clue 投射的 id；image gate 只可切換同一 clue。 */
  activeClueId?: string | null;
  /** 展示來源：映照 / entity 嵌入 / Visual Clue（V-D） */
  source: 'mirror' | 'embed' | 'clue';
  /**
   * 關聯的 History 頁面 id（ISLAND_RELATED_EVENT 廣播用）。
   * 映照/嵌入來源沒有此資訊（空陣列）；V-D Visual Clue 觸發時帶入
   * clue 所在的 History 頁。
   */
  relatedHistoryIds?: string[];
}

/** 目前投射變更事件（島展開中時的即時更新；detail null = 清空投射） */
export const UEP_PHANTOM_SHOW_EVENT = 'uep:phantom-show';
/** entity 嵌入提示事件 */
export const UEP_PHANTOM_SUGGESTION_EVENT = 'uep:phantom-suggestion';

/**
 * Visual Clue 插播快照（V-D）：強制展示前的目前投射。
 * wrapper 物件才能區分「沒有快照」與「快照 = 插播前一片空白」
 * （對位 audioStore interruptionSnapshot 的 songId:null 語意）。
 */
interface PhantomClueSnapshot {
  gallery: PhantomGallery | null;
}

/**
 * 目前投射與 clue 快照需要跨頁存活；window bridge 只負責同頁不同
 * React root，同一份資料另寫 localStorage 才能承接一般頁面導覽。
 * suggestion 仍是一次性提示，不進持久化。
 */
export const PHANTOM_STATE_STORAGE_KEY = 'uep.phantom.v1';

interface PersistedPhantomState {
  version: 1;
  gallery: PhantomGallery | null;
  clueSnapshot: PhantomClueSnapshot | null;
}

/** clue 等待計數變更事件（dock chip 閃爍提示用） */
export const UEP_CLUE_WAITING_EVENT = 'uep:visual-clue-waiting';

/**
 * 島內「清除投射」在 clue 插播中被按下時，請 HistoryReader 撤下進行中的
 * clue 書籤並復原快照（#4 追加：雙向對應）。生產者＝VisualsIsland 的 ×，
 * 消費者＝HistoryReader——分屬不同 React root，走 window bridge。
 * 復原與書籤 dedupe 由 Reader（clue 生命週期單一擁有者）統一處理。
 */
export const UEP_PHANTOM_CLUE_CLEAR_EVENT = 'uep:phantom-clue-clear';

declare global {
  interface Window {
    __uepPhantomGallery?: PhantomGallery | null;
    __uepPhantomSuggestion?: PhantomGallery | null;
    __uepPhantomClueSnapshot?: PhantomClueSnapshot | null;
    __uepVisualClueWaiting?: number;
  }
}

function normalizeGallery(raw: unknown): PhantomGallery | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<PhantomGallery>;
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    !Array.isArray(value.images) ||
    !['mirror', 'embed', 'clue'].includes(value.source ?? '')
  ) {
    return null;
  }

  const images = value.images.filter(
    (image): image is PhantomImage =>
      !!image &&
      typeof image === 'object' &&
      typeof image.id === 'string' &&
      typeof image.file === 'string' &&
      typeof image.caption === 'string' &&
      typeof image.sortOrder === 'number' &&
      Number.isFinite(image.sortOrder)
  );
  if (images.length !== value.images.length) return null;

  return {
    ...value,
    id: value.id,
    title: value.title,
    images,
    ...(typeof value.initialImageId === 'string' && value.initialImageId.trim()
      ? { initialImageId: value.initialImageId }
      : {}),
    ...(typeof value.activeClueId === 'string' && value.activeClueId.trim()
      ? { activeClueId: value.activeClueId }
      : {}),
    source: value.source as PhantomGallery['source'],
    relatedHistoryIds: Array.isArray(value.relatedHistoryIds)
      ? value.relatedHistoryIds.filter(
          (pageId): pageId is string => typeof pageId === 'string'
        )
      : undefined,
  };
}

function loadPersistedPhantomState(): PersistedPhantomState | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(PHANTOM_STATE_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedPhantomState>;
    if (value.version !== 1) return null;
    const gallery =
      value.gallery === null ? null : normalizeGallery(value.gallery);
    if (value.gallery !== null && !gallery) return null;
    const snapshotGallery =
      value.clueSnapshot?.gallery === null
        ? null
        : normalizeGallery(value.clueSnapshot?.gallery);
    if (value.clueSnapshot?.gallery && !snapshotGallery) return null;
    return {
      version: 1,
      gallery,
      clueSnapshot: value.clueSnapshot ? { gallery: snapshotGallery } : null,
    };
  } catch {
    return null;
  }
}

function persistPhantomState(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const value: PersistedPhantomState = {
      version: 1,
      gallery: window.__uepPhantomGallery ?? null,
      clueSnapshot: window.__uepPhantomClueSnapshot ?? null,
    };
    window.localStorage.setItem(
      PHANTOM_STATE_STORAGE_KEY,
      JSON.stringify(value)
    );
  } catch {
    // localStorage 滿載或被禁用時靜默失敗，浮島仍可在當頁運作。
  }
}

/** 新頁面／新 bundle 首次讀取時，把持久狀態灌回 window bridge。 */
function hydratePhantomState(): void {
  if (typeof window === 'undefined') return;
  if (
    window.__uepPhantomGallery !== undefined ||
    window.__uepPhantomClueSnapshot !== undefined
  ) {
    return;
  }
  const persisted = loadPersistedPhantomState();
  window.__uepPhantomGallery = persisted?.gallery ?? null;
  window.__uepPhantomClueSnapshot = persisted?.clueSnapshot ?? null;
}

/**
 * 進島分館白名單：陳列走廊（profiles）+ 鑲框室（illustrations）+
 * 抽象萃取間（sketchs）+ 基底實驗室（pixel）四個 Visuals 分館皆可映照
 * （S8 手動驗收 #3 放寬——島展示端 VisualsPhantom 已支援四分館 framing，
 * 入口一併開放）。精靈圖 gallery 不靠分館排除，改由 canMirrorGallery 以
 * layout='sprite' 過濾（基底實驗室的非精靈圖 gallery 可進島）。
 */
export function isPhantomEligibleDivision(
  divisionId: string | null | undefined
): boolean {
  return (
    divisionId === 'profiles' ||
    divisionId === 'illustrations' ||
    divisionId === 'sketchs' ||
    divisionId === 'pixel'
  );
}

/**
 * gallery 是否可映照到島：分館白名單 ∧ 非精靈圖 gallery ∧ 有圖片。
 * gallery 閘由呼叫端把關（Reader 只在已解鎖 gallery 頁提供映照入口）。
 */
export function canMirrorGallery(args: {
  divisionId: string | null | undefined;
  layout?: string | null;
  imageCount: number;
}): boolean {
  return (
    isPhantomEligibleDivision(args.divisionId) &&
    args.layout !== 'sprite' &&
    args.imageCount > 0
  );
}

/**
 * 互動式嵌入只提示「進島分館 ∧ 已解鎖 ∧ 有圖片」的 gallery
 * （§3-3 原則 1：只展示已解鎖的 gallery；提示不授旗——授旗屬
 * Visual Clue 的 V-D 接線）。
 */
export function isPhantomSuggestionEligible(args: {
  divisionId: string | null | undefined;
  unlocked: boolean;
  imageCount: number;
}): boolean {
  return (
    isPhantomEligibleDivision(args.divisionId) &&
    args.unlocked &&
    args.imageCount > 0
  );
}

/**
 * 設定目前投射並廣播。島未展開時值留在 window，展開後 mount 讀取；
 * 已展開時經事件即時切換。
 *
 * 手動接管語意（V-D）：clue 插播中若使用者以映照/嵌入切換投射，
 * clue 快照直接丟棄——恢復點是使用者「自己的」檢視狀態，主動換過
 * 就沒有要回去的地方（沿 audioStore 插播中手動接管定案）。
 */
export function pushPhantomGallery(gallery: PhantomGallery): void {
  if (typeof window === 'undefined') return;
  if (gallery.source !== 'clue') window.__uepPhantomClueSnapshot = null;
  window.__uepPhantomGallery = gallery;
  persistPhantomState();
  window.dispatchEvent(
    new CustomEvent<PhantomGallery>(UEP_PHANTOM_SHOW_EVENT, {
      detail: gallery,
    })
  );
  // 跨島關聯事件基礎接通（S6 預留合約的第一個真實生產者）：
  // 映照/嵌入展示/clue 都經此廣播來源 gallery 與關聯 History 頁
  // （映照/嵌入無關聯頁資訊＝空陣列；V-D clue 帶入所在頁）。
  window.dispatchEvent(
    new CustomEvent<IslandRelatedDetail>(ISLAND_RELATED_EVENT, {
      detail: {
        sourceZone: 'visuals',
        historyPageIds: gallery.relatedHistoryIds ?? [],
        label: gallery.title,
      },
    })
  );
}

/** 讀取目前投射（不清除——收合再展開續示） */
export function getPhantomGallery(): PhantomGallery | null {
  if (typeof window === 'undefined') return null;
  hydratePhantomState();
  return window.__uepPhantomGallery ?? null;
}

/**
 * 清除目前投射、pending 提示與 clue 快照。
 * 除登出/reset 外也供島內「清除投射」使用，因此同步廣播空狀態，
 * 讓已展開的 React island 不必重開就立即回到空畫框。
 */
export function clearPhantomGallery(): void {
  if (typeof window === 'undefined') return;
  window.__uepPhantomGallery = null;
  window.__uepPhantomSuggestion = null;
  window.__uepPhantomClueSnapshot = null;
  try {
    window.localStorage?.removeItem(PHANTOM_STATE_STORAGE_KEY);
  } catch {
    // 靜默失敗
  }
  window.dispatchEvent(
    new CustomEvent<PhantomGallery | null>(UEP_PHANTOM_SHOW_EVENT, {
      detail: null,
    })
  );
  window.dispatchEvent(
    new CustomEvent<PhantomGallery | null>(UEP_PHANTOM_SUGGESTION_EVENT, {
      detail: null,
    })
  );
}

/**
 * Visual Clue 強制展示（V-D）：快照目前投射 → 切換到 clue gallery。
 * 快照不巢狀——clue 插播中再點另一個 clue 只換投射、不重拍快照，
 * 恢復點永遠是使用者自己的檢視狀態（沿 audioStore interrupt 定案）。
 */
export function pushClueGallery(gallery: PhantomGallery): void {
  if (typeof window === 'undefined') return;
  hydratePhantomState();
  if (!window.__uepPhantomClueSnapshot) {
    window.__uepPhantomClueSnapshot = {
      gallery: window.__uepPhantomGallery ?? null,
    };
  }
  pushPhantomGallery({ ...gallery, source: 'clue' });
}

/**
 * 將進行中的 clue 投射切到 gallery 內指定圖片。
 *
 * 只接受目前的 clue 投射，避免過期 gate 改動使用者手動映照／嵌入接管
 * 後的 gallery。回傳 false 代表目前情境或 imageId 不合格。
 */
export function focusClueImage(
  clueId: string,
  galleryId: string,
  imageId: string
): boolean {
  if (typeof window === 'undefined') return false;
  hydratePhantomState();
  const current = window.__uepPhantomGallery;
  if (
    !current ||
    current.source !== 'clue' ||
    current.id !== galleryId ||
    current.activeClueId !== clueId ||
    !current.images.some((image) => image.id === imageId)
  ) {
    return false;
  }
  pushPhantomGallery({ ...current, initialImageId: imageId });
  return true;
}

/**
 * 結束 clue 插播並恢復快照。恢復條件（呼叫端負責）：
 * 通過訖點錨點 / 離開文章頁。
 *
 * - 快照不存在（從未插播或已被手動接管丟棄）→ no-op
 * - 目前投射已非 clue 來源（防禦：接管時快照理應已丟棄）→ 只清快照
 * - 快照 = 插播前一片空白 → 回到島的空狀態（廣播 null）
 */
export function restoreFromClueSnapshot(): void {
  if (typeof window === 'undefined') return;
  hydratePhantomState();
  const snapshot = window.__uepPhantomClueSnapshot;
  if (!snapshot) return;
  window.__uepPhantomClueSnapshot = null;
  if (window.__uepPhantomGallery?.source !== 'clue') return;

  if (snapshot.gallery) {
    pushPhantomGallery(snapshot.gallery);
    return;
  }
  window.__uepPhantomGallery = null;
  persistPhantomState();
  window.dispatchEvent(
    new CustomEvent<PhantomGallery | null>(UEP_PHANTOM_SHOW_EVENT, {
      detail: null,
    })
  );
}

/** 是否正處於 clue 插播（有快照待恢復） */
export function hasClueSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  hydratePhantomState();
  return Boolean(window.__uepPhantomClueSnapshot);
}

/**
 * 島 × 在 clue 插播中請求清除（#4 追加）：廣播事件讓 HistoryReader 撤下
 * 進行中的 clue 書籤並復原快照。復原本身交給 Reader 統一處理（clue 生命
 * 週期擁有者），島端只發請求，避免快照與書籤 dedupe 兩處各自為政。
 */
export function requestClueClear(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UEP_PHANTOM_CLUE_CLEAR_EVENT));
}

/**
 * 設定「島收合中、區間內等待的 clue 數」並廣播（V-D.31）。
 * HistoryReader 是生產者（島收合時才計數）、IslandDock 是消費者
 * （chip 閃爍提示）——分屬不同 React root，一律走 window bridge。
 */
export function setClueWaitingCount(count: number): void {
  if (typeof window === 'undefined') return;
  if ((window.__uepVisualClueWaiting ?? 0) === count) return;
  window.__uepVisualClueWaiting = count;
  window.dispatchEvent(
    new CustomEvent<number>(UEP_CLUE_WAITING_EVENT, { detail: count })
  );
}

/** 讀取目前等待中的 clue 數（IslandDock mount 時的初始值） */
export function getClueWaitingCount(): number {
  if (typeof window === 'undefined') return 0;
  return window.__uepVisualClueWaiting ?? 0;
}

/**
 * worker gallery payload 的 images 摘要 → PhantomImage 清單。
 * worker 回寬鬆型別（initialState 為 string、gate 為 unknown），
 * narrowing 交給 resolveImageState 的防禦性解析；這裡只組型別相容的
 * 圖片清單並過濾壞項（IslandHost 嵌入提示與 Visual Clue 觸發共用）。
 */
export function parsePhantomImages(rawImages: unknown): PhantomImage[] {
  if (!Array.isArray(rawImages)) return [];
  return rawImages
    .filter(
      (img): img is Record<string, unknown> => !!img && typeof img === 'object'
    )
    .map(
      (img): PhantomImage => ({
        id: typeof img.id === 'string' ? img.id : '',
        file: typeof img.file === 'string' ? img.file : '',
        caption: typeof img.caption === 'string' ? img.caption : '',
        sortOrder: typeof img.sortOrder === 'number' ? img.sortOrder : 0,
        ...(img.initialState === 'locked' ||
        img.initialState === 'partial' ||
        img.initialState === 'unlocked'
          ? { initialState: img.initialState }
          : {}),
        ...(img.lockGate && typeof img.lockGate === 'object'
          ? { lockGate: img.lockGate as PhantomImage['lockGate'] }
          : {}),
        ...(img.partialGate && typeof img.partialGate === 'object'
          ? { partialGate: img.partialGate as PhantomImage['partialGate'] }
          : {}),
      })
    )
    .filter((img) => img.file);
}

/** 發出 entity 嵌入提示（島未 mount 時 pending 於 window） */
export function pushPhantomSuggestion(gallery: PhantomGallery): void {
  if (typeof window === 'undefined') return;
  window.__uepPhantomSuggestion = gallery;
  window.dispatchEvent(
    new CustomEvent<PhantomGallery>(UEP_PHANTOM_SUGGESTION_EVENT, {
      detail: gallery,
    })
  );
}

/** 消費 pending 提示（讀取即清，同 echoSuggestionBridge） */
export function consumePhantomSuggestion(): PhantomGallery | null {
  if (typeof window === 'undefined') return null;
  const pending = window.__uepPhantomSuggestion || null;
  window.__uepPhantomSuggestion = null;
  /* 消費也要廣播（S9-D.5）：dock chip 的閃爍衍生自這個 pending 值 */
  if (pending) {
    window.dispatchEvent(
      new CustomEvent<PhantomGallery | null>(UEP_PHANTOM_SUGGESTION_EVENT, {
        detail: null,
      })
    );
  }
  return pending;
}

/** 是否有尚未消費的嵌入提示（dock chip 閃爍判定） */
export function hasPhantomSuggestion(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.__uepPhantomSuggestion;
}

/**
 * 清除 pending 提示並廣播（detail null）。entity 啟用反查失敗／不合格
 * 時呼叫——否則島上一張 RELATED VISUAL 卡仍留著，會讓使用者誤以為
 * 舊 gallery 與新點擊的 entity 有關。
 */
export function clearPhantomSuggestion(): void {
  if (typeof window === 'undefined') return;
  window.__uepPhantomSuggestion = null;
  window.dispatchEvent(
    new CustomEvent<PhantomGallery | null>(UEP_PHANTOM_SUGGESTION_EVENT, {
      detail: null,
    })
  );
}
