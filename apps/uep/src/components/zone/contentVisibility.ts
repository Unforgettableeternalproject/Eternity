/**
 * 全站內容可見性語意
 *
 * hidden  — 完全不對前台公開（草稿/開發中），所有 Reader 從 tree 排除
 * locked  — 內容存在但尚未解鎖，顯示但不可進入，排除於 prev/next
 * spoiler — 內容可訪問但需劇透警告，解鎖後依等級部分顯示（Echoes/Visuals）
 *
 * Epic 2 起 locked 有兩個來源，語意為聯集：
 * 1. 靜態鎖定 — 編輯端手動勾選 `metadata.locked === true`
 * 2. 動態閘門 — `metadata.gate` 的進度條件未滿足（evaluateGate 為 false）
 *
 * 呼叫端不傳 progress state 時只判定靜態鎖定（向後相容，
 * Visuals/Echoes 在接上進度系統前維持原行為）。
 */

import { evaluateGate, parseGateCondition } from '../../progress';
import type { ProgressState } from '../../progress';

interface HasMetadata {
  metadata?: Record<string, unknown> | null;
}

export function isHidden(node: HasMetadata): boolean {
  return node.metadata?.hidden === true;
}

export function isLocked(
  node: HasMetadata,
  progress?: ProgressState | null
): boolean {
  if (node.metadata?.locked === true) return true;
  if (!progress) return false;
  const gate = parseGateCondition(node.metadata ?? null);
  return gate ? !evaluateGate(progress, gate) : false;
}

export function getSpoilerLevel(node: HasMetadata): number {
  const level = node.metadata?.spoilerLevel;
  return typeof level === 'number' ? level : 0;
}

export function isAccessible(
  node: HasMetadata,
  progress?: ProgressState | null
): boolean {
  return !isHidden(node) && !isLocked(node, progress);
}
