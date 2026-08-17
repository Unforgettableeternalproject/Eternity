/* global AbortController */
/**
 * useEntityRevisionGates — 取得某個 entityKey 在 Concepts 的 revision 條件
 *
 * 用途是**授權時機的對位**：角色的主題曲通常要在該角色進到某個敘事階段時
 * 才解鎖，而那個階段早已在 dossier 的 revision 上寫成 gate 了。沒有這個
 * 捷徑就得把同一組旗標在歌曲這邊再寫一次，兩邊還會各自漂移。
 *
 * ⚠️ 套用之後那份條件就**屬於歌曲自己**，與 revision 再無關聯：
 * 之後改 dossier 的 revision 不會回頭影響歌曲。這是刻意的——「內容何時
 * 可得」與「角色的敘事狀態」是兩個問題，多數時候同步但允許分開
 * （見 entityBinding.ts 的預設推論說明）。
 *
 * 資料來自公開的 `/api/concepts/entity-index`，不需要新端點。
 */

import { useEffect, useState } from 'react';

import type { GateCondition } from '../../progress/gating';

export interface EntityRevisionGate {
  /** revision id（慣例為 `{entityKey}:{NN}`） */
  id: string;
  gate: GateCondition;
}

interface IndexEntry {
  stack?: string;
  entityKey?: string;
  revisionGates?: { id: string; gate?: unknown }[];
}

/** 只收得出條件的 revision——無條件的 revision 沒有可套用的東西 */
function toGates(entry: IndexEntry): EntityRevisionGate[] {
  const out: EntityRevisionGate[] = [];
  for (const rev of entry.revisionGates || []) {
    if (!rev?.gate || typeof rev.gate !== 'object') continue;
    out.push({ id: rev.id, gate: rev.gate as GateCondition });
  }
  return out;
}

/**
 * @param apiBase   編輯器的 API base（同源 proxy 時為空字串）
 * @param entityKey 目前頁面的實體身分；未填時回空陣列
 */
export function useEntityRevisionGates(
  apiBase: string,
  entityKey: string | undefined
): EntityRevisionGate[] {
  const [gates, setGates] = useState<EntityRevisionGate[]>([]);

  useEffect(() => {
    const key = entityKey?.trim();
    if (!key) {
      setGates([]);
      return;
    }
    const controller = new AbortController();
    fetch(`${apiBase}/api/concepts/entity-index`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { ok?: boolean; data?: { entries?: IndexEntry[] } }) => {
        if (!payload?.ok) return;
        const entries = (payload.data?.entries || []).filter(
          (e) => e.entityKey === key
        );
        // dossier 優先於 browser（與 entityBinding 求值同一條規則）；
        // 同一個 key 兩邊都有條目時只取權威來源的那條鏈
        const dossier = entries.filter((e) => e.stack === 'dossier');
        const source = dossier.length > 0 ? dossier : entries;
        setGates(source.flatMap(toGates));
      })
      .catch(() => {
        // 靜默：這只是輸入捷徑，缺席不影響手動填寫
      });
    return () => controller.abort();
  }, [apiBase, entityKey]);

  return gates;
}
