/* global AbortSignal */
/**
 * 跨區互聯觸發（S10-1）。
 *
 * **本模組只處理 storyKey → History 島**這一個方向（艾斯維爾 2026-07-27
 * 定案）：劇情歌／插圖進頁時，History 島浮出該劇情點的段落。
 *
 * ⚠️ entityKey 的互聯**不走這裡**——它復用既有的 `uep:entity-activate`
 * （見 `embed/interactive.ts` 的 `activateEntityKey`），`IslandHost` 對那個
 * 事件本來就有完整的三島分派。entityKey 也不連 History：一個 entity 可能
 * 在 History 出現數十次，「所有提到他的段落」對讀者沒有意義。
 *
 * 事件走 window bridge（`ISLAND_RELATED_EVENT`，S6 就定好的契約），
 * 來源端與島分屬不同 React root，不能靠 props 或 context 溝通。
 *
 * 觸發依據是**頁面本身的 metadata key**，不是文章內容裡的標記——因此
 * 完全不需要碰渲染管線：`renderInteractiveHtml`（只有 HistoryReader 用）
 * 與 `renderHtmlWithUep`（其餘四個 Reader 用）都維持原樣。
 */

import { ISLAND_RELATED_EVENT, type IslandId } from './types';
import type { IslandRelatedDetail, IslandRelatedItem } from './types';

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
 * 查某個**劇情點**（storyKey）的 History 錨點並廣播給 History 島。
 *
 * ⚠️ 只吃 storyKey。entityKey 這條路已經拆掉（艾斯維爾 2026-07-27）：
 * 一個 entity 可能在 History 出現數十次，列出「所有提到他的段落」對讀者
 * 沒有意義。**History 島只對劇情點有反應**；entity 走的是
 * `uep:entity-activate`（`embed/interactive.ts` 的 `activateEntityKey`）。
 *
 * 查無錨點時**不廣播**——沒有東西可看時彈一張空卡片只是噪音。
 * 查詢失敗（離線／端點錯誤）同樣靜默略過：互聯是加分功能，
 * 不該讓 Reader 因此顯示錯誤。
 *
 * @returns 是否真的廣播了（查無錨點／查詢失敗皆為 false）。
 */
export async function triggerStoryRelated(args: {
  apiBase: string;
  sourceZone: Exclude<IslandId, 'history'>;
  storyKey: string;
  label: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  const { apiBase, sourceZone, storyKey, label, signal } = args;
  if (!storyKey) return false;

  // 劇情點名稱與說明（interlink_keys，/admin/settings 的 key 分頁填）與錨點
  // 平行查。查詢失敗只影響顯示文字，**不得連累錨點功能**——自己吞錯回 null，
  // storyKey 層級查一次即可，不逐 anchor 查。
  const keyMetaPromise: Promise<{
    title: string | null;
    description: string | null;
  }> = (async () => {
    try {
      const res = await fetch(
        `${apiBase}/api/interlink/keys/public?keyType=story&key=${encodeURIComponent(storyKey)}`,
        signal ? { signal } : undefined
      );
      if (!res.ok) return { title: null, description: null };
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          keyMeta?: {
            title?: string | null;
            description?: string | null;
          } | null;
        };
      };
      if (!json.ok) return { title: null, description: null };
      return {
        title: json.data?.keyMeta?.title || null,
        description: json.data?.keyMeta?.description || null,
      };
    } catch {
      return { title: null, description: null };
    }
  })();

  let anchors: InterlinkAnchorPayload[] = [];
  try {
    const res = await fetch(
      `${apiBase}/api/interlink/anchors?keyType=story&key=${encodeURIComponent(storyKey)}`,
      signal ? { signal } : undefined
    );
    if (!res.ok) return false;
    const json = (await res.json()) as {
      ok: boolean;
      data?: { anchors?: InterlinkAnchorPayload[] };
    };
    if (!json.ok) return false;
    anchors = json.data?.anchors ?? [];
  } catch {
    return false;
  }

  const keyMeta = await keyMetaPromise;

  // 同一頁可能有多個錨點（多個 spot／clue 的起訖），對讀者來說是同一篇
  // 文章——依 pageId 去重後才是「相關的段落」清單。
  //
  // ⚠️ item 一律是**頁面標題**，劇情點名稱走 detail 的 keyTitle。
  // 早期版本把 keyTitle 塞進每個 item 的 title，結果是 N 個錨點列出 N 行
  // 一模一樣的字，且島端還會拿自己目錄樹的頁面標題把它蓋掉。
  const byPage = new Map<string, IslandRelatedItem>();
  for (const anchor of anchors) {
    if (byPage.has(anchor.pageId)) continue;
    byPage.set(anchor.pageId, {
      pageId: anchor.pageId,
      title: anchor.pageTitle || anchor.pageId,
    });
  }
  if (byPage.size === 0) return false;

  dispatchIslandRelated({
    targetIsland: 'history',
    sourceZone,
    items: [...byPage.values()],
    label,
    keyTitle: keyMeta.title,
    keyDescription: keyMeta.description,
  });
  return true;
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
