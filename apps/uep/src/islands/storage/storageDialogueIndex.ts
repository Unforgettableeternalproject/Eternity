/**
 * Storage 對話條目索引（解鎖偵測用）
 *
 * 解鎖通知要能在**任何頁面**浮出——讀者在 History 讀完一章的當下就該
 * 被告知，而不是等他哪天走進置物空間。但除了 Storage 站內，沒有任何
 * 頁面手上有 storage 的目錄，所以這裡自己抓一次。
 *
 * 不用 `zoneProgressTree` 的 adapter：那個回的是求值器，這裡要的是
 * 標題與 gate 原始 metadata（通知卡要顯示標題、比對要重新求值）。
 * 也不新增 worker 端點——Storage 的樹很小，既有的 tree 端點夠用。
 *
 * 快取到模組層 promise：一頁只抓一次，失敗不快取（下次進度變動重試）。
 */

import { getApiBase } from '../../lib/apiBase';

export interface StorageDialogueEntry {
  slug: string;
  title: string;
  metadata: Record<string, unknown> | null;
}

interface TreeNode {
  id?: string;
  slug?: string;
  title?: string;
  pageType?: string;
  metadata?: Record<string, unknown> | null;
  children?: TreeNode[];
}

let cache: Promise<StorageDialogueEntry[]> | null = null;

function flattenStuff(nodes: TreeNode[]): StorageDialogueEntry[] {
  const acc: StorageDialogueEntry[] = [];
  (function walk(list: TreeNode[]) {
    for (const node of list) {
      // 只收帶 gate 的 stuff——沒有條件的條目本來就一直看得到，
      // 放進比對集合只是讓每次求值多繞一圈。
      if (node.pageType === 'stuff' && node.metadata?.gate) {
        const slug = node.slug || node.id;
        if (slug) {
          acc.push({
            slug,
            title: node.title || slug,
            metadata: node.metadata ?? null,
          });
        }
      }
      if (node.children?.length) walk(node.children);
    }
  })(nodes);
  return acc;
}

/** 取得所有帶 gate 的 storage 條目；失敗拋出，由呼叫端靜默略過 */
export function fetchStorageDialogueIndex(): Promise<StorageDialogueEntry[]> {
  if (cache) return cache;
  const promise = fetch(`${getApiBase()}/api/content/storage/tree`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ ok: boolean; data?: TreeNode[] }>;
    })
    .then((json) => {
      if (!json.ok || !Array.isArray(json.data)) throw new Error('bad payload');
      return flattenStuff(json.data);
    })
    .catch((error: unknown) => {
      cache = null;
      throw error;
    });
  cache = promise;
  return promise;
}

/** 測試用：清空快取 */
export function _resetStorageDialogueIndexForTest(): void {
  cache = null;
}
