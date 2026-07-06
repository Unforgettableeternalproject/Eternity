/**
 * Concepts Revision 快取層（Epic 2 S7）
 *
 * effective view 的記憶體快取：以 (pageId, flags fingerprint, view)
 * 為 key，同一進度狀態下重複 render 不重跑 patch 疊加。
 *
 * - 不做 LRU：Concepts 條目量有限（< 500），page 切換時主動清
 * - fingerprint 納入 view——觀測者 bypass 會改變求值結果（設計文件 2-3）
 * - pristineOnly 依賴 observerEver，也一併納入 fingerprint
 */

import type { ProgressState } from '../../progress/types';

/** pageId → (fingerprint → 快取值) */
const cache = new Map<string, { fingerprint: string; value: unknown }>();

/**
 * 進度狀態指紋：影響 gate 求值結果的欄位全部參與。
 * flags 排序後 join，確保順序無關的等值狀態命中同一快取。
 */
export function progressFingerprint(progress: ProgressState): string {
  return [
    [...progress.flags].sort().join(','),
    progress.view,
    progress.observerEver ? '1' : '0',
  ].join('|');
}

/**
 * 取得（或計算並快取）某頁的 effective view。
 * 同 page 只保留最新 fingerprint 的一份——進度是單調前進的，
 * 舊指紋的結果不會再被用到。
 */
export function getCachedEffectiveView<T>(
  pageId: string,
  progress: ProgressState,
  compute: () => T
): T {
  const fingerprint = progressFingerprint(progress);
  const hit = cache.get(pageId);
  if (hit && hit.fingerprint === fingerprint) {
    return hit.value as T;
  }
  const value = compute();
  cache.set(pageId, { fingerprint, value });
  return value;
}

/** 清空特定 page 的快取（換頁/該頁資料重新載入時呼叫） */
export function invalidatePageCache(pageId: string): void {
  cache.delete(pageId);
}

/** 清空全部快取（Reader unmount 時呼叫） */
export function clearAllRevisionCache(): void {
  cache.clear();
}
