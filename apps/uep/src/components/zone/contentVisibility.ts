/**
 * 全站內容可見性語意
 *
 * hidden  — 完全不對前台公開（草稿/開發中），所有 Reader 從 tree 排除
 * locked  — 內容存在但尚未解鎖，顯示但不可進入，排除於 prev/next
 * spoiler — 內容可訪問但需劇透警告，解鎖後依等級部分顯示（Echoes/Visuals）
 */

interface HasMetadata {
  metadata?: Record<string, unknown> | null;
}

export function isHidden(node: HasMetadata): boolean {
  return node.metadata?.hidden === true;
}

export function isLocked(node: HasMetadata): boolean {
  return node.metadata?.locked === true;
}

export function getSpoilerLevel(node: HasMetadata): number {
  const level = node.metadata?.spoilerLevel;
  return typeof level === 'number' ? level : 0;
}

export function isAccessible(node: HasMetadata): boolean {
  return !isHidden(node) && !isLocked(node);
}
