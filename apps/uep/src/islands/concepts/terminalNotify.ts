/**
 * terminalNotify — 更動通知的水位 diff 計算與未讀 badge（S7 驗收 #10）
 *
 * 把原本內嵌在 TerminalIsland 更動通知 effect 的水位比對抽成純函式，
 * 讓兩張嘴共用：
 * 1. TerminalIsland（展開時）：渲染條列通知文字 + 寫回水位
 * 2. IslandDock（收合時）：只算未讀數量點亮 chip badge——**不寫回**，
 *    水位只在通知文字真正被看到（terminal 展開）時推進，
 *    收合期間累積的更新展開時一次條列。
 *
 * 語意沿用設計文件 6-6：
 * - 首次遇到的 entityKey 靜默建檔（不通知、不算未讀）
 * - 同 entityKey 跨 stack 多條鏈取最大通過數
 * - 代表條目偏好非 browser（點通知直接 show-entry 用）
 */

import type { ProgressState } from '../../progress/types';

import { passedRevisionCount } from './terminalCore';
import type { TerminalIndexEntry } from './terminalCore';

/** 單筆未讀更新（delta = 高於水位的 revision 數） */
export interface UnreadUpdate {
  key: string;
  /** 目前的通過數（寫回水位用） */
  passed: number;
  delta: number;
  /** 代表條目（偏好非 browser；點擊通知直達用） */
  entry: TerminalIndexEntry;
}

export interface UnreadResult {
  /** 首次遇到的 key → 靜默建檔的水位（呼叫端決定要不要寫回） */
  firstSeen: Record<string, number>;
  /** 高於已讀水位的更新（通知/badge 的來源） */
  updates: UnreadUpdate[];
}

/**
 * 計算未讀更新：各 entityKey 的已通過 revision 數 vs conceptsReadLevel。
 * 純函式——不碰 store、不寫回水位。
 */
export function computeUnreadUpdates(
  entries: TerminalIndexEntry[],
  progress: ProgressState
): UnreadResult {
  const counts = new Map<
    string,
    { passed: number; entry: TerminalIndexEntry }
  >();
  for (const entry of entries) {
    if (!entry.entityKey || !entry.revisionGates?.length) continue;
    const passed = passedRevisionCount(entry, progress);
    const cur = counts.get(entry.entityKey);
    if (!cur) {
      counts.set(entry.entityKey, { passed, entry });
      continue;
    }
    if (passed > cur.passed) cur.passed = passed;
    // 代表條目偏好非 browser（browser 內容不在 terminal 直接展示）
    if (cur.entry.stack === 'browser' && entry.stack !== 'browser') {
      cur.entry = entry;
    }
  }

  const firstSeen: Record<string, number> = {};
  const updates: UnreadUpdate[] = [];
  for (const [key, { passed, entry }] of counts) {
    const known = progress.conceptsReadLevel[key];
    if (known === undefined) {
      firstSeen[key] = passed;
      continue;
    }
    if (passed > known) {
      updates.push({ key, passed, delta: passed - known, entry });
    }
  }
  return { firstSeen, updates };
}
