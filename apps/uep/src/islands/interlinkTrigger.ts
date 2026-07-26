/* global AbortSignal */
/**
 * 跨區互聯觸發（S10-1）。
 *
 * 讀者停在 Echoes 的某首歌／Visuals 的某個畫廊時，History 島浮出
 * 「這個東西在哪些段落出現過」的線索卡。事件走 window bridge
 * （`ISLAND_RELATED_EVENT`，S6 就定好的契約，這是第一個真正的消費場景），
 * 來源端與島分屬不同 React root，不能靠 props 或 context 溝通。
 *
 * 觸發依據是**頁面本身的 metadata key**，不是文章內容裡的標記——因此
 * 完全不需要碰渲染管線：`renderInteractiveHtml`（只有 HistoryReader 用）
 * 與 `renderHtmlWithUep`（其餘四個 Reader 用）都維持原樣。
 */

import { ISLAND_RELATED_EVENT, type IslandId } from './types';
import type { IslandRelatedDetail } from './types';

/** 島收合時的待處理提示（dock chip 亮框），與 clue 等待計數同模式 */
export const UEP_RELATED_PENDING_EVENT = 'uep:island-related-pending';

declare global {
  interface Window {
    __uepIslandRelatedPending?: Partial<Record<IslandId, boolean>>;
  }
}

interface InterlinkAnchorPayload {
  pageId: string;
  pageTitle: string;
  anchorKind: string;
  anchorId: string | null;
  label: string | null;
}

/**
 * 查某個 key 的 History 錨點並廣播給 History 島。
 *
 * 查無錨點時**不廣播**——沒有東西可看時彈一張空卡片只是噪音。
 * 查詢失敗（離線／端點錯誤）同樣靜默略過：互聯是加分功能，
 * 不該讓 Reader 因此顯示錯誤。
 */
export async function triggerHistoryRelated(args: {
  apiBase: string;
  sourceZone: Exclude<IslandId, 'history'>;
  keyType: 'entity' | 'story';
  key: string;
  label: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { apiBase, sourceZone, keyType, key, label, signal } = args;
  if (!key) return;

  let anchors: InterlinkAnchorPayload[] = [];
  try {
    const res = await fetch(
      `${apiBase}/api/interlink/anchors?keyType=${keyType}&key=${encodeURIComponent(key)}`,
      signal ? { signal } : undefined
    );
    if (!res.ok) return;
    const json = (await res.json()) as {
      ok: boolean;
      data?: { anchors?: InterlinkAnchorPayload[] };
    };
    if (!json.ok) return;
    anchors = json.data?.anchors ?? [];
  } catch {
    return;
  }

  // 同一頁可能有多個錨點（多個 spot／clue 的起訖），對讀者來說是同一篇
  // 文章——去重後才是「相關的段落」清單
  const historyPageIds = [...new Set(anchors.map((a) => a.pageId))];
  if (historyPageIds.length === 0) return;

  dispatchIslandRelated({ sourceZone, historyPageIds, label });
}

/** 廣播跨島關聯事件（測試與其他來源端共用） */
export function dispatchIslandRelated(detail: IslandRelatedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<IslandRelatedDetail>(ISLAND_RELATED_EVENT, { detail })
  );
}

/**
 * 設定某個島「有待看的關聯線索」並廣播（島收合時的 dock chip 提示）。
 * 沿 `setClueWaitingCount` 的模式：生產者是島本體、消費者是 IslandDock，
 * 分屬不同 React root，一律走 window bridge。
 */
export function setRelatedPendingFlag(
  zone: IslandId,
  hasPending: boolean
): void {
  if (typeof window === 'undefined') return;
  const current = window.__uepIslandRelatedPending ?? {};
  if ((current[zone] ?? false) === hasPending) return;
  window.__uepIslandRelatedPending = { ...current, [zone]: hasPending };
  window.dispatchEvent(
    new CustomEvent<{ zone: IslandId; hasPending: boolean }>(
      UEP_RELATED_PENDING_EVENT,
      { detail: { zone, hasPending } }
    )
  );
}

/** 讀取待處理旗標（IslandDock mount 時的初始值） */
export function getRelatedPendingFlag(zone: IslandId): boolean {
  if (typeof window === 'undefined') return false;
  return window.__uepIslandRelatedPending?.[zone] ?? false;
}

/** 訂閱待處理旗標變化；回傳解除訂閱函式 */
export function subscribeRelatedPending(
  listener: (zone: IslandId, hasPending: boolean) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (
      event as CustomEvent<{ zone: IslandId; hasPending: boolean }>
    ).detail;
    if (detail) listener(detail.zone, detail.hasPending);
  };
  window.addEventListener(UEP_RELATED_PENDING_EVENT, handler);
  return () => window.removeEventListener(UEP_RELATED_PENDING_EVENT, handler);
}

/** 訂閱跨島關聯事件；回傳解除訂閱函式 */
export function subscribeIslandRelated(
  listener: (detail: IslandRelatedDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<IslandRelatedDetail>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(ISLAND_RELATED_EVENT, handler);
  return () => window.removeEventListener(ISLAND_RELATED_EVENT, handler);
}
