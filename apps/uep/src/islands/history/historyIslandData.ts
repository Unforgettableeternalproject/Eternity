/**
 * History Island — 資料層（純函式 + tree 快取）
 *
 * 旅程之書的內容推導：
 * - 最後閱讀頁 = pageMarkers 中 updatedAt 最新、且存在於 tree 的頁面
 * - 當前卷 = 最後閱讀頁的最上層祖先（【U】【E】【P】層級）
 * - 章節列表 = 當前卷的直接子節點，含進度比例與鎖定狀態
 *
 * gating 求值與 HistoryReader 完全同源（buildProgressTreeAdapter +
 * contentVisibility），語意不可分岔。
 */
/* global PopStateEvent */

import {
  isHidden,
  isLocked,
  isProgressionChainHidden,
} from '../../components/zone/contentVisibility';
import {
  buildProgressTreeAdapter,
  isEffectivelyCompleted,
} from '../../progress';
import type { ProgressState, ProgressTreeAdapter } from '../../progress';

/** content API tree 節點（HistoryReader 的 PageTreeNode 同形） */
export interface HistoryTreeNode {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  pageType: string;
  depth: number;
  status: string;
  metadata: Record<string, unknown>;
  children: HistoryTreeNode[];
}

/** 攤平後的索引集 */
export interface HistoryTreeIndex {
  roots: HistoryTreeNode[];
  nodesById: Map<string, HistoryTreeNode>;
  ancestorsById: Map<string, HistoryTreeNode[]>;
  adapter: ProgressTreeAdapter;
}

/** 建立 tree 索引（island 端的一站式入口） */
export function buildTreeIndex(roots: HistoryTreeNode[]): HistoryTreeIndex {
  const visibleRoots = roots.filter((node) => !isHidden(node));
  const nodesById = new Map<string, HistoryTreeNode>();
  const ancestorsById = new Map<string, HistoryTreeNode[]>();
  const walk = (nodes: HistoryTreeNode[], ancestors: HistoryTreeNode[]) => {
    for (const node of nodes) {
      nodesById.set(node.id, node);
      ancestorsById.set(node.id, ancestors);
      walk(node.children ?? [], [...ancestors, node]);
    }
  };
  walk(visibleRoots, []);
  return {
    roots: visibleRoots,
    nodesById,
    ancestorsById,
    adapter: buildProgressTreeAdapter(visibleRoots),
  };
}

/** 最後閱讀頁：pageMarkers 中 updatedAt 最新、且存在於 tree 的頁面 */
export function deriveLastRead(
  progress: ProgressState,
  index: HistoryTreeIndex
): HistoryTreeNode | null {
  let best: HistoryTreeNode | null = null;
  let bestTime = -Infinity;
  for (const [pageId, marker] of Object.entries(progress.pageMarkers)) {
    const node = index.nodesById.get(pageId);
    if (!node) continue;
    const time = Date.parse(marker.updatedAt);
    if (!Number.isFinite(time) || time <= bestTime) continue;
    best = node;
    bestTime = time;
  }
  return best;
}

/** 當前卷：頁面的最上層祖先（頁面本身是 root 時回傳自己） */
export function volumeOf(
  pageId: string,
  index: HistoryTreeIndex
): HistoryTreeNode | null {
  const node = index.nodesById.get(pageId);
  if (!node) return null;
  const ancestors = index.ancestorsById.get(pageId) || [];
  return ancestors.length > 0 ? ancestors[0] : node;
}

/** 章節列表項目 */
export interface ChapterEntry {
  node: HistoryTreeNode;
  /** 進度葉完成數（無進度葉時以自身完成與否計 0/1） */
  completed: number;
  total: number;
  locked: boolean;
  /** 是否為最後閱讀頁所在的章節鏈上 */
  isCurrent: boolean;
}

/**
 * 當前卷的章節列表：直接子節點，隱藏/進度鏈隱藏的不列，
 * 鎖定的列出但標記（點擊由 UI 層禁用）。
 */
export function buildChapterEntries(
  volume: HistoryTreeNode,
  progress: ProgressState,
  index: HistoryTreeIndex,
  lastReadId: string | null
): ChapterEntry[] {
  const resolvePage = (pageId: string) => index.nodesById.get(pageId);
  const lastReadChain = new Set(
    lastReadId
      ? [
          lastReadId,
          ...(index.ancestorsById.get(lastReadId) || []).map((a) => a.id),
        ]
      : []
  );

  const entries: ChapterEntry[] = [];
  for (const child of volume.children ?? []) {
    if (isHidden(child)) continue;
    if (
      isProgressionChainHidden(
        child,
        progress,
        resolvePage,
        child.id,
        index.adapter
      )
    )
      continue;

    const leaves = index.adapter.getProgressDescendantIds(child.id);
    let completed: number;
    let total: number;
    if (leaves.length > 0) {
      total = leaves.length;
      completed = leaves.filter((leafId) =>
        isEffectivelyCompleted(leafId, progress, index.adapter)
      ).length;
    } else {
      // 無進度葉：以自身完成與否計（非進度頁顯示 0/0，UI 不畫進度條）
      const selfDone = isEffectivelyCompleted(
        child.id,
        progress,
        index.adapter
      );
      total = selfDone ? 1 : 0;
      completed = selfDone ? 1 : 0;
    }

    entries.push({
      node: child,
      completed,
      total,
      locked: isLocked(child, progress, child.id, index.adapter),
      isCurrent: lastReadChain.has(child.id),
    });
  }
  return entries;
}

/** 頁面在 tree 內的可讀性（與 HistoryReader 的最後防線同語意） */
export function isPageNavigable(
  pageId: string,
  progress: ProgressState,
  index: HistoryTreeIndex
): boolean {
  const node = index.nodesById.get(pageId);
  if (!node) return false;
  return !isLocked(node, progress, pageId, index.adapter);
}

/** 進度比例（0~1）；total 為 0 時回傳 null（UI 不畫進度條） */
export function progressRatio(entry: ChapterEntry): number | null {
  if (entry.total === 0) return null;
  return entry.completed / entry.total;
}

/**
 * 平均閱讀時間（分鐘）。讀完的頁面不足時回傳 null（樣本太少沒意義）。
 */
export function averageReadingMinutes(progress: ProgressState): number | null {
  const pages = progress.completedPageIds.length;
  if (pages < 1 || progress.readingStats.totalMs <= 0) return null;
  return progress.readingStats.totalMs / pages / 60_000;
}

/* ── 導航（與 HistoryReader 的 useZoneRouter 合約對接） ── */

/**
 * 跳轉到 History 頁面。
 * - 已在 /history：pushState + 手動 dispatch popstate，讓 Reader 的
 *   useZoneRouter 接手載入（不整頁重載）
 * - 在其他頁面：整頁導航到 /history?page=...
 * 鎖定頁不會走到這裡（UI 層禁用），Reader 端另有最後防線。
 */
export function navigateToHistoryPage(pageId: string): void {
  // 路由統一用不帶 area prefix 的 slug（useZoneRouter 會補回）
  const slug = pageId.startsWith('history/')
    ? pageId.slice('history/'.length)
    : pageId;
  const onHistoryPage =
    window.location.pathname.replace(/\/$/, '') === '/history';
  if (onHistoryPage) {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('page', slug);
    window.history.pushState({}, '', url.toString());
    window.dispatchEvent(new PopStateEvent('popstate'));
  } else {
    window.location.href = `/history?page=${encodeURIComponent(slug)}`;
  }
}

/* ── tree 取得（模組級快取，island 掛載共用） ── */

const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

let treeCache: Promise<HistoryTreeNode[]> | null = null;

/** 取得 History tree（模組級快取；失敗時清除快取讓下次重試） */
export function fetchHistoryTree(): Promise<HistoryTreeNode[]> {
  if (!treeCache) {
    treeCache = (async () => {
      const res = await fetch(`${API_BASE}/api/content/history/tree`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        data: HistoryTreeNode[];
        error?: string;
      };
      if (!json.ok) throw new Error(json.error || 'API returned ok=false');
      return json.data || [];
    })().catch((err) => {
      treeCache = null;
      throw err;
    });
  }
  return treeCache;
}
