/**
 * Zone tree 反查快取（S8 全區驗證 #6 修）
 *
 * IslandHost 的 entity 消費路徑（entity-song / entity-gallery）原本
 * 無 zone tree 可用，解鎖判定只做本頁 gate 求值——RichEditor 可設定的
 * progressPage 鏈與父容器繼承在該路徑不生效，等於 Admin 一設 gated
 * container 就出現繞過。這裡以 content API 的 tree 端點補齊：
 * 成功結果以 promise 快取（同 Reader mount 時抓一次的頻率）。失敗
 * 不快取並向消費端拋出，讓內容可見性維持 fail-closed；下次觸發重試。
 */

import { getApiBase } from '../lib/apiBase';
import { buildProgressTreeAdapter } from '../progress';
import type { AdapterTreeNode, ProgressTreeAdapter } from '../progress';

const cache = new Map<string, Promise<ProgressTreeAdapter>>();

/** 取得指定 zone 的 tree-aware gating 求值器；失敗拋出並由消費端拒絕顯示 */
export function fetchZoneProgressTree(
  zone: string
): Promise<ProgressTreeAdapter> {
  const cached = cache.get(zone);
  if (cached) return cached;

  const promise = fetch(`${getApiBase()}/api/content/${zone}/tree`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ ok: boolean; data?: AdapterTreeNode[] }>;
    })
    .then((json) => {
      if (!json.ok || !Array.isArray(json.data)) throw new Error('bad payload');
      return buildProgressTreeAdapter(json.data);
    })
    .catch((error: unknown) => {
      cache.delete(zone); // 失敗不快取，下次觸發重試
      throw error;
    });

  cache.set(zone, promise);
  return promise;
}

/** 測試用：清空快取 */
export function _resetZoneProgressTreeCacheForTest(): void {
  cache.clear();
}
