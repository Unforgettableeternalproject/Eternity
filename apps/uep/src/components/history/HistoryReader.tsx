/* global HTMLAnchorElement, PopStateEvent */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ZONES } from '../../data/zones';
import BigMapModal from '../ui/BigMapModal';
import Minimap from '../ui/Minimap';
import PortalTransition from '../ui/PortalTransition';
import TopBar from '../ui/TopBar';
import IntroOverlay from '../ui/IntroOverlay';
import UepDialogue from '../ui/UepDialogue';
import renderHtmlWithUep from '../ui/renderHtmlWithUep';
import ZoneAtmosphere from '../ui/ZoneAtmosphere';
import './HistoryReader.css';
import { renderIcon } from '../editor/IconLibrary';
import type {
  HomepageBlock,
  ZoneHeaderData,
  UepDialogueItem,
  ArchwayCard,
} from '../editor/homepage/types';
import { fromContentBlock } from '../editor/homepage/types';

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

const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

const HISTORY_ZONE = {
  main: '#6B3F2A',
  soft: '#C8A46A',
  tint: 'var(--history-tint)',
};

function isHidden(node: PageTreeNode) {
  return node.metadata?.hidden === true;
}

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

function renderLandingBlocks(blocks: ContentBlock[] | undefined) {
  const html = renderBlocks(blocks);
  if (!html) return '';

  return html.replace(
    /<h3><strong>告示板上分別寫著:<\/strong><\/h3>\s*<div class="card-grid">[\s\S]*?<\/div><\/div>/,
    '<div data-history-arch-slot="true"></div>'
  );
}

function splitLandingHtml(html: string) {
  const marker = '<div data-history-arch-slot="true"></div>';
  const index = html.indexOf(marker);
  if (index < 0) return { before: html, after: '' };
  return {
    before: html.slice(0, index),
    after: html.slice(index + marker.length),
  };
}

function findNodeInTree(
  nodes: PageTreeNode[],
  id: string
): PageTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeInTree(node.children || [], id);
    if (found) return found;
  }
  return null;
}

function resolveInternalLink(
  currentPageId: string,
  href: string,
  pages: PageTreeNode[]
) {
  let clean = href.replace(/\.md$/, '').replace(/\/$/, '');
  clean = clean.replace(/\/README$/, '').replace(/^\.?\//, '');

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
  const [theme, setTheme] = useState('dark');
  const [showMap, setShowMap] = useState(false);
  const [homePortal, setHomePortal] = useState(false);
  const [portalZone, setPortalZone] = useState<(typeof ZONES)[number] | null>(
    null
  );
  const [introZone, setIntroZone] = useState<(typeof ZONES)[number] | null>(
    null
  );
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<Page | null>(null);
  const [articleHtml, setArticleHtml] = useState('');
  const [landingPages, setLandingPages] = useState<Record<string, Page>>({});
  const [landingLoading, setLandingLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [transitionKey, setTransitionKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zoneActiveTab, setZoneActiveTab] = useState<number | null>(null);

  // 首頁區塊資料（從 D1 homepage 頁面載入）
  const [homepageBlocks, setHomepageBlocks] = useState<HomepageBlock[]>([]);
  const [contentReady, setContentReady] = useState(false);
  const bootMountTime = useRef(Date.now());

  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const flatPages = useMemo(() => flattenTree(tree, []), [tree]);
  const ancestorMap = useMemo(() => buildAncestorMap(tree), [tree]);
  const readablePages = useMemo(
    () => flatPages.filter((page) => page.pageType !== 'page'),
    [flatPages]
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
  const noteNode =
    pageLevelNodes.find((page) => page.id === 'history/note') || null;
  const passagePage = passageNode ? landingPages[passageNode.id] : null;
  const notePage = noteNode ? landingPages[noteNode.id] : null;
  const historyZone = ZONES.find((zone) => zone.id === 'history') || ZONES[0];
  const landingHtml = useMemo(
    () => (passagePage ? renderLandingBlocks(passagePage.content) : ''),
    [passagePage]
  );
  const landingParts = useMemo(
    () => splitLandingHtml(landingHtml),
    [landingHtml]
  );
  const archNodes = useMemo(
    () =>
      (passageNode?.children || [])
        .filter((node) => node.pageType === 'zone')
        .slice(0, 3),
    [passageNode]
  );

  useEffect(() => {
    const storedTheme =
      localStorage.getItem('uep-theme') ||
      document.documentElement.getAttribute('data-theme') ||
      'dark';
    setTheme(storedTheme);
    document.documentElement.setAttribute('data-theme', storedTheme);

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

  useEffect(() => {
    if (!tree.length || currentId) return;
    const params = new URLSearchParams(window.location.search);
    const pageId = params.get('page');
    const target = pageId
      ? readablePages.find((page) => page.id === pageId)
      : null;
    if (target) void loadPage(target);
  }, [tree, readablePages, currentId]);

  useEffect(() => {
    if (!pageLevelNodes.length) return;
    void fetchLandingPages(pageLevelNodes);
  }, [pageLevelNodes]);

  // 載入首頁區塊資料
  useEffect(() => {
    const timeout = setTimeout(() => setContentReady(true), 5000);
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
        clearTimeout(timeout);
        const elapsed = Date.now() - bootMountTime.current;
        const delay = Math.max(0, 1800 - elapsed);
        setTimeout(() => setContentReady(true), delay);
      });
  }, []);

  // 從首頁區塊中提取特定類型的資料
  const hpHeader = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'zone-header');
    return b ? (b.data as ZoneHeaderData) : null;
  }, [homepageBlocks]);

  const hpDialogues = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'uep-dialogue');
    return b ? (b.data as UepDialogueItem[]) : null;
  }, [homepageBlocks]);

  const hpArchCards = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'archway-grid');
    return b ? (b.data as { cards: ArchwayCard[] }).cards : null;
  }, [homepageBlocks]);

  const hpHintBox = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'hint-box');
    return b ? (b.data as { text: string }).text : null;
  }, [homepageBlocks]);

  const hpRichTexts = useMemo(() => {
    return homepageBlocks
      .filter((b) => b.type === 'rich-text')
      .map((b) => (b.data as { html: string }).html);
  }, [homepageBlocks]);

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

  async function fetchLandingPages(nodes: PageTreeNode[]) {
    setLandingLoading(true);
    try {
      const entries = await Promise.all(
        nodes.map(
          async (node) => [node.id, await fetchPageById(node.id)] as const
        )
      );
      setLandingPages(Object.fromEntries(entries));
    } catch (err) {
      console.error('Failed to load history landing pages:', err);
    } finally {
      setLandingLoading(false);
    }
  }

  async function loadPage(node: PageTreeNode, pushState = true) {
    if (node.pageType === 'page') {
      setCurrentId(null);
      setCurrentPage(null);
      setArticleHtml('');
      const url = new URL(window.location.href);
      url.searchParams.delete('page');
      window.history.pushState({}, '', url);
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      if (node.children.length) {
        setExpanded((prev) => new Set([...prev, node.id]));
      }
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
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

      if (pushState) {
        const url = new URL(window.location.href);
        url.searchParams.set('page', node.id);
        window.history.pushState({ pageId: node.id }, '', url);
      }
    } catch (err) {
      setContentError(err instanceof Error ? err.message : String(err));
    } finally {
      setContentLoading(false);
      setTransitionKey((k) => k + 1);
    }
  }

  useEffect(() => {
    function onPopState(event: PopStateEvent) {
      const pageId =
        event.state?.pageId ||
        new URLSearchParams(window.location.search).get('page');
      const target = readablePages.find((page) => page.id === pageId);
      if (target) void loadPage(target, false);
      else {
        setCurrentId(null);
        setCurrentPage(null);
        setArticleHtml('');
      }
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [readablePages]);

  function toggleSidebar() {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('history-sidebar', next ? 'open' : 'closed');
      return next;
    });
  }

  function onArticleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const navCard = target.closest<HTMLElement>('.content-card[data-nav-ref]');
    if (navCard) {
      const ref = navCard.dataset.navRef || '';
      const match = flatPages.find(
        (page) =>
          page.id.endsWith(`/${ref.replace(/\/$/, '')}`) ||
          page.slug.endsWith(`/${ref.replace(/\/$/, '')}`) ||
          page.slug === ref.replace(/\/$/, '')
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
      const target = flatPages.find((p) => p.id === pageId);
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

  function toggleNode(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function enterZoneFromMap(zoneId: string) {
    const target = ZONES.find((zone) => zone.id === zoneId);
    if (!target) return;
    setShowMap(false);
    if (target.id === 'history') return;

    setPortalZone(target);
    window.setTimeout(() => {
      window.location.href = `/${target.slug}`;
    }, 1100);
  }

  function showZoneIntro(zone: (typeof ZONES)[number]) {
    setShowMap(false);
    setIntroZone(zone);
  }

  function returnToLanding() {
    setCurrentId(null);
    setCurrentPage(null);
    setArticleHtml('');
    setTransitionKey((k) => k + 1);
    const url = new URL(window.location.href);
    url.searchParams.delete('page');
    window.history.pushState({}, '', url);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
        const children = (node.children || []).filter(
          (child) => !isHidden(child)
        );
        if (node.pageType === 'page' || node.pageType === 'homepage') {
          return renderTree(children, depth);
        }

        const hasChildren = children.length > 0;
        const isExpanded = expanded.has(node.id) || Boolean(query.trim());
        const isCurrent = node.id === currentId;
        const isLocked = node.metadata?.locked === true;

        return (
          <div className="history-tree-item" data-depth={depth} key={node.id}>
            <div className="history-tree-row">
              {hasChildren ? (
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
                  opacity: isLocked ? 0.45 : undefined,
                  cursor: isLocked ? 'not-allowed' : undefined,
                }}
                onClick={() => {
                  if (!isLocked) void loadPage(node);
                }}
                disabled={isLocked}
              >
                {isLocked ? (
                  <span className="history-tree-kind" style={{ opacity: 0.6 }}>
                    🔒
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
                <span className="history-tree-title">{node.title}</span>
              </button>
            </div>
            {hasChildren && isExpanded && (
              <div className="history-tree-children">
                {renderTree(children, depth + 1)}
              </div>
            )}
          </div>
        );
      });
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
    <div className="history-reader">
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
      <TopBar
        onOpenMap={() => setShowMap(true)}
        onGoHome={() => {
          setHomePortal(true);
          setTimeout(() => {
            window.location.href = '/';
          }, 1100);
        }}
        dark={theme === 'dark'}
      />

      <div className="history-main">
        <ZoneAtmosphere zone={historyZone} intensity="subtle" />
        <div className="history-atmosphere" aria-hidden="true">
          {Array.from({ length: 22 }, (_, index) => (
            <span
              key={index}
              style={{
                left: `${(index * 47) % 100}%`,
                top: `${(index * 31) % 100}%`,
                animationDelay: `${(index * 0.45) % 8}s`,
                animationDuration: `${14 + (index % 7)}s`,
              }}
            >
              {['史', '錄', '門', '章', '頁'][index % 5]}
            </span>
          ))}
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
              <div className="history-state">正在讀取目錄...</div>
            )}
            {treeError && (
              <div className="history-state history-state-error">
                <span>目錄讀取失敗：{treeError}</span>
                <button type="button" onClick={() => void fetchTree()}>
                  重試
                </button>
              </div>
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

        <div className="history-content" ref={scrollRef}>
          <div key={transitionKey} className="history-page-transition">
            {!currentId ? (
              <section className="history-landing">
                <div className="history-landing-inner">
                  {homepageBlocks.length > 0 ? (
                    /* ── 資料驅動：按區塊順序渲染 ── */
                    homepageBlocks.map((block) => {
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
                              {renderHtmlWithUep(html, block.id, 'history-prose history-landing-prose')}
                            </React.Fragment>
                          );
                        }
                        default:
                          return null;
                      }
                    })
                  ) : (
                    /* ── Fallback：舊版固定佈局 ── */
                    <>
                      <div className="history-kicker">History / Passage</div>
                      <h2>
                        {passagePage?.title || passageNode?.title || '三向通道'}
                      </h2>
                      {(treeLoading || landingLoading) && !passagePage && (
                        <div className="history-state">正在讀取三向通道...</div>
                      )}
                      {landingParts.before && (
                        <>
                          {renderHtmlWithUep(landingParts.before, 'landing-before', 'history-prose history-landing-prose')}
                        </>
                      )}
                      <div className="history-arch-grid">
                        {archNodes.map((node, index) => (
                          <button
                            className="history-arch-card"
                            type="button"
                            key={node.id}
                            onClick={() => void loadPage(node)}
                          >
                            <span className="history-arch-index">
                              {['U', 'E', 'P'][index] ||
                                String(index + 1).padStart(2, '0')}
                            </span>
                            <span className="history-arch-title">
                              {node.title}
                            </span>
                            <span className="history-arch-meta">
                              {node.children.length} entries /{' '}
                              {pageTypeLabel(node.pageType)}
                            </span>
                          </button>
                        ))}
                      </div>
                      {landingParts.after && (
                        <>
                          {renderHtmlWithUep(landingParts.after, 'landing-after', 'history-prose history-landing-prose')}
                        </>
                      )}
                      <div className="history-uep-note">
                        <UepDialogue
                          text="這裡是歷史典藏庫的三向通道。選擇 U、E、P 其中一扇門，就會進入對應區段的閱讀頁。"
                          effects={['shimmer', 'halo']}
                        />
                      </div>
                      {notePage && (
                        <section className="history-note-section">
                          <div className="history-kicker">
                            Loose Note / Page
                          </div>
                          <h3>{notePage.title}</h3>
                          <>
                            {renderHtmlWithUep(renderBlocks(notePage.content), 'note-page', 'history-prose history-note-prose')}
                          </>
                        </section>
                      )}
                    </>
                  )}
                </div>
              </section>
            ) : (
              <section className="history-reading">
                <div className="history-breadcrumb">
                  <span className="history-breadcrumb-line" />
                  {crumbs.map((crumb, index) => (
                    <React.Fragment key={crumb.id}>
                      <button
                        type="button"
                        onClick={() => void loadPage(crumb)}
                      >
                        {crumb.title}
                      </button>
                      {index < crumbs.length - 1 && <span>·</span>}
                    </React.Fragment>
                  ))}
                </div>

                <article className="history-article">
                  {contentLoading && (
                    <div className="history-state history-state-large">
                      正在讀取內容...
                    </div>
                  )}
                  {contentError && (
                    <div className="history-state history-state-error history-state-large">
                      <span>內容讀取失敗：{contentError}</span>
                      {currentId && (
                        <button
                          type="button"
                          onClick={() => {
                            const node = flatPages.find(
                              (page) => page.id === currentId
                            );
                            if (node) void loadPage(node);
                          }}
                        >
                          重試
                        </button>
                      )}
                    </div>
                  )}
                  {!contentLoading && !contentError && currentPage && (
                    <>
                      <header className="history-article-head">
                        <div className="history-kicker">
                          {pageTypeLabel(currentPage.pageType)} /{' '}
                          {currentPage.slug}
                        </div>
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
                      >
                        {renderHtmlWithUep(
                          articleHtml || '<p class="empty-notice">這篇內容目前是空的。</p>',
                          'article',
                          'history-prose'
                        )}
                      </div>
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
                          {zoneTabItems.map((child) => (
                            <li key={child.id}>
                              <button
                                type="button"
                                className="history-zone-tab-link"
                                onClick={() => void loadPage(child)}
                              >
                                {renderIcon(
                                  child.metadata?.icon as string,
                                  14,
                                  'history-zone-tab-link-icon'
                                ) || null}
                                {child.title}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                <div className="history-page-nav">
                  <button
                    type="button"
                    disabled={!prevPage}
                    onClick={() => prevPage && void loadPage(prevPage)}
                  >
                    <span>PREV</span>
                    <strong>{prevPage?.title || '沒有上一篇'}</strong>
                  </button>
                  <button
                    type="button"
                    disabled={!nextPage}
                    onClick={() => nextPage && void loadPage(nextPage)}
                  >
                    <span>NEXT</span>
                    <strong>{nextPage?.title || '沒有下一篇'}</strong>
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      <Minimap
        zones={ZONES}
        currentId="history"
        onExpand={() => setShowMap(true)}
        onPickZone={enterZoneFromMap}
        position="bottom-left"
      />

      {showMap && (
        <BigMapModal
          zones={ZONES}
          onClose={() => setShowMap(false)}
          onPick={showZoneIntro}
          onCenterClick={() => {
            setShowMap(false);
            setHomePortal(true);
            setTimeout(() => {
              window.location.href = '/';
            }, 1100);
          }}
        />
      )}

      <IntroOverlay
        zone={introZone}
        onClose={() => setIntroZone(null)}
        onEnter={() => {
          if (!introZone) return;
          enterZoneFromMap(introZone.id);
          setIntroZone(null);
        }}
      />
      <PortalTransition zone={portalZone} onDone={() => setPortalZone(null)} />
      <PortalTransition
        zone={null}
        homeMode={homePortal}
        onDone={() => setHomePortal(false)}
      />
    </div>
  );
}
