/* global AbortController */
/**
 * useBoundEntityKeys — 取得「已登記多重綁定」的 entityKey 集合
 *
 * entity 一對多綁定（2026-08-15 定案）：一個角色可以有多首主題曲／多個
 * 畫廊，由 Concepts dossier 的 revision 鏈決定此刻該給哪一個。這些
 * entityKey 在同一個 zone 出現多次是**刻意的**，編輯器不該再警告撞名。
 *
 * ⚠️ 這只是 UI 提示層。真正的把關永遠是伺服器端的 409
 * （`interlink.ts` 的 `findKeyConflict`）——即使這裡誤判放行，存檔時
 * 若該 entityKey 其實沒登記在任何綁定鏈，仍會被擋下並顯示原本的錯誤。
 * 因此取不到資料時回空集合（維持既有警告）是安全的預設。
 */

import { useEffect, useState } from 'react';

interface BoundKeysPayload {
  ok?: boolean;
  data?: {
    bound?: Record<string, { echoesIds?: string[]; visualsIds?: string[] }>;
  };
}

/**
 * @param apiBase 編輯器的 API base（同源 proxy 時為空字串——
 *                `/api/concepts/*` proxy 會補上 admin JWT）
 * @param area    只回傳在這個 zone 有登記綁定的 key
 */
export function useBoundEntityKeys(
  apiBase: string,
  area: 'echoes' | 'visuals'
): Set<string> {
  const [bound, setBound] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase}/api/concepts/bound-keys`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: BoundKeysPayload | null) => {
        if (!payload?.ok || !payload.data?.bound) return;
        const keys = new Set<string>();
        for (const [key, value] of Object.entries(payload.data.bound)) {
          const ids = area === 'echoes' ? value.echoesIds : value.visualsIds;
          if (Array.isArray(ids) && ids.length > 0) keys.add(key);
        }
        setBound(keys);
      })
      .catch(() => {
        // 靜默：取不到就維持既有的撞名警告（伺服器 409 才是權威）
      });
    return () => controller.abort();
  }, [apiBase, area]);

  return bound;
}

/** 從撞名集合扣除已登記綁定的 key（兩個編輯器共用同一份扣除邏輯） */
export function withoutBoundKeys(
  taken: Set<string>,
  bound: Set<string>
): Set<string> {
  if (bound.size === 0) return taken;
  const out = new Set<string>();
  for (const key of taken) {
    if (!bound.has(key)) out.add(key);
  }
  return out;
}
