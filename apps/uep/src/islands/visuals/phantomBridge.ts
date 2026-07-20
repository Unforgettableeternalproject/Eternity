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
  images: PhantomImage[];
  /** 展示來源：映照 / entity 嵌入 / Visual Clue（V-D） */
  source: 'mirror' | 'embed' | 'clue';
  /**
   * 關聯的 History 頁面 id（ISLAND_RELATED_EVENT 廣播用）。
   * 映照/嵌入來源沒有此資訊（空陣列）；V-D Visual Clue 觸發時帶入
   * clue 所在的 History 頁。
   */
  relatedHistoryIds?: string[];
}

/** 目前投射變更事件（島展開中時的即時更新） */
export const UEP_PHANTOM_SHOW_EVENT = 'uep:phantom-show';
/** entity 嵌入提示事件 */
export const UEP_PHANTOM_SUGGESTION_EVENT = 'uep:phantom-suggestion';

declare global {
  interface Window {
    __uepPhantomGallery?: PhantomGallery | null;
    __uepPhantomSuggestion?: PhantomGallery | null;
  }
}

/**
 * 進島分館白名單：只有陳列走廊（profiles）+ 鑲框室（illustrations）；
 * 抽象萃取間、基底實驗室屬額外內容不列入（設計文件 §3-3）。
 */
export function isPhantomEligibleDivision(
  divisionId: string | null | undefined
): boolean {
  return divisionId === 'profiles' || divisionId === 'illustrations';
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
 */
export function pushPhantomGallery(gallery: PhantomGallery): void {
  if (typeof window === 'undefined') return;
  window.__uepPhantomGallery = gallery;
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
  return window.__uepPhantomGallery ?? null;
}

/** 清除目前投射與 pending 提示（登出/進度 reset，islandRuntime 呼叫） */
export function clearPhantomGallery(): void {
  if (typeof window === 'undefined') return;
  window.__uepPhantomGallery = null;
  window.__uepPhantomSuggestion = null;
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
  return pending;
}
