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
import { getApiBase } from '../../lib/apiBase';

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

/**
 * 最後閱讀頁（S6-2 改版）：
 * 1. 優先讀平鋪的 lastVisitedPageId（換頁當下即更新，續讀顯示不落後）——
 *    需存在於 tree 且目前非鎖定（進度重置/資料異動後的防禦）
 * 2. fallback：pageMarkers 中 updatedAt 最新、且存在於 tree 的頁面
 *    （容舊 blob——lastVisited 是 S6-2 才有的欄位）
 */
export function deriveLastRead(
  progress: ProgressState,
  index: HistoryTreeIndex
): HistoryTreeNode | null {
  const visitedId = progress.lastVisitedPageId;
  if (visitedId) {
    const node = index.nodesById.get(visitedId);
    if (node && !isLocked(node, progress, visitedId, index.adapter)) {
      return node;
    }
  }
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

/**
 * 續讀卡 kicker 用的直接上層（S6-2 定案）：
 * Section→顯示 arc、Arc→顯示 chapter、Chapter→不顯示（回傳 null）。
 * 判層用 pageType（schema 保證的枚舉），不用深度推測。
 */
export function parentOf(
  pageId: string,
  index: HistoryTreeIndex
): HistoryTreeNode | null {
  const node = index.nodesById.get(pageId);
  if (!node) return null;
  if (node.pageType === 'chapter' || node.pageType === 'zone') return null;
  const ancestors = index.ancestorsById.get(pageId) || [];
  const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
  if (!parent || parent.pageType === 'zone') return null;
  return parent;
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

    const { completed, total } = progressCounts(child.id, progress, index);

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

/** 進度葉完成數彙總（無進度葉時以自身完成與否計 0/0 或 1/1） */
function progressCounts(
  nodeId: string,
  progress: ProgressState,
  index: HistoryTreeIndex
): { completed: number; total: number } {
  const leaves = index.adapter.getProgressDescendantIds(nodeId);
  if (leaves.length > 0) {
    return {
      total: leaves.length,
      completed: leaves.filter((leafId) =>
        isEffectivelyCompleted(leafId, progress, index.adapter)
      ).length,
    };
  }
  // 無進度葉：以自身完成與否計（非進度頁顯示 0/0，UI 不畫進度條）
  const selfDone = isEffectivelyCompleted(nodeId, progress, index.adapter);
  return { total: selfDone ? 1 : 0, completed: selfDone ? 1 : 0 };
}

/** 目錄列表項（S6-2）：一個已解鎖 chapter + 其底下的 arcs */
export interface ChapterListItem {
  node: HistoryTreeNode;
  completed: number;
  total: number;
  /** 是否在最後閱讀頁的祖先鏈上（UI 預設展開） */
  isCurrent: boolean;
  /** 底下的 arcs（沿用 ChapterEntry 語意：鎖定列出但禁用） */
  arcs: ChapterEntry[];
}

/**
 * 目錄（S6-2 定案重寫）：跨全部卷列出「已解鎖的 chapters」，
 * 每個 chapter 可展開為底下 arcs（不到 section）。
 * 隱藏/進度鏈隱藏/鎖定的 chapter 一律不列（只列已解鎖）。
 */
export function buildUnlockedChapterList(
  index: HistoryTreeIndex,
  progress: ProgressState,
  lastReadId: string | null
): ChapterListItem[] {
  const resolvePage = (pageId: string) => index.nodesById.get(pageId);
  const lastReadChain = new Set(
    lastReadId
      ? [
          lastReadId,
          ...(index.ancestorsById.get(lastReadId) || []).map((a) => a.id),
        ]
      : []
  );

  // 遞迴走全樹撈 chapter（S6-3 修正）：真實 D1 樹是五層
  // passage(page) → zone → chapter → arc → section，root 不是 zone/chapter，
  // 原本只查 root 一層會撈空。不管中間夾 page/homepage/zone 幾層都往下鑽，
  // 遇到 chapter 即收，不再深入（chapter 底下不會再有 chapter）。
  const chapters: HistoryTreeNode[] = [];
  const collectChapters = (nodes: HistoryTreeNode[]) => {
    for (const node of nodes) {
      if (node.pageType === 'chapter') {
        chapters.push(node);
        continue;
      }
      if (node.children?.length) collectChapters(node.children);
    }
  };
  collectChapters(index.roots);

  const items: ChapterListItem[] = [];
  for (const chapter of chapters) {
    if (isHidden(chapter)) continue;
    if (
      isProgressionChainHidden(
        chapter,
        progress,
        resolvePage,
        chapter.id,
        index.adapter
      )
    )
      continue;
    if (isLocked(chapter, progress, chapter.id, index.adapter)) continue;

    const { completed, total } = progressCounts(chapter.id, progress, index);
    items.push({
      node: chapter,
      completed,
      total,
      isCurrent: lastReadChain.has(chapter.id),
      arcs: buildChapterEntries(chapter, progress, index, lastReadId).filter(
        (entry) => entry.node.pageType === 'arc'
      ),
    });
  }
  return items;
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
 * 顯示用進度百分比（S6-3 定案）：1% 下限——
 * 已解鎖但尚未讀完任何進度葉的章節顯示 1% 而非 0%（「已經踏進來了」）。
 * total 為 0 時回傳 null（UI 不畫進度條）；100% 不受下限影響。
 */
export function displayProgressPct(
  completed: number,
  total: number
): number | null {
  if (total <= 0) return null;
  return Math.max(1, Math.min(100, Math.round((completed / total) * 100)));
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

const API_BASE = getApiBase();

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
