/**
 * Visual Clue → gallery 反查（S8 下半場 V-D）。
 *
 * clue node 保存的是插入當下的快照，改圖/改條件/換 key 後會過期——
 * 觸發時一律以引用（entityKey／storyKey）反查現行資料，D1 才是真相
 * （同 refreshEchoSpot 的定案理由）。引用失效（編輯後換了 key）時
 * 以 galleryId 頁 id 快照兜底；兩者皆失敗回傳 null，呼叫端提示。
 */

import type { VisualClueEntry } from './useVisualClues';

/** `/api/visuals/*gallery` 回傳的 gallery payload（寬鬆型別，防壞資料） */
export interface ClueGalleryPayload {
  id: string;
  title: string;
  entityKey: string | null;
  storyKey: string | null;
  divisionId: string | null;
  gate?: unknown;
  locked: boolean;
  images: unknown;
}

async function lookupGallery(
  apiBase: string,
  query: string
): Promise<ClueGalleryPayload | null> {
  try {
    const res = await fetch(`${apiBase}/api/visuals/${query}`);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      ok: boolean;
      data?: { found: boolean; gallery?: ClueGalleryPayload };
    };
    return (json.ok && json.data?.found && json.data.gallery) || null;
  } catch {
    return null;
  }
}

/** 以 clue 引用反查現行 gallery；引用失效時退回頁 id 快照。 */
export async function fetchClueGallery(
  apiBase: string,
  clue: VisualClueEntry
): Promise<ClueGalleryPayload | null> {
  const primary =
    clue.targetType === 'entity'
      ? await lookupGallery(
          apiBase,
          `entity-gallery?key=${encodeURIComponent(clue.targetKey)}`
        )
      : await lookupGallery(
          apiBase,
          `gallery?story=${encodeURIComponent(clue.targetKey)}`
        );
  if (primary) return primary;
  if (clue.galleryId) {
    return lookupGallery(
      apiBase,
      `gallery?id=${encodeURIComponent(clue.galleryId)}`
    );
  }
  return null;
}
