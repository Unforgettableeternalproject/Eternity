/**
 * 子頁面列表的「空狀態」判定
 *
 * 兩種空狀態刻意區分：
 *
 * - construction（建設中）——底下沒有任何「存在」的項目。
 *   draft、軟刪除、`metadata.hidden` 一律視同不存在。
 * - sealed（尚未開放）——底下有項目，但對目前讀者全部未解鎖
 *   （static locked、gate 未通過：alwaysLocked / requiresFlags /
 *   pristineOnly / progressPage 鏈等）。
 *
 * 只要有任一可見項目就回 null（不顯示空狀態）。
 *
 * 解鎖判斷不在這裡做：呼叫端傳入各 zone 既有的可見度函式
 * （`isGalleryUnlockedInZone`、`isSongUnlockedInZone`、`isLocked` …）。
 * 判定本身只依賴三種計數，後端日後改回傳計數時直接呼叫
 * `resolveEmptyStateFromCounts` 即可，不必經過 item 版。
 */

export type ItemPresence = 'absent' | 'locked' | 'visible';

export type ZoneEmptyKind = 'construction' | 'sealed';

export interface PresenceCounts {
  visible: number;
  locked: number;
  absent: number;
}

interface PresenceNode {
  status?: string | null;
  deletedAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** draft / 軟刪除 / hidden → 對前台不存在 */
export function isAbsentForReader(node: PresenceNode): boolean {
  if (node.status === 'draft') return true;
  if (node.deletedAt) return true;
  return node.metadata?.hidden === true;
}

/**
 * 單一項目的存在分類。
 *
 * @param isUnlocked 該 zone 既有的解鎖判斷；只對「存在」的項目呼叫
 */
export function classifyPresence<T extends PresenceNode>(
  node: T,
  isUnlocked: (node: T) => boolean
): ItemPresence {
  if (isAbsentForReader(node)) return 'absent';
  return isUnlocked(node) ? 'visible' : 'locked';
}

export function countPresence<T extends PresenceNode>(
  nodes: readonly T[],
  isUnlocked: (node: T) => boolean
): PresenceCounts {
  const counts: PresenceCounts = { visible: 0, locked: 0, absent: 0 };
  for (const node of nodes) {
    counts[classifyPresence(node, isUnlocked)] += 1;
  }
  return counts;
}

export function resolveEmptyStateFromCounts(
  counts: Partial<PresenceCounts>
): ZoneEmptyKind | null {
  if ((counts.visible ?? 0) > 0) return null;
  if ((counts.locked ?? 0) > 0) return 'sealed';
  return 'construction';
}

export function resolveZoneEmptyState<T extends PresenceNode>(
  nodes: readonly T[],
  isUnlocked: (node: T) => boolean
): ZoneEmptyKind | null {
  return resolveEmptyStateFromCounts(countPresence(nodes, isUnlocked));
}

// ──────────────────────────────────────────────────────────────
// 變體與文案
// ──────────────────────────────────────────────────────────────

export type ConstructionVariant = 'command' | 'forklift' | 'working';

export const CONSTRUCTION_VARIANTS: readonly ConstructionVariant[] = [
  'command',
  'forklift',
  'working',
];

export const EMPTY_STATE_ART: Record<ConstructionVariant | 'sealed', string> = {
  command: '/uep/art/empty-command.webp',
  forklift: '/uep/art/empty-forklift.webp',
  working: '/uep/art/empty-working.webp',
  sealed: '/uep/art/empty-exera.webp',
};

export interface EmptyStateCopy {
  title: string;
  subtitle: string;
}

export const CONSTRUCTION_COPY: Record<ConstructionVariant, EmptyStateCopy> = {
  command: {
    title: '施工中，請稍候',
    subtitle: '藍圖已經畫好了，這一區的內容正在陸續搬進來。',
  },
  forklift: {
    title: '搬運中，請小心',
    subtitle: '貨物還在路上，等它們卸下來，這裡就會熱鬧起來。',
  },
  working: {
    title: '還在動工中',
    subtitle: '這裡正一點一點地蓋起來，晚點再回來看看吧。',
  },
};

export const SEALED_COPY: readonly EmptyStateCopy[] = [
  {
    title: '好吧，這裡看起來還沒有東西',
    subtitle: '也許不是真的沒有，只是還沒輪到你看見。',
  },
  {
    title: '嗯……這裡好像空空的？',
    subtitle: '再往別處走走吧，有些東西要等你準備好才會出現。',
  },
  {
    title: '這裡暫時沒什麼可看的',
    subtitle: '繼續探索下去，說不定哪天回來就不一樣了。',
  },
];

/** FNV-1a 32-bit——只求同一字串穩定落在同一格，不求密碼強度 */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 同一子頁面（zone + 路徑）每次看到同一個施工變體 */
export function pickConstructionVariant(seed: string): ConstructionVariant {
  return CONSTRUCTION_VARIANTS[hashSeed(seed) % CONSTRUCTION_VARIANTS.length];
}

export function pickSealedCopy(seed: string): EmptyStateCopy {
  return SEALED_COPY[hashSeed(seed) % SEALED_COPY.length];
}
