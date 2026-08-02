/* global AbortSignal */
/**
 * 劇情點名稱的批次查詢與快取（S10-3b T-B7-1）
 *
 * `/admin/settings` 的 key 分頁替 storyKey 填的 `interlink_keys.title`，
 * 在 Echoes 收藏池（已解鎖的劇情歌清單）顯示用。
 *
 * ## 為什麼是批次
 *
 * 一個 subcat 底下可能有數十首劇情歌，逐首查會對同一個端點掃射。公開端點
 * 的 `?keys=a,b,c` 就是為此加的（單把的 `?key=` 維持原樣給觸發端用）。
 *
 * ## 為什麼有模組級快取
 *
 * Echoes 是 MPA，換頁重新 mount，但同一頁的重渲染不該重查。快取存
 * Promise 而不是結果，讓並發呼叫也只打一次。
 *
 * ⚠️ 查詢失敗一律當作「沒有名稱」——名稱是加分資訊，不得連累清單渲染。
 */

const cache = new Map<string, string | null>();
/** 進行中的請求，避免同一批 key 在 effect 重入時重複發送 */
let inflight: Promise<void> | null = null;

/** 取已快取的名稱（沒查過或查無皆為 null） */
export function getCachedStoryTitle(storyKey: string): string | null {
  return cache.get(storyKey) ?? null;
}

/**
 * 補齊尚未查過的 storyKey，完成後可用 `getCachedStoryTitle` 讀。
 *
 * 全部都查過時直接 resolve，不發請求——呼叫端可以在 effect 裡無條件呼叫。
 */
export async function loadStoryTitles(
  apiBase: string,
  storyKeys: string[],
  signal?: AbortSignal
): Promise<void> {
  const missing = [
    ...new Set(storyKeys.map((k) => k.trim()).filter(Boolean)),
  ].filter((key) => !cache.has(key));
  if (missing.length === 0) return;

  // 端點上限 100，超過就分批——與其讓 worker 回 400，不如這裡切好
  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += 100) {
    batches.push(missing.slice(i, i + 100));
  }

  const run = (async () => {
    for (const batch of batches) {
      try {
        const res = await fetch(
          `${apiBase}/api/interlink/keys/public?keyType=story&keys=${encodeURIComponent(
            batch.join(',')
          )}`,
          signal ? { signal } : undefined
        );
        if (!res.ok) continue;
        const json = (await res.json()) as {
          ok: boolean;
          data?: {
            keyMetas?: Record<string, { title?: string | null }>;
          };
        };
        if (!json.ok) continue;
        const metas = json.data?.keyMetas ?? {};
        // 查無的 key 也要落快取（值為 null），否則每次重渲染都會再查一次
        for (const key of batch) cache.set(key, metas[key]?.title || null);
      } catch {
        // 中止或離線：不落快取，下次還有機會查到
      }
    }
  })();

  inflight = run;
  await run;
  if (inflight === run) inflight = null;
}

/** 測試用：清掉模組級快取 */
export function resetStoryTitleCache(): void {
  cache.clear();
  inflight = null;
}
