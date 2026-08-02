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
 * Echoes 是 MPA，換頁重新 mount，但同一頁的重渲染不該重查。
 *
 * 快取分兩層：`cache` 存查完的結果，`pending` 存**逐 key** 的進行中 Promise。
 * 只有結果快取的話，effect 在第一次 fetch 回來前重入會把同一批 key 再送一次
 * ——`cache.has()` 當下還是 false。有了 `pending`，重入的呼叫會改成等待既有
 * 請求，只有真正沒人在查的 key 才組新批次。
 *
 * ⚠️ 查詢失敗一律當作「沒有名稱」——名稱是加分資訊，不得連累清單渲染。
 */

const cache = new Map<string, string | null>();
/**
 * 進行中的請求，以 key 為單位登記，避免 effect 重入時重複發送。
 *
 * ⚠️ 發起端 abort（元件卸載）時，同批等待的其他呼叫端會拿到「沒有名稱」
 * 而不是自己重查一次。名稱只是加分資訊，且 key 不落快取、下次 mount 還會
 * 再查，不值得為此讓每個呼叫端各持一份請求。
 */
const pending = new Map<string, Promise<void>>();

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
  const unresolved = [
    ...new Set(storyKeys.map((k) => k.trim()).filter(Boolean)),
  ].filter((key) => !cache.has(key));
  if (unresolved.length === 0) return;

  // 已經有人在查的 key 只要等，剩下的才由這次呼叫組批次
  const waits: Promise<void>[] = [];
  const missing: string[] = [];
  for (const key of unresolved) {
    const inflight = pending.get(key);
    if (inflight) waits.push(inflight);
    else missing.push(key);
  }

  // 端點上限 100，超過就分批——與其讓 worker 回 400，不如這裡切好
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const run = fetchBatch(apiBase, batch, signal).finally(() => {
      // 只清掉自己登記的那份，避免蓋掉後續呼叫的新請求
      for (const key of batch) {
        if (pending.get(key) === run) pending.delete(key);
      }
    });
    for (const key of batch) pending.set(key, run);
    waits.push(run);
  }

  await Promise.all(waits);
}

async function fetchBatch(
  apiBase: string,
  batch: string[],
  signal?: AbortSignal
): Promise<void> {
  try {
    const res = await fetch(
      `${apiBase}/api/interlink/keys/public?keyType=story&keys=${encodeURIComponent(
        batch.join(',')
      )}`,
      signal ? { signal } : undefined
    );
    if (!res.ok) return;
    const json = (await res.json()) as {
      ok: boolean;
      data?: {
        keyMetas?: Record<string, { title?: string | null }>;
      };
    };
    if (!json.ok) return;
    const metas = json.data?.keyMetas ?? {};
    // 查無的 key 也要落快取（值為 null），否則每次重渲染都會再查一次
    for (const key of batch) cache.set(key, metas[key]?.title || null);
  } catch {
    // 中止或離線：不落快取，下次還有機會查到
  }
}

/** 測試用：清掉模組級快取 */
export function resetStoryTitleCache(): void {
  cache.clear();
  pending.clear();
}
