/* global HTMLAnchorElement */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ZONES } from '../../data/zones';
import { canonicalizePagePath, isSamePagePath } from '../../lib/pagePath';
import { ReaderShell } from '../zone/ReaderShell';
import UepDialogue from '../ui/UepDialogue';
import renderHtmlWithUep from '../ui/renderHtmlWithUep';
import renderInteractiveHtml from '../ui/renderInteractiveHtml';
import ZoneAtmosphere from '../ui/ZoneAtmosphere';
import { ZoneBreadcrumb } from '../zone/ZoneBreadcrumb';
import { ZonePrevNext } from '../zone/ZonePrevNext';
import { useScrollMemory } from '../zone/useScrollMemory';
import { useZoneBootReady } from '../zone/useZoneBootReady';
import { ZoneStateDisplay } from '../zone/ZoneStateDisplay';
import {
  useZoneRouter,
  pushUrl as zonePushUrl,
  clearUrl,
} from '../zone/useZoneRouter';
import {
  isHidden,
  isLocked,
  getLockKind,
  isProgressionChainHidden,
} from '../zone/contentVisibility';
import {
  useScanline,
  useProgress,
  buildProgressTreeAdapter,
  collectMarkers,
  getProgressManager,
  resolveResumeMarkerIdx,
  PROGRESS_CHANGE_EVENT,
} from '../../progress';
import type {
  ProgressTreeAdapter,
  ProgressChangeDetail,
  MarkerPassedInfo,
} from '../../progress';
import {
  LOST_BOOKMARK_OPEN_GATE_EVENT,
  dismissLostBookmark,
  getIslandRuntime,
  isLostBookmarkVisible,
  mountLostBookmarkTestBridge,
  rollLostBookmark,
  settleLostBookmark,
  isPhantomEligibleDivision,
  parsePhantomImages,
  pushClueGallery,
  restoreFromClueSnapshot,
  setClueWaitingCount,
  shouldMountIsland,
  unlockIsland,
  useIslandRuntimeState,
} from '../../islands';
import LostBookmarkGate from './LostBookmarkGate';
import { useEchoSpots } from './useEchoSpots';
import { useVisualClues, type VisualClueEntry } from './useVisualClues';
import VisualClueBookmarks from './VisualClueBookmarks';
import { fetchClueGallery } from './visualClueGallery';
import { deriveGalleryUnlockFlag } from '../../visuals';
import { isGalleryUnlockedInZone } from '../visuals/visualsVisibility';
import { UEP_ENTITY_ACTIVE_ATTR, dispatchEntityActivate } from '../../embed';
import { useEntityRefUnlockChecker } from '../../islands/useEntityRefUnlock';
import './HistoryReader.css';
import { renderIcon } from '../editor/IconLibrary';
import { ChapterTimeline } from './ChapterTimeline';
import type {
  HomepageBlock,
  ZoneHeaderData,
  UepDialogueItem,
  ArchwayCard,
} from '../editor/homepage/types';
import { fromContentBlock } from '../editor/homepage/types';
import { getApiBase } from '../../lib/apiBase';

type PageStatus = 'synced' | 'modified' | 'local_only';
type PageType =
  | 'zone'
  | 'chapter'
  | 'arc'
  | 'section'
  | 'page'
  | 'cluster'
  | 'subcategory'
  | 'song'
  | 'homepage';

interface ContentBlock {
  id: string;
  type: string;
  content: string;
  attrs?: Record<string, unknown>;
}

interface PageTreeNode {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  pageType: PageType;
  depth: number;
  status: PageStatus;
  metadata: Record<string, unknown>;
  children: PageTreeNode[];
}

interface Page {
  id: string;
  area: string;
  title: string;
  slug: string;
  sortOrder: number;
  content: ContentBlock[];
  metadata: Record<string, unknown>;
  parentId: string | null;
  depth: number;
  pageType: PageType;
  status: PageStatus;
  updatedAt: string;
}

const API_BASE = getApiBase();

function flattenTree(nodes: PageTreeNode[], acc: PageTreeNode[] = []) {
  for (const node of nodes) {
    if (isHidden(node)) continue;
    acc.push(node);
    flattenTree(node.children || [], acc);
  }
  return acc;
}

function buildAncestorMap(
  nodes: PageTreeNode[],
  ancestors: PageTreeNode[] = [],
  map = new Map<string, PageTreeNode[]>()
) {
  for (const node of nodes) {
    map.set(node.id, ancestors);
    buildAncestorMap(node.children || [], [...ancestors, node], map);
  }
  return map;
}

function pageTypeLabel(type: PageType) {
  const labels: Record<PageType, string> = {
    zone: 'ZONE',
    chapter: 'CHPT',
    arc: 'ARC',
    section: 'SECT',
    page: 'PAGE',
    cluster: 'CLST',
    subcategory: 'SCAT',
    song: 'SONG',
    homepage: 'HOME',
  };
  return labels[type] || 'PAGE';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function slugifyHeading(text: string, index: number) {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return base || `section-${index + 1}`;
}

function renderBlocks(blocks: ContentBlock[] | undefined) {
  if (!blocks?.length) return '';

  return blocks
    .map((block) => {
      const content = block.content || '';
      switch (block.type) {
        case 'rich_text':
          return content;
        case 'paragraph':
          return /<\/?[a-z][\s\S]*>/i.test(content)
            ? content
            : `<p>${escapeHtml(content)}</p>`;
        case 'heading': {
          const rawLevel = Number(block.attrs?.level ?? 2);
          const level = Math.min(6, Math.max(1, rawLevel));
          return `<h${level}>${escapeHtml(content)}</h${level}>`;
        }
        case 'blockquote':
          return `<blockquote><p>${escapeHtml(content)}</p></blockquote>`;
        case 'code':
          return `<pre><code>${escapeHtml(content)}</code></pre>`;
        case 'divider':
          return '<hr />';
        case 'image':
          return `<img src="${escapeHtml(content)}" alt="${escapeHtml(String(block.attrs?.alt ?? ''))}" />`;
        default:
          return content;
      }
    })
    .join('\n');
}

function resolveInternalLink(
  currentPageId: string,
  href: string,
  pages: PageTreeNode[]
) {
  let clean = href.replace(/\.md$/, '').replace(/\/$/, '');
  clean = clean.replace(/\/README$/, '').replace(/^\.?\//, '');
  clean = canonicalizePagePath(clean);

  const currentDir = currentPageId.includes('/')
    ? currentPageId.substring(0, currentPageId.lastIndexOf('/'))
    : currentPageId;

  // 候選 ID：優先當前頁面子頁，再同目錄，最後 history 根
  const candidates = [
    `${currentPageId}/${clean}`,
    `${currentDir}/${clean}`,
    `history/${clean.replace(/^history\//, '')}`,
  ];

  // 第一輪：精確 ID 比對
  const exact = pages.find((p) => candidates.includes(p.id));
  if (exact) return exact;

  // 第二輪：限定在當前頁面後代範圍中做 suffix 比對
  const scopePrefix = `${currentPageId}/`;
  const scoped = pages.find(
    (p) =>
      p.id.startsWith(scopePrefix) &&
      (p.id.endsWith(`/${clean}`) || p.slug === clean)
  );
  if (scoped) return scoped;

  // 第三輪：同目錄範圍 fallback
  const dirPrefix = `${currentDir}/`;
  return (
    pages.find(
      (p) =>
        p.id.startsWith(dirPrefix) &&
        (p.id.endsWith(`/${clean}`) || p.slug === clean)
    ) || null
  );
}

export default function HistoryReader() {
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<Page | null>(null);
  const [articleHtml, setArticleHtml] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [transitionKey, setTransitionKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zoneActiveTab, setZoneActiveTab] = useState<number | null>(null);

  // 首頁區塊資料（從 D1 homepage 頁面載入）
  const [homepageBlocks, setHomepageBlocks] = useState<HomepageBlock[]>([]);
  // boot 動畫解除狀態由統一 hook 管理
  const { contentReady, markContentReady, setNavPending } = useZoneBootReady();

  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 掃描線文末哨兵（通過 = 頁面完成）
  const scanSentinelRef = useRef<HTMLDivElement>(null);
  const resumeJumpRef = useRef(false);
  const resumeJumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollVelocityRef = useRef(0);
  // 跨頁面導航的滾動位置記憶
  const { saveScroll, getSavedPosition, clearSavedPosition } = useScrollMemory(
    scrollRef,
    [currentId]
  );
  // 「回到上次閱讀位置」滾動軸標記
  const [scrollHint, setScrollHint] = useState<{
    targetTop: number;
    pct: number; // 0~100，標記在滾動軸上的百分比位置
    leaving?: boolean; // 消失動畫中
  } | null>(null);
  // 「一張遺落的書籤」儀式頁是否佔據內容區（S6-2，浮島解鎖儀式）
  const [bookmarkGateOpen, setBookmarkGateOpen] = useState(false);

  // 進度需先於 echo spot handler 建立：spot 授旗永遠執行，但播放/提示卡
  // 受 echoes 島掛載與 spoiler 狀態守門。
  const progress = useProgress();
  // entity 嵌入的條目級可點守門（「可點 ⟺ terminal 查得到內容」不變量）
  const isEntityRefUnlocked = useEntityRefUnlockChecker(progress);
  const onEchoMarkerPassed = useEchoSpots({
    pageId: currentId,
    progress,
    apiBase: API_BASE,
    resumeJumpRef,
    scrollVelocityRef,
  });

  // 最近捲動速度供 autoplay 防禦使用。停止 180ms 後歸零，避免使用者
  // 停下閱讀後仍被前一個快速 wheel 事件誤判。
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let lastTop = element.scrollTop;
    let lastAt = performance.now();
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      const now = performance.now();
      const elapsed = Math.max(now - lastAt, 1);
      scrollVelocityRef.current =
        (Math.abs(element.scrollTop - lastTop) / elapsed) * 1000;
      lastTop = element.scrollTop;
      lastAt = now;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        scrollVelocityRef.current = 0;
      }, 180);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, []);

  // 本次頁面造訪中「已點擊、尚未通過訖點」的 clue——通過訖點時觸發
  // 快照恢復；換頁時整組重置（恢復由 unmount 路徑兜底）。
  const clickedCluesRef = useRef(new Set<string>());
  // session dedupe（V-D.31）：點擊過且通過訖點的 clue 本次頁面活動
  // 不再出現；重新造訪頁面可再現（同 echo spot 手法）。
  const [dismissedClueIds, setDismissedClueIds] = useState<Set<string>>(
    () => new Set()
  );
  // 反查回應落地時檢查是否仍在同一頁（非同步競態防禦）
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  // 書籤點擊 → 反查現行 gallery → 快照目前投射 → 強制展示（V-D.30）
  const handleVisualClueClick = (clue: VisualClueEntry) => {
    const pageIdAtClick = currentId;
    // 點擊當下即登記——反查回應前就通過訖點時，end callback 才看得到
    // 這筆點擊（dismiss 正常落定），回應落地時亦以此判斷展示時機是否已過
    clickedCluesRef.current.add(clue.clueId);
    void fetchClueGallery(API_BASE, clue).then((gallery) => {
      // 反查期間換頁：不再屬於這次閱讀情境，放棄展示
      if (pageIdAtClick !== currentIdRef.current) return;
      // 反查期間已通過訖點（end callback 已 dismiss 這筆點擊）：
      // 展示時機已過，不再插播——投射不會殘留到離頁才恢復
      if (!clickedCluesRef.current.has(clue.clueId)) return;
      if (!gallery) {
        clickedCluesRef.current.delete(clue.clueId);
        window.__uepToastManager?.info('這個線索指向的畫廊已不存在。');
        return;
      }
      const images = parsePhantomImages(gallery.images);
      if (
        !isPhantomEligibleDivision(gallery.divisionId) ||
        images.length === 0
      ) {
        clickedCluesRef.current.delete(clue.clueId);
        window.__uepToastManager?.info('這個線索指向的畫廊目前無法展示。');
        return;
      }
      // clue 授旗（V-D.32，對位 echo spot 推導旗標）：展示即授予
      // gallery 解鎖旗標；原未解鎖（本頁 gate 求值，無 tree——同
      // entity-song 已知限制；推導旗標已解鎖者不重複通知）則附解鎖提示
      const progressNow = getProgressManager().getState();
      const wasLocked = !isGalleryUnlockedInZone(
        {
          id: gallery.id,
          metadata: {
            entityKey: gallery.entityKey ?? null,
            gate: gallery.gate,
            locked: gallery.locked,
          },
        },
        progressNow
      );
      getProgressManager().grantFlags([
        deriveGalleryUnlockFlag(gallery.id, gallery.entityKey),
      ]);
      if (wasLocked) {
        window.__uepToastManager?.success(
          `「${gallery.title}」的封印解開了，收入浮動幻影的畫框。`
        );
      }
      pushClueGallery({
        id: gallery.id,
        title: gallery.title,
        entityKey: gallery.entityKey ?? null,
        divisionId: gallery.divisionId ?? null,
        // gallery 閘快照——島依 progress 變化重驗（pristineOnly 可失效）
        gate: gallery.gate ?? null,
        locked: gallery.locked === true,
        images,
        source: 'clue',
        relatedHistoryIds: pageIdAtClick ? [pageIdAtClick] : [],
      });
      // 島已展開（書籤僅於展開時渲染）——把焦點推到最上層
      getIslandRuntime().open('visuals');
    });
  };

  // 通過訖點 = clue 結束：已點擊者恢復快照 + session dedupe 落定
  // （掃描線 role callback 驅動）
  const onVisualClueMarkerPassed = (info: MarkerPassedInfo) => {
    if (info.role !== 'visual-clue-end') return;
    const clueId = info.element.getAttribute('data-clue-id')?.trim() || '';
    if (!clueId || !clickedCluesRef.current.has(clueId)) return;
    clickedCluesRef.current.delete(clueId);
    setDismissedClueIds((prev) => new Set(prev).add(clueId));
    if (currentIdRef.current) {
      try {
        sessionStorage.setItem(
          `uep.visual-clue.dismissed.${currentIdRef.current}.${clueId}`,
          '1'
        );
      } catch {
        // 隱私模式下 sessionStorage 可能不可寫；state Set 仍可去重。
      }
    }
    restoreFromClueSnapshot();
  };

  // 換頁/離開文章：clue 插播中一律恢復快照（同 echo spot 離頁恢復），
  // 已點擊集合與 dedupe 重置——「重新造訪頁面可再現」的邊界即是
  // 頁面活動（sessionStorage 鍵一併清掉，同 echo spot 手法）
  useEffect(() => {
    clickedCluesRef.current = new Set();
    setDismissedClueIds(new Set());
    if (currentId) {
      const prefix = `uep.visual-clue.dismissed.${currentId}.`;
      try {
        for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
          const key = sessionStorage.key(index);
          if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
        }
      } catch {
        // sessionStorage 不可用時 state 重置已足夠。
      }
    }
    return () => {
      restoreFromClueSnapshot();
    };
  }, [currentId]);

  // 掃描線：追蹤文章閱讀進度（Epic 2）。滾動容器是內層
  // .history-content div，root 必須指定 scrollRef 而非 viewport；
  // articleHtml 變更時 observer 整組重建。
  useScanline({
    pageId: currentId,
    containerRef: contentRef,
    sentinelRef: scanSentinelRef,
    rootRef: scrollRef,
    contentKey: articleHtml,
    enabled: Boolean(
      currentId &&
      currentPage &&
      articleHtml &&
      !contentLoading &&
      !contentError &&
      !bookmarkGateOpen
    ),
    // echo spot 插播與 visual clue 訖點恢復共用同一條掃描線
    onMarkerPassed: (info) => {
      onEchoMarkerPassed(info);
      onVisualClueMarkerPassed(info);
    },
  });

  // Visual Clue 側邊書籤（S8 下半場 V-D）：掃描線在起訖區間內時浮現。
  // 守門：浮動幻影已掛載（探索者+已解鎖+未停用）才觀察；展開中才
  // 渲染書籤，收合時走 dock chip 閃爍提示；觀測者/未解鎖完全不出現。
  const islandState = useIslandRuntimeState();
  const visualsIslandOpen = Boolean(islandState.windows.visuals?.open);
  const canShowVisualClues = shouldMountIsland(progress, 'visuals');
  const activeVisualClues = useVisualClues({
    pageId: currentId,
    containerRef: contentRef,
    scrollRef,
    contentKey: articleHtml,
    enabled: Boolean(
      canShowVisualClues &&
      currentId &&
      currentPage &&
      articleHtml &&
      !contentLoading &&
      !contentError &&
      !bookmarkGateOpen
    ),
  });
  // session dedupe 過濾後實際可見的 clue（V-D.31）
  const visibleVisualClues = activeVisualClues.filter(
    (clue) => !dismissedClueIds.has(clue.clueId)
  );

  // 島收合中（已掛載但未展開）且區間內有 clue → dock chip 閃爍提示；
  // 展開瞬間計數歸零（chip 本來也會離開 dock），書籤自動重現
  const clueWaitingCount =
    canShowVisualClues && !visualsIslandOpen ? visibleVisualClues.length : 0;
  useEffect(() => {
    setClueWaitingCount(clueWaitingCount);
  }, [clueWaitingCount]);
  useEffect(() => () => setClueWaitingCount(0), []);

  const beginResumeJump = () => {
    resumeJumpRef.current = true;
    try {
      sessionStorage.setItem('reading-resume-jump', '1');
    } catch {
      // sessionStorage 不可用時 ref 仍足以保護當次跳轉。
    }
    const clear = () => {
      resumeJumpRef.current = false;
      try {
        sessionStorage.removeItem('reading-resume-jump');
      } catch {
        // no-op
      }
      if (resumeJumpTimerRef.current) {
        clearTimeout(resumeJumpTimerRef.current);
        resumeJumpTimerRef.current = null;
      }
    };
    scrollRef.current?.addEventListener('scrollend', clear, { once: true });
    if (resumeJumpTimerRef.current) clearTimeout(resumeJumpTimerRef.current);
    resumeJumpTimerRef.current = setTimeout(clear, 500);
  };

  useEffect(
    () => () => {
      if (resumeJumpTimerRef.current) clearTimeout(resumeJumpTimerRef.current);
    },
    []
  );

  // 閱讀時間統計（S6，History Island 的簡單統計用）：
  // 每次文章停留結束（換頁/離開）時累計停留時間，單次造訪上限
  // 30 分鐘防掛機灌水。粗粒度即可——這只是輔助統計，不是精確計時。
  useEffect(() => {
    if (!currentId) return undefined;
    const start = Date.now();
    return () => {
      const READING_TIME_CAP_MS = 30 * 60 * 1000;
      const elapsed = Math.min(Date.now() - start, READING_TIME_CAP_MS);
      getProgressManager().addReadingTime(elapsed);
    };
  }, [currentId]);

  const flatPages = useMemo(() => flattenTree(tree, []), [tree]);
  const ancestorMap = useMemo(() => buildAncestorMap(tree), [tree]);
  // pageId → node 索引（進度鏈隱藏判定用）
  const pagesById = useMemo(() => {
    const map = new Map<string, PageTreeNode>();
    for (const page of flatPages) map.set(page.id, page);
    return map;
  }, [flatPages]);
  const resolvePageById = (pageId: string) => pagesById.get(pageId);

  // 遺落的書籤：每次「首次讀完一篇」roll 一次出現機率（S6-2）。
  // page-completed 信號只在 completedPageIds 首次新增時發出，
  // 跳章/重讀不會誤觸。
  useEffect(() => {
    const onProgressChange = (event: Event) => {
      const detail = (event as CustomEvent<ProgressChangeDetail>).detail;
      if (detail?.source !== 'page-completed') return;
      rollLostBookmark(detail.state);
    };
    window.addEventListener(PROGRESS_CHANGE_EVENT, onProgressChange);
    return () =>
      window.removeEventListener(PROGRESS_CHANGE_EVENT, onProgressChange);
  }, []);

  // 遺落的書籤測試 hook（S6-3，dev only）：機率制難以手動驗收，
  // 掛 window.__uepLostBookmarkTest 供 console 操作；openGate 事件
  // 直接開啟儀式頁。production build 為 no-op。
  useEffect(() => {
    const unmountBridge = mountLostBookmarkTestBridge();
    const onOpenGate = () => setBookmarkGateOpen(true);
    window.addEventListener(LOST_BOOKMARK_OPEN_GATE_EVENT, onOpenGate);
    return () => {
      unmountBridge();
      window.removeEventListener(LOST_BOOKMARK_OPEN_GATE_EVENT, onOpenGate);
    };
  }, []);

  // 書籤條目的插入錨點：最後閱讀頁所在的 chapter（跟隨閱讀進度，
  // 呼應「書架縫隙」——條目渲染在該 chapter 的樹項下方）
  const lostBookmarkAnchorId = useMemo(() => {
    if (!isLostBookmarkVisible(progress)) return null;
    const lastId = progress.lastVisitedPageId;
    if (!lastId) return null;
    const self = pagesById.get(lastId);
    if (!self) return null;
    if (self.pageType === 'chapter') return self.id;
    const chapter = (ancestorMap.get(lastId) || []).find(
      (a) => a.pageType === 'chapter'
    );
    return chapter ? chapter.id : self.id;
  }, [progress, pagesById, ancestorMap]);

  // Progress tree adapter：把 PageTreeNode 樹接進 gating 的 tree 求值層
  // （effectiveGate / isEffectivelyCompleted 需要 sibling & 父層資訊）。
  // S6 起抽出為 progress/tree 的 buildProgressTreeAdapter 共用實作——
  // History Island 需要同一套求值語意（同層前一個進度頁、父容器繼承、
  // hidden/locked 排除、內容型 pageType 過濾）。
  const progressTree = useMemo<ProgressTreeAdapter>(
    () => buildProgressTreeAdapter(tree),
    [tree]
  );

  const readablePages = useMemo(
    () =>
      flatPages.filter(
        (page) =>
          page.pageType !== 'page' &&
          !isLocked(page, progress, page.id, progressTree)
      ),
    [flatPages, progress, progressTree]
  );
  const pageLevelNodes = useMemo(
    () => flatPages.filter((page) => page.pageType === 'page'),
    [flatPages]
  );
  const currentIndex = currentId
    ? readablePages.findIndex((page) => page.id === currentId)
    : -1;
  const prevPage = currentIndex > 0 ? readablePages[currentIndex - 1] : null;
  const nextPage =
    currentIndex >= 0 && currentIndex < readablePages.length - 1
      ? readablePages[currentIndex + 1]
      : null;
  const passageNode =
    pageLevelNodes.find((page) => page.id === 'history/passage') ||
    pageLevelNodes[0] ||
    null;
  const historyZone = ZONES.find((zone) => zone.id === 'history') || ZONES[0];
  const archNodes = useMemo(
    () =>
      (passageNode?.children || [])
        .filter((node) => node.pageType === 'zone')
        .slice(0, 3),
    [passageNode]
  );

  useEffect(() => {
    // 手機上預設收合側邊欄；桌面尊重 localStorage
    const isMobileNow = window.matchMedia('(max-width: 760px)').matches;
    if (isMobileNow) {
      setSidebarOpen(false);
    } else {
      const storedSidebar = localStorage.getItem('history-sidebar');
      if (storedSidebar === 'closed') setSidebarOpen(false);
    }

    void fetchTree();
  }, []);

  // entity 啟動事件的消費端是 Terminal Island（S7-C 接管；
  // 監聽常駐 IslandHost，經 terminalBridge 轉交）——S4 的 Toast
  // 佔位 effect 已於此拆除。本元件只負責 dispatch（見 handleContentClick）。

  // === URL 路由（useZoneRouter 統一管理 deep link 與 popstate）===
  useZoneRouter({
    routes: [
      {
        param: 'page',
        handler: (value) => {
          // 統一用 slug（不帶 area prefix），同時向後相容帶 prefix 的舊連結
          const fullId = canonicalizePagePath(
            value.startsWith('history/') ? value : ['history', value].join('/')
          );
          const target = readablePages.find((p) => p.id === fullId);
          if (target) void loadPage(target, false);
        },
      },
    ],
    onLanding: () => {
      setCurrentId(null);
      setCurrentPage(null);
      setArticleHtml('');
    },
    treeReady: tree.length > 0 && readablePages.length > 0,
    setBootNavPending: setNavPending,
  });

  // 目前頁面的閘門重新驗證：loadPage 只在進入時擋，若使用者已在
  // gated 頁內而狀態事後變化（觀測者切回探索者、進度重置、登入合併
  // 後旗標消失），gate 不再滿足時要踢回 landing，不讓內容殘留。
  useEffect(() => {
    if (!currentId) return;
    const node = pagesById.get(currentId);
    if (node && isLocked(node, progress, node.id, progressTree)) {
      setCurrentId(null);
      setCurrentPage(null);
      setArticleHtml('');
      setScrollHint(null);
      clearUrl();
      scrollRef.current?.scrollTo({ top: 0 });
    }
  }, [progress, currentId, pagesById, progressTree]);

  // 孤兒 complete 靜默清理：tree 載入或變動時掃一次，
  // 清除依賴不成立的 completed:* 旗標（測試模式手動蓋、匯入舊資料、
  // 靜態鎖遲設等）。sweep 本身冪等，無孤兒時零副作用。
  useEffect(() => {
    if (!pagesById.size) return;
    getProgressManager().sweepOrphanCompletions(progressTree);
  }, [pagesById, progressTree]);

  // 節點狀態轉換動畫：追蹤上次 render 時每個節點的可見鎖定態，
  // progress 變化後比對觸發「露出」與「解鎖」入場動畫。第一次
  // mount 建立基線（不觸發動畫，避免頁面初載時整片亮起）。
  type NodeStatus = 'hidden' | 'progression' | 'flag' | 'static' | 'open';
  const prevStatuses = useRef<Map<string, NodeStatus>>(new Map());
  const [revealAnim, setRevealAnim] = useState<Set<string>>(new Set());
  const [unlockAnim, setUnlockAnim] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!pagesById.size) return;
    const nextStatuses = new Map<string, NodeStatus>();
    const revealed = new Set<string>();
    const unlocked = new Set<string>();
    const baseline = prevStatuses.current.size === 0;
    for (const page of flatPages) {
      const chainHidden = isProgressionChainHidden(
        page,
        progress,
        resolvePageById,
        page.id,
        progressTree
      );
      const kind = chainHidden
        ? null
        : getLockKind(page, progress, page.id, progressTree);
      const status: NodeStatus = chainHidden ? 'hidden' : (kind ?? 'open');
      nextStatuses.set(page.id, status);
      if (baseline) continue;
      const prev = prevStatuses.current.get(page.id);
      if (prev === 'hidden' && status !== 'hidden') revealed.add(page.id);
      if ((prev === 'progression' || prev === 'flag') && status === 'open')
        unlocked.add(page.id);
    }
    prevStatuses.current = nextStatuses;
    if (revealed.size === 0 && unlocked.size === 0) return;
    setRevealAnim(revealed);
    setUnlockAnim(unlocked);
    // 動畫長度 ≈ 0.9s；動畫結束後清除 class（重複觸發時
    // React 會以新 Set 重掛 class，CSS animation 自然重播）
    const clear = window.setTimeout(() => {
      setRevealAnim(new Set());
      setUnlockAnim(new Set());
    }, 900);
    return () => window.clearTimeout(clear);
  }, [progress, flatPages, progressTree, pagesById]);

  // 載入首頁區塊資料，完成後通知 boot hook 解除動畫
  useEffect(() => {
    fetch(`${API_BASE}/api/content/history/homepage`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: any) => {
        if (!json?.ok || !json.data?.content) return;
        const raw =
          typeof json.data.content === 'string'
            ? JSON.parse(json.data.content)
            : json.data.content;
        if (Array.isArray(raw) && raw.length > 0) {
          setHomepageBlocks(raw.map(fromContentBlock));
        }
      })
      .catch(() => {})
      .finally(() => {
        // 通知 hook homepage 資料已就緒（安全超時由 hook 內部處理）
        markContentReady();
      });
  }, [markContentReady]);

  useEffect(() => {
    if (!contentRef.current) return;
    const root = contentRef.current;

    root.querySelectorAll<HTMLElement>('h2, h3').forEach((heading, index) => {
      if (!heading.id)
        heading.id = slugifyHeading(heading.textContent || '', index);
    });

    root
      .querySelectorAll<HTMLElement>('.tabs-container')
      .forEach((container) => {
        const buttons = Array.from(
          container.querySelectorAll<HTMLElement>('.tab-btn')
        );
        const panels = Array.from(
          container.querySelectorAll<HTMLElement>('.tab-panel')
        );
        buttons.forEach((button) => {
          button.addEventListener('click', () => {
            const tab = button.getAttribute('data-tab');
            buttons.forEach((btn) => btn.classList.remove('active'));
            button.classList.add('active');
            panels.forEach((panel) => {
              panel.style.display =
                panel.getAttribute('data-tab') === tab ? 'block' : 'none';
            });
          });
        });
      });
  }, [articleHtml]);

  async function fetchTree() {
    setTreeLoading(true);
    setTreeError(null);

    try {
      const res = await fetch(`${API_BASE}/api/content/history/tree`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        data: PageTreeNode[];
        error?: string;
      };
      if (!json.ok) throw new Error(json.error || 'API returned ok=false');

      const visibleRoots = (json.data || []).filter((node) => !isHidden(node));
      setTree(visibleRoots);
      setExpanded(new Set(visibleRoots.map((node) => node.id)));
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreeLoading(false);
    }
  }

  async function fetchPageById(id: string) {
    const res = await fetch(`${API_BASE}/api/content/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      ok: boolean;
      data: Page;
      error?: string;
    };
    if (!json.ok) throw new Error(json.error || 'API returned ok=false');
    return json.data;
  }

  async function loadPage(node: PageTreeNode, pushState = true) {
    // 閘門守衛：所有導航路徑（tree、zone tabs、文內連結、breadcrumb、
    // prev/next、deep link）都收斂到這裡，鎖定頁一律擋下。
    // tree/prev/next 各自有 UI 層排除，這裡是統一的最後防線。
    if (isLocked(node, progress, node.id, progressTree)) return;

    // 遺落的書籤：條目浮現時導航到「其他」頁面 = 忽視 → 消失並重置機率
    // （S6-2 定案）。回到同一頁（重新整理的 deep link）不算忽視。
    // 儀式頁若開著則一併關閉。
    setBookmarkGateOpen(false);
    const progressSnapshot = getProgressManager().getState();
    if (node.id !== progressSnapshot.lastVisitedPageId) {
      dismissLostBookmark(progressSnapshot);
    }

    // 導航前先儲存當前頁面的滾動位置。chapter 頁是目錄性質不應留紀錄，
    // 順手也把先前殘留清除，避免使用者切換視角後回到過期位置。
    const prevPageType = currentId
      ? pagesById.get(currentId)?.pageType
      : undefined;
    if (currentId && prevPageType !== 'chapter') {
      saveScroll(currentId);
    } else if (currentId) {
      clearSavedPosition(currentId);
    } else {
      saveScroll('landing');
    }
    setScrollHint(null);

    if (node.pageType === 'page') {
      setCurrentId(null);
      setCurrentPage(null);
      setArticleHtml('');
      clearUrl();
      // landing 頁不做滾動恢復提示，直接回頂
      scrollRef.current?.scrollTo({ top: 0 });
      if (node.children.length) {
        setExpanded((prev) => new Set([...prev, node.id]));
      }
      // deep link 進入 landing 頁時也要解除 boot pending
      setNavPending(false);
      return;
    }

    setCurrentId(node.id);
    setCurrentPage(null);
    setContentLoading(true);
    setContentError(null);
    setArticleHtml('');
    setZoneActiveTab(null);

    const ancestors = ancestorMap.get(node.id) || [];
    setExpanded(
      (prev) => new Set([...prev, ...ancestors.map((item) => item.id), node.id])
    );

    try {
      const page = await fetchPageById(node.id);
      setCurrentPage(page);
      setArticleHtml(renderBlocks(page.content));
      // 記錄最後造訪頁（S6-2 續讀顯示；與掃描線 pageMarkers 無關）
      getProgressManager().markPageVisited(node.id);
      // 一律先回到頂部，若有已儲存位置則在滾動軸顯示標記。
      // session 內用精確 scroll 位置；跨 session fallback 到
      // 掃描線 lastMarkerIdx 對應的標記點位置。
      scrollRef.current?.scrollTo({ top: 0 });
      const saved = getSavedPosition(node.id);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (!el) return;
          const targetTop = saved ?? resolveMarkerResumeTop(node.id, el);
          if (targetTop == null || targetTop <= 0) return;
          const scrollable = el.scrollHeight - el.clientHeight;
          const pct = scrollable > 0 ? (targetTop / scrollable) * 100 : 0;
          setScrollHint({ targetTop, pct: Math.min(pct, 95) });
        });
      });

      if (pushState) zonePushUrl({ page: node.id.replace(/^history\//, '') });
    } catch (err) {
      setContentError(err instanceof Error ? err.message : String(err));
    } finally {
      setContentLoading(false);
      setTransitionKey((k) => k + 1);
      setNavPending(false);
    }
  }

  /**
   * 跨 session 續讀：由掃描線 lastMarkerIdx 換算滾動位置。
   * 是否該提示由 resolveResumeMarkerIdx 統一判定（已完成頁面不提示，
   * 即使讀完後回捲讓 lastMarkerIdx 變小）；內容變動導致索引失效時放棄。
   */
  function resolveMarkerResumeTop(
    pageId: string,
    scrollEl: HTMLElement
  ): number | null {
    const idx = resolveResumeMarkerIdx(getProgressManager().getState(), pageId);
    if (idx == null || !contentRef.current) return null;
    const marker = collectMarkers(contentRef.current)[idx];
    if (!marker) return null;
    const top =
      (marker.el as HTMLElement).getBoundingClientRect().top -
      scrollEl.getBoundingClientRect().top +
      scrollEl.scrollTop -
      120; // 標記點上方預留呼吸空間
    return top > 0 ? top : null;
  }

  function toggleSidebar() {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('history-sidebar', next ? 'open' : 'closed');
      return next;
    });
  }

  function onArticleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;

    // 已解鎖的 entity 標記：dispatch 啟動事件（浮島消費；S4 為 Toast 佔位）
    const entityEl = target.closest<HTMLElement>(`[${UEP_ENTITY_ACTIVE_ATTR}]`);
    if (entityEl) {
      event.preventDefault();
      dispatchEntityActivate(entityEl, currentId ?? undefined);
      return;
    }

    const navCard = target.closest<HTMLElement>('.content-card[data-nav-ref]');
    if (navCard) {
      const ref = navCard.dataset.navRef || '';
      const canonicalRef = canonicalizePagePath(ref.replace(/\/$/, ''));
      const match = flatPages.find(
        (page) =>
          page.id.endsWith(`/${canonicalRef}`) ||
          page.slug.endsWith(`/${canonicalRef}`) ||
          page.slug === canonicalRef
      );
      if (match && match.pageType !== 'page') {
        event.preventDefault();
        void loadPage(match);
      }
      return;
    }

    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (!link || !currentId) return;

    const href = link.getAttribute('href') || '';
    if (
      href.startsWith('http') ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('javascript:')
    )
      return;

    // 處理編輯器插入的內部頁面連結（@page:{pageId} 格式）
    if (href.startsWith('@page:')) {
      const pageId = href.slice(6);
      const target = flatPages.find((p) => isSamePagePath(p.id, pageId));
      if (target && target.pageType !== 'page') {
        event.preventDefault();
        void loadPage(target);
      }
      return;
    }

    const resolved = resolveInternalLink(currentId, href, flatPages);
    if (resolved && resolved.pageType !== 'page') {
      event.preventDefault();
      void loadPage(resolved);
    }
  }

  /** entity 標記的鍵盤可及性：Enter / Space 等同點擊 */
  function onArticleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target as HTMLElement;
    if (!target.hasAttribute(UEP_ENTITY_ACTIVE_ATTR)) return;
    event.preventDefault();
    dispatchEntityActivate(target, currentId ?? undefined);
  }

  function toggleNode(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function returnToLanding() {
    // 目錄性質頁面（chapter）不記憶位置
    const prevPageType = currentId
      ? pagesById.get(currentId)?.pageType
      : undefined;
    if (currentId && prevPageType !== 'chapter') {
      saveScroll(currentId);
    } else if (currentId) {
      clearSavedPosition(currentId);
    } else {
      saveScroll('landing');
    }
    setScrollHint(null);
    setCurrentId(null);
    setCurrentPage(null);
    setArticleHtml('');
    setTransitionKey((k) => k + 1);
    clearUrl();
    scrollRef.current?.scrollTo({ top: 0 });
  }

  function isNodeVisible(node: PageTreeNode) {
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return (
      node.title.toLowerCase().includes(needle) ||
      node.slug.toLowerCase().includes(needle) ||
      node.children.some(isNodeVisible)
    );
  }

  function renderTree(nodes: PageTreeNode[], depth = 0): React.ReactNode {
    return nodes
      .filter((node) => !isHidden(node) && isNodeVisible(node))
      .flatMap((node) => {
        // 進度鏈隱藏：依賴頁本身仍鎖定的進度鎖頁面不顯示（循序漸進）
        if (
          isProgressionChainHidden(
            node,
            progress,
            resolvePageById,
            node.id,
            progressTree
          )
        ) {
          return [];
        }
        const children = (node.children || []).filter(
          (child) => !isHidden(child)
        );
        if (node.pageType === 'page' || node.pageType === 'homepage') {
          return renderTree(children, depth);
        }

        const hasChildren = children.length > 0;
        const isExpanded = expanded.has(node.id) || Boolean(query.trim());
        const isCurrent = node.id === currentId;
        // 鎖定三態：static 原樣🔒 / progression 標題模糊 / flag 標題遮蔽
        const lockKind = getLockKind(node, progress, node.id, progressTree);
        const nodeLocked = lockKind !== null;
        // 鎖定容器不展開子樹（子節點已於下方 render 中 guard），
        // 一併收起 chevron 免得只按下無反應。
        const showChevron = hasChildren && !nodeLocked;

        const revealed = revealAnim.has(node.id);
        const unlocked = unlockAnim.has(node.id);
        const treeItem = (
          <div
            className={`history-tree-item${revealed ? ' is-revealed' : ''}${unlocked ? ' is-unlocked' : ''}`}
            data-depth={depth}
            key={node.id}
          >
            <div className="history-tree-row">
              {showChevron ? (
                <button
                  className="history-tree-chevron"
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? '收合' : '展開'} ${node.title}`}
                  onClick={() => toggleNode(node.id)}
                >
                  {isExpanded ? '−' : '+'}
                </button>
              ) : (
                <span className="history-tree-spacer" />
              )}
              <button
                type="button"
                className={`history-tree-link ${isCurrent ? 'is-current' : ''}`}
                style={{
                  paddingLeft: `${Math.min(depth, 5) * 10 + 8}px`,
                  opacity: lockKind === 'static' ? 0.45 : undefined,
                  cursor: nodeLocked ? 'not-allowed' : undefined,
                }}
                onClick={() => {
                  if (!nodeLocked) void loadPage(node);
                }}
                disabled={nodeLocked}
              >
                {lockKind === 'static' ? (
                  <span className="history-tree-kind" style={{ opacity: 0.6 }}>
                    🔒
                  </span>
                ) : lockKind === 'progression' ? (
                  <span className="history-tree-kind" style={{ opacity: 0.6 }}>
                    ◌
                  </span>
                ) : lockKind === 'flag' ? (
                  <span className="history-tree-kind" style={{ opacity: 0.6 }}>
                    ❖
                  </span>
                ) : (
                  renderIcon(
                    node.metadata?.icon as string,
                    14,
                    'history-tree-icon'
                  ) || (
                    <span className="history-tree-kind">
                      {pageTypeLabel(node.pageType)}
                    </span>
                  )
                )}
                {lockKind === 'flag' ? (
                  <span className="history-tree-title history-tree-title--veiled">
                    ？？？
                  </span>
                ) : (
                  <span
                    className={`history-tree-title${
                      lockKind === 'progression'
                        ? ' history-tree-title--blurred'
                        : ''
                    }`}
                  >
                    {node.title}
                  </span>
                )}
              </button>
            </div>
            {hasChildren && isExpanded && !nodeLocked && (
              <div className="history-tree-children">
                {renderTree(children, depth + 1)}
              </div>
            )}
          </div>
        );

        // 遺落的書籤（S6-2）：條目插在最後閱讀頁所在 chapter 的下方縫隙
        if (node.id === lostBookmarkAnchorId) {
          return [treeItem, renderLostBookmarkEntry(depth)];
        }
        return treeItem;
      });
  }

  /** 「一張遺落的書籤」導航樹條目：特殊樣式，點擊開啟儀式頁 */
  function renderLostBookmarkEntry(depth: number) {
    return (
      <div
        className="history-tree-item history-tree-item--bookmark"
        data-depth={depth}
        key="lost-bookmark-entry"
      >
        <div className="history-tree-row">
          <span className="history-tree-spacer" />
          <button
            type="button"
            className={`history-tree-link history-tree-bookmark${bookmarkGateOpen ? ' is-current' : ''}`}
            style={{ paddingLeft: `${Math.min(depth, 5) * 10 + 8}px` }}
            onClick={() => setBookmarkGateOpen(true)}
            title="書架的縫隙裡，似乎夾著什麼……"
          >
            <span className="history-tree-kind" aria-hidden>
              🔖
            </span>
            <span className="history-tree-title">一張遺落的書籤</span>
          </button>
        </div>
      </div>
    );
  }

  /** 儀式完成：解鎖旅程之書並回到閱讀（內容區本來就停在上次閱讀頁） */
  function handleLostBookmarkOpen() {
    settleLostBookmark();
    unlockIsland('history');
    getIslandRuntime().open('history');
    window.__uepToastManager?.info('旅程之書甦醒了，加入了你的浮島。');
    setBookmarkGateOpen(false);
  }

  const crumbs = currentId
    ? (
        [
          ...(ancestorMap.get(currentId) || []),
          flatPages.find((page) => page.id === currentId),
        ].filter(Boolean) as PageTreeNode[]
      ).filter((page) => page.pageType !== 'page')
    : [];

  // Zone 分頁目錄（從 metadata.zoneTabs 讀取）
  const zoneTabsData = useMemo(() => {
    if (currentPage?.pageType !== 'zone' || !currentPage.metadata?.zoneTabs)
      return [] as { label: string; items: string[] }[];
    return currentPage.metadata.zoneTabs as {
      label: string;
      items: string[];
    }[];
  }, [currentPage]);
  const activeZoneTabIdx =
    zoneActiveTab !== null &&
    zoneActiveTab >= 0 &&
    zoneActiveTab < zoneTabsData.length
      ? zoneActiveTab
      : zoneTabsData.length > 0
        ? 0
        : -1;
  const zoneTabItems = useMemo(() => {
    if (activeZoneTabIdx < 0) return [] as PageTreeNode[];
    const tab = zoneTabsData[activeZoneTabIdx];
    return (tab?.items || [])
      .map((id: string) => flatPages.find((p) => p.id === id))
      .filter(Boolean) as PageTreeNode[];
  }, [activeZoneTabIdx, zoneTabsData, flatPages]);

  return (
    <ReaderShell zoneId="history" className="history-reader">
      {/* 入場動畫 — 墨韻暈染 */}
      <div
        aria-hidden="true"
        className={`hist-boot ${contentReady ? 'is-ready' : ''}`}
      >
        <div className="hist-boot-ink hist-boot-ink--1" />
        <div className="hist-boot-ink hist-boot-ink--2" />
        <div className="hist-boot-ink hist-boot-ink--3" />
        <div className="hist-boot-ink hist-boot-ink--4" />
        <div className="hist-boot-drip hist-boot-drip--1" />
        <div className="hist-boot-drip hist-boot-drip--2" />
        <div className="hist-boot-stroke" />
      </div>

      <div className="history-main">
        <ZoneAtmosphere zone={historyZone} intensity="subtle" />
        <div className="history-atmosphere" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => {
            // 每個字一個固定但不同的 peak opacity（0.18–0.32）
            const peak = 0.18 + ((index * 7 + 3) % 15) / 100;
            return (
              <span
                key={index}
                style={
                  {
                    left: `${(index * 47) % 100}%`,
                    top: `${(index * 31) % 100}%`,
                    animationDelay: `${(index * 0.7) % 12}s`,
                    animationDuration: `${22 + (index % 9)}s`,
                    '--peak': peak,
                  } as React.CSSProperties
                }
              >
                {['史', '錄', '門', '章', '頁'][index % 5]}
              </span>
            );
          })}
        </div>

        <aside className={`history-sidebar ${sidebarOpen ? '' : 'is-closed'}`}>
          <div className="history-sidebar-head">
            <div>
              <div className="history-kicker">Volume I · HISTORY</div>
              <button
                className="history-sidebar-title"
                type="button"
                onClick={returnToLanding}
              >
                歷史典藏庫
              </button>
            </div>
            <button
              className="history-icon-button"
              type="button"
              onClick={toggleSidebar}
              aria-label="收合目錄"
            >
              ×
            </button>
          </div>

          <label className="history-search">
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋章節、段落..."
            />
          </label>

          <nav className="history-tree" aria-label="歷史典藏庫目錄">
            {treeLoading && (
              <ZoneStateDisplay kind="loading" message="正在讀取目錄..." />
            )}
            {treeError && (
              <ZoneStateDisplay
                kind="error"
                message={`目錄讀取失敗：${treeError}`}
                onRetry={() => void fetchTree()}
              />
            )}
            {!treeLoading && !treeError && renderTree(tree)}
          </nav>
        </aside>

        {/* 手機端側邊欄打開時的背景模糊遮罩 */}
        {sidebarOpen && (
          <div
            className="history-sidebar-backdrop"
            onClick={toggleSidebar}
            aria-hidden="true"
          />
        )}

        {!sidebarOpen && (
          <button
            className="history-sidebar-peek"
            type="button"
            onClick={toggleSidebar}
          >
            目錄
          </button>
        )}

        {/* 滾動軸旁的「上次閱讀位置」標記——掛在 .history-main（不滾動）
            而非滾動容器內，top:% 對映可視高度，像滾動軸上的書籤不隨內容捲動 */}
        {scrollHint && (
          <button
            type="button"
            className={`history-scroll-marker${scrollHint.leaving ? ' is-leaving' : ''}`}
            style={{ top: `${scrollHint.pct}%` }}
            title="回到上次閱讀位置"
            onClick={() => {
              if (scrollHint.leaving) return;
              beginResumeJump();
              scrollRef.current?.scrollTo({
                top: scrollHint.targetTop,
                behavior: 'smooth',
              });
              if (currentId) clearSavedPosition(currentId);
              // 播放消失動畫後移除
              setScrollHint((prev) =>
                prev ? { ...prev, leaving: true } : null
              );
              setTimeout(() => setScrollHint(null), 350);
            }}
          >
            <span className="history-scroll-marker-line" />
            <span className="history-scroll-marker-label">上次位置 ▸</span>
          </button>
        )}

        {/* Visual Clue 側邊插卡（V-D，#6 重新設計）：掛在不滾動的
            .history-main，內縮至文章右側留白、連接線探向內文右緣；
            多 clue 折疊成一疊 hover 展開。島展開中才渲染（收合走
            dock chip 提示） */}
        {visualsIslandOpen && (
          <VisualClueBookmarks
            clues={visibleVisualClues}
            onClueClick={handleVisualClueClick}
          />
        )}

        <div className="history-content" ref={scrollRef}>
          <div key={transitionKey} className="history-page-transition">
            {bookmarkGateOpen ? (
              /* 遺落的書籤儀式頁（S6-2）：暫時佔據內容區，
                 完成或導航離開後回到原本的頁面 */
              <LostBookmarkGate onOpen={handleLostBookmarkOpen} />
            ) : !currentId ? (
              <section className="history-landing">
                <div className="history-landing-inner">
                  {homepageBlocks.length > 0 ? (
                    /* ── 資料驅動：按區塊順序渲染 ── */
                    homepageBlocks.map((block) => {
                      if (block.hidden) return null;
                      switch (block.type) {
                        case 'zone-header': {
                          const d = block.data as ZoneHeaderData;
                          return (
                            <div key={block.id}>
                              <div className="history-kicker">
                                History / Passage
                              </div>
                              <h2 className="history-zone-title">{d.title}</h2>
                              {d.subtitle && <p>{d.subtitle}</p>}
                            </div>
                          );
                        }
                        case 'uep-dialogue': {
                          const items = block.data as UepDialogueItem[];
                          return (
                            <div key={block.id} className="history-uep-note">
                              {items.map((d, i) => (
                                <UepDialogue
                                  key={i}
                                  text={d.text}
                                  side={d.side}
                                  effects={d.effects as any}
                                />
                              ))}
                            </div>
                          );
                        }
                        case 'archway-grid': {
                          const cards = (block.data as { cards: ArchwayCard[] })
                            .cards;
                          return (
                            <div key={block.id} className="history-arch-grid">
                              {archNodes.map((node, index) => {
                                const card = cards[index];
                                const isLocked = card && card.state !== 'open';
                                return (
                                  <button
                                    className={`history-arch-card ${isLocked ? 'is-locked' : ''}`}
                                    type="button"
                                    key={node.id}
                                    onClick={(e) => {
                                      if (isLocked) {
                                        // 紅光閃爍表示不可用
                                        const el = e.currentTarget;
                                        el.classList.add('is-denied');
                                        setTimeout(
                                          () =>
                                            el.classList.remove('is-denied'),
                                          600
                                        );
                                        return;
                                      }
                                      void loadPage(node);
                                    }}
                                    style={
                                      isLocked
                                        ? {
                                            filter: 'grayscale(1)',
                                            opacity: 0.55,
                                          }
                                        : undefined
                                    }
                                  >
                                    <span className="history-arch-index">
                                      {card?.tag ||
                                        ['U', 'E', 'P'][index] ||
                                        String(index + 1).padStart(2, '0')}
                                    </span>
                                    <span className="history-arch-title">
                                      {card?.name || node.title}
                                    </span>
                                    <span className="history-arch-meta">
                                      {card?.stateLabel ||
                                        `${node.children.length} entries / ${pageTypeLabel(node.pageType)}`}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        }
                        case 'hint-box': {
                          const text = (block.data as { text: string }).text;
                          return (
                            <div
                              key={block.id}
                              style={{
                                marginTop: 28,
                                padding: '14px 18px',
                                borderLeft: `3px solid ${historyZone.main}60`,
                                background: 'var(--bg-soft)',
                                fontFamily: 'var(--font-serif-tc)',
                                fontSize: 14,
                                color: 'var(--ink-soft)',
                                fontStyle: 'italic',
                                lineHeight: 1.8,
                              }}
                            >
                              {text}
                            </div>
                          );
                        }
                        case 'rich-text': {
                          const html = (block.data as { html: string }).html;
                          return (
                            <React.Fragment key={block.id}>
                              {renderHtmlWithUep(
                                html,
                                block.id,
                                'history-prose history-landing-prose'
                              )}
                            </React.Fragment>
                          );
                        }
                        default:
                          return null;
                      }
                    })
                  ) : treeError ? (
                    /* ── homepage 區塊未就緒：目錄讀取失敗時顯示錯誤 ── */
                    <div className="history-state">
                      目錄讀取失敗：{treeError}
                    </div>
                  ) : (
                    /* ── homepage 區塊載入中 ── */
                    <div className="history-state">正在讀取三向通道...</div>
                  )}
                </div>
              </section>
            ) : (
              <section className="history-reading">
                <ZoneBreadcrumb
                  segments={crumbs.map((crumb) => ({
                    label: crumb.title,
                    onClick: () => void loadPage(crumb),
                  }))}
                  color="var(--history-main)"
                  bordered
                />

                <article className="history-article">
                  {contentLoading && (
                    <ZoneStateDisplay
                      kind="loading"
                      message="正在讀取內容..."
                      large
                    />
                  )}
                  {contentError && (
                    <ZoneStateDisplay
                      kind="error"
                      message={`內容讀取失敗：${contentError}`}
                      onRetry={
                        currentId
                          ? () => {
                              const node = flatPages.find(
                                (page) => page.id === currentId
                              );
                              if (node) void loadPage(node);
                            }
                          : undefined
                      }
                      large
                    />
                  )}
                  {!contentLoading && !contentError && currentPage && (
                    <>
                      <header className="history-article-head">
                        <h2 className="history-article-title">
                          {renderIcon(
                            currentPage.metadata?.icon as string,
                            24,
                            'history-article-icon'
                          )}
                          {currentPage.title}
                        </h2>
                        {typeof currentPage.metadata?.description ===
                          'string' && <p>{currentPage.metadata.description}</p>}
                      </header>
                      <div
                        ref={contentRef}
                        onClick={onArticleClick}
                        onKeyDown={onArticleKeyDown}
                      >
                        {renderInteractiveHtml(
                          articleHtml ||
                            '<p class="empty-notice">這篇內容目前是空的。</p>',
                          progress,
                          'article',
                          'history-prose',
                          isEntityRefUnlocked
                        )}
                      </div>
                      {/* 掃描線文末哨兵：通過 = 讀完整篇 */}
                      <div
                        ref={scanSentinelRef}
                        className="history-scan-sentinel"
                        aria-hidden="true"
                      />
                      {/* Chapter 頁自動時間軸目錄（列出 arc 子項依進度狀態呈現）。
                          arc 頁本身已是故事段落層，section 目錄由左側 tree 處理，
                          不再重複注入目錄——2026-07-03 修 #12。 */}
                      {currentPage.pageType === 'chapter' &&
                        (() => {
                          const containerNode = pagesById.get(currentPage.id);
                          if (!containerNode) return null;
                          return (
                            <ChapterTimeline
                              containerNode={containerNode}
                              childType="arc"
                              progress={progress}
                              progressTree={progressTree}
                              resolvePageById={resolvePageById}
                              onNavigate={(child) =>
                                void loadPage(child as PageTreeNode)
                              }
                              currentId={currentId}
                            />
                          );
                        })()}
                    </>
                  )}
                </article>

                {/* Zone 分頁目錄（從 metadata 讀取） */}
                {zoneTabsData.length > 0 && (
                  <div className="history-zone-tabs">
                    <div className="history-zone-tabs-bar">
                      {zoneTabsData.map((tab, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`history-zone-tab ${activeZoneTabIdx === i ? 'active' : ''}`}
                          onClick={() => setZoneActiveTab(i)}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <div className="history-zone-tabs-body">
                      {zoneTabItems.length === 0 ? (
                        <div className="history-zone-tabs-empty">
                          此分頁下尚無內容
                        </div>
                      ) : (
                        <ul className="history-zone-tab-list">
                          {zoneTabItems
                            .filter(
                              (child) =>
                                !isProgressionChainHidden(
                                  child,
                                  progress,
                                  resolvePageById,
                                  child.id,
                                  progressTree
                                )
                            )
                            .map((child) => {
                              const childKind = getLockKind(
                                child,
                                progress,
                                child.id,
                                progressTree
                              );
                              const childLocked = childKind !== null;
                              return (
                                <li key={child.id}>
                                  <button
                                    type="button"
                                    className="history-zone-tab-link"
                                    style={
                                      childKind === 'static'
                                        ? {
                                            opacity: 0.45,
                                            cursor: 'not-allowed',
                                          }
                                        : childLocked
                                          ? { cursor: 'not-allowed' }
                                          : undefined
                                    }
                                    disabled={childLocked}
                                    onClick={() => void loadPage(child)}
                                  >
                                    {childLocked ? (
                                      <span className="history-zone-tab-link-icon">
                                        {childKind === 'static'
                                          ? '🔒'
                                          : childKind === 'progression'
                                            ? '◌'
                                            : '❖'}
                                      </span>
                                    ) : (
                                      renderIcon(
                                        child.metadata?.icon as string,
                                        14,
                                        'history-zone-tab-link-icon'
                                      ) || null
                                    )}
                                    {childKind === 'flag' ? (
                                      <span className="history-tree-title--veiled">
                                        ？？？
                                      </span>
                                    ) : (
                                      <span
                                        className={
                                          childKind === 'progression'
                                            ? 'history-tree-title--blurred'
                                            : undefined
                                        }
                                      >
                                        {child.title}
                                      </span>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                <ZonePrevNext
                  prev={
                    prevPage
                      ? {
                          title: prevPage.title,
                          onClick: () => void loadPage(prevPage),
                        }
                      : null
                  }
                  next={
                    nextPage
                      ? {
                          title: nextPage.title,
                          onClick: () => void loadPage(nextPage),
                        }
                      : null
                  }
                  accentColor="var(--history-main)"
                />
              </section>
            )}
          </div>
        </div>
      </div>
    </ReaderShell>
  );
}
