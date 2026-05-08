/* global HTMLAnchorElement, PopStateEvent */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ZONES } from '../../data/zones';
import BigMapModal from '../ui/BigMapModal';
import Minimap from '../ui/Minimap';
import PortalTransition from '../ui/PortalTransition';
import TopBar from '../ui/TopBar';
import IntroOverlay from '../ui/IntroOverlay';
import UepDialogue from '../ui/UepDialogue';
import ZoneAtmosphere from '../ui/ZoneAtmosphere';
import { renderIcon } from '../editor/IconLibrary';

type PageStatus = 'synced' | 'modified' | 'local_only';
type PageType =
  | 'zone' | 'chapter' | 'arc' | 'section' | 'page'
  | 'cluster' | 'subcategory' | 'song';

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
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

    const storedSidebar = localStorage.getItem('history-sidebar');
    if (storedSidebar === 'closed') setSidebarOpen(false);

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
        if (node.pageType === 'page') {
          return renderTree(children, depth);
        }

        const hasChildren = children.length > 0;
        const isExpanded = expanded.has(node.id) || Boolean(query.trim());
        const isCurrent = node.id === currentId;

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
                style={{ paddingLeft: `${Math.min(depth, 5) * 10 + 8}px` }}
                onClick={() => void loadPage(node)}
              >
                {renderIcon(
                  node.metadata?.icon as string,
                  14,
                  'history-tree-icon'
                ) || (
                  <span className="history-tree-kind">
                    {pageTypeLabel(node.pageType)}
                  </span>
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

  return (
    <div className="history-reader">
      <style>{historyReaderCss}</style>

      <TopBar onOpenMap={() => setShowMap(true)} dark={theme === 'dark'} />

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
              <div className="history-kicker">Volume I / Archive</div>
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
          {!currentId ? (
            <section className="history-landing">
              <div className="history-landing-inner">
                <div className="history-kicker">History / Passage</div>
                <h2>
                  {passagePage?.title || passageNode?.title || '三向通道'}
                </h2>
                {(treeLoading || landingLoading) && !passagePage && (
                  <div className="history-state">正在讀取三向通道...</div>
                )}
                {landingParts.before && (
                  <div
                    className="history-prose history-landing-prose"
                    dangerouslySetInnerHTML={{ __html: landingParts.before }}
                  />
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
                      <span className="history-arch-title">{node.title}</span>
                      <span className="history-arch-meta">
                        {node.children.length} entries /{' '}
                        {pageTypeLabel(node.pageType)}
                      </span>
                    </button>
                  ))}
                </div>

                {landingParts.after && (
                  <div
                    className="history-prose history-landing-prose"
                    dangerouslySetInnerHTML={{ __html: landingParts.after }}
                  />
                )}

                <div className="history-uep-note">
                  <UepDialogue
                    text="這裡是歷史典藏庫的三向通道。選擇 U、E、P 其中一扇門，就會進入對應區段的閱讀頁。"
                    effects={['shimmer', 'halo']}
                  />
                </div>

                {notePage && (
                  <section className="history-note-section">
                    <div className="history-kicker">Loose Note / Page</div>
                    <h3>{notePage.title}</h3>
                    <div
                      className="history-prose history-note-prose"
                      dangerouslySetInnerHTML={{
                        __html: renderBlocks(notePage.content),
                      }}
                    />
                  </section>
                )}
              </div>
            </section>
          ) : (
            <section className="history-reading">
              <div className="history-breadcrumb">
                {crumbs.map((crumb, index) => (
                  <React.Fragment key={crumb.id}>
                    <button type="button" onClick={() => void loadPage(crumb)}>
                      {crumb.title}
                    </button>
                    {index < crumbs.length - 1 && <span>/</span>}
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
                      className="history-prose"
                      onClick={onArticleClick}
                      dangerouslySetInnerHTML={{
                        __html:
                          articleHtml ||
                          '<p class="empty-notice">這篇內容目前是空的。</p>',
                      }}
                    />
                  </>
                )}
              </article>

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
            window.location.href = '/';
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
    </div>
  );
}

const historyReaderCss = `
  .history-reader {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--ink);
    overflow: hidden;
  }

  .history-topbar {
    height: 65px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 36px;
    border-bottom: 1px solid var(--hairline);
    background: color-mix(in srgb, var(--bg) 94%, transparent);
    backdrop-filter: blur(16px);
    z-index: 20;
  }

  .history-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    color: inherit;
    text-decoration: none;
  }

  .history-brand-mark {
    width: 29px;
    height: 29px;
    display: grid;
    place-items: center;
    border: 1px solid var(--uep-gold);
    border-radius: 50%;
    color: var(--uep-gold);
    font-family: var(--font-display);
    font-weight: 600;
  }

  .history-brand-title,
  .history-brand-subtitle {
    display: block;
  }

  .history-brand-title {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    color: var(--ink-title);
    line-height: 1;
  }

  .history-brand-subtitle,
  .history-kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-mute);
  }

  .history-topbar-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .history-topbar-link,
  .history-outline-button {
    border: 1px solid var(--hairline-strong);
    background: transparent;
    color: var(--ink-soft);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 8px 12px;
    text-decoration: none;
    cursor: pointer;
  }

  .history-outline-button:hover,
  .history-topbar-link:hover {
    color: var(--uep-gold);
    border-color: var(--uep-gold);
  }

  .history-main {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
    overflow: hidden;
  }

  .history-atmosphere {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .history-atmosphere::before,
  .history-atmosphere::after {
    content: "";
    position: absolute;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, ${HISTORY_ZONE.main} 22%, transparent);
  }

  .history-atmosphere::before {
    width: 80vw;
    height: 80vw;
    left: -35vw;
    top: -42vw;
  }

  .history-atmosphere::after {
    width: 62vw;
    height: 62vw;
    right: -30vw;
    bottom: -36vw;
    border-style: dashed;
  }

  .history-atmosphere span {
    position: absolute;
    font-family: var(--font-display);
    font-size: 18px;
    color: ${HISTORY_ZONE.main};
    opacity: 0;
    animation: history-drift linear infinite;
  }

  @keyframes history-drift {
    0% { opacity: 0; transform: translate3d(0, 0, 0); }
    12% { opacity: 0.18; }
    88% { opacity: 0.18; }
    100% { opacity: 0; transform: translate3d(8px, -70px, 0); }
  }

  .history-sidebar {
    width: 272px;
    flex: 0 0 272px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line);
    background: var(--bg-soft);
    z-index: 2;
    transition: margin-left .25s var(--ease), opacity .2s var(--ease);
  }

  .history-sidebar.is-closed {
    margin-left: -272px;
    opacity: 0;
    pointer-events: none;
  }

  .history-sidebar-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 22px 18px 16px;
    border-bottom: 1px solid var(--line);
  }

  .history-sidebar-title {
    margin: 5px 0 0;
    padding: 0;
    border: 0;
    background: transparent;
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 600;
    color: var(--ink-title);
    line-height: 1.15;
    cursor: pointer;
    text-align: left;
  }

  .history-sidebar-title:hover {
    color: ${HISTORY_ZONE.main};
  }

  .history-icon-button {
    width: 28px;
    height: 28px;
    border: 1px solid var(--line-strong);
    background: var(--bg-card);
    color: var(--ink-soft);
    cursor: pointer;
  }

  .history-search {
    display: block;
    padding: 14px 14px 12px;
    border-bottom: 1px solid var(--line);
  }

  .history-search span {
    display: block;
    margin-bottom: 7px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: ${HISTORY_ZONE.main};
  }

  .history-search input {
    width: 100%;
    border: 1px solid var(--line);
    background: var(--bg-card);
    color: var(--ink);
    padding: 10px 11px;
    font: 13px var(--font-sans);
    outline: none;
  }

  .history-search input:focus {
    border-color: ${HISTORY_ZONE.soft};
  }

  .history-tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 0 18px;
  }

  .history-tree-row {
    display: flex;
    align-items: stretch;
  }

  .history-tree-chevron,
  .history-tree-spacer {
    width: 28px;
    flex: 0 0 28px;
    border: 0;
    background: transparent;
    color: var(--ink-mute);
    font-family: var(--font-mono);
    cursor: pointer;
  }

  .history-tree-link {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    border: 0;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--ink-soft);
    padding: 7px 10px 7px 8px;
    text-align: left;
    cursor: pointer;
  }

  .history-tree-link:hover,
  .history-tree-link.is-current {
    background: var(--history-tint);
    color: var(--ink-title);
    border-left-color: ${HISTORY_ZONE.main};
  }

  .history-tree-kind {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    color: ${HISTORY_ZONE.main};
  }

  .history-tree-icon {
    color: ${HISTORY_ZONE.main};
    flex-shrink: 0;
    opacity: 0.75;
  }

  .history-tree-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-serif-tc);
    font-size: 13px;
  }

  .history-tree-children {
    border-left: 1px solid var(--line);
    margin-left: 14px;
  }

  .history-sidebar-peek {
    position: absolute;
    left: 0;
    top: 96px;
    z-index: 5;
    border: 1px solid var(--line-strong);
    border-left: 0;
    background: var(--bg-card);
    color: ${HISTORY_ZONE.main};
    padding: 10px 8px;
    writing-mode: vertical-rl;
    letter-spacing: 0.14em;
    cursor: pointer;
  }

  .history-content {
    flex: 1;
    min-width: 0;
    overflow: auto;
    position: relative;
    z-index: 1;
  }

  .history-landing,
  .history-reading {
    min-height: 100%;
    padding: 48px 56px 72px;
  }

  .history-landing-inner {
    max-width: 920px;
    margin: 0 auto;
  }

  .history-landing h2,
  .history-article-head h2 {
    margin: 10px 0 0;
    font-family: var(--font-display);
    font-size: 58px;
    font-weight: 500;
    line-height: 1.05;
    color: var(--ink-title);
  }

  .history-article-title {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .history-article-icon {
    color: ${HISTORY_ZONE.main};
    flex-shrink: 0;
    opacity: 0.7;
  }

  .history-landing p,
  .history-article-head p {
    max-width: 620px;
    margin: 22px 0 0;
    font-family: var(--font-serif-tc);
    font-size: 16px;
    line-height: 1.9;
    color: var(--ink-soft);
    font-style: italic;
  }

  .history-landing-prose {
    max-width: 680px;
    margin-top: 28px;
  }

  .history-landing-prose h1 {
    display: none;
  }

  .history-landing-prose table[data-view="cards"] {
    display: none;
  }

  .history-landing-prose .card-grid {
    display: none;
  }

  .history-uep-note {
    margin-top: 34px;
  }

  .history-arch-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 22px;
    margin-top: 44px;
  }

  .history-arch-card {
    min-height: 330px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 9px;
    border: 1px solid color-mix(in srgb, ${HISTORY_ZONE.main} 74%, var(--line));
    border-radius: 150px 150px 4px 4px;
    background: color-mix(in srgb, ${HISTORY_ZONE.main} 5%, transparent);
    color: inherit;
    padding: 28px 20px;
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }

  .history-arch-card::before {
    content: "";
    position: absolute;
    top: 28px;
    left: 50%;
    width: 36px;
    height: 1px;
    transform: translateX(-50%);
    background: ${HISTORY_ZONE.main};
    opacity: .55;
  }

  .history-arch-card:hover {
    background: var(--history-tint);
  }

  .history-arch-index {
    font-family: var(--font-display);
    font-size: 46px;
    color: ${HISTORY_ZONE.main};
    font-style: italic;
    line-height: 1;
  }

  .history-arch-title {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 600;
    color: var(--ink-title);
  }

  .history-arch-meta {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-mute);
  }

  .history-note-section {
    margin-top: 54px;
    padding: 28px 30px;
    max-width: 720px;
    background: linear-gradient(180deg, #FBE782 0%, #F5D960 100%);
    color: #3a2f08;
    box-shadow: 0 10px 28px rgba(0,0,0,.18);
    transform: rotate(-0.6deg);
    position: relative;
  }

  .history-note-section::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    width: 0;
    height: 0;
    border-top: 30px solid #d4b94a;
    border-left: 30px solid transparent;
  }

  .history-note-section .history-kicker,
  .history-note-section h3,
  .history-note-section .history-prose,
  .history-note-section .history-prose h1,
  .history-note-section .history-prose h2,
  .history-note-section .history-prose h3,
  .history-note-section .history-prose p,
  .history-note-section .history-prose td,
  .history-note-section .history-prose th {
    color: #3a2f08;
  }

  .history-note-section h3 {
    margin: 8px 0 18px;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 600;
  }

  .history-note-prose {
    font-size: 15px;
    line-height: 1.9;
  }

  .history-note-prose h1 {
    display: none;
  }

  .history-note-prose table {
    background: rgba(255,255,255,.24);
  }

  .history-reading {
    max-width: 940px;
    margin: 0 auto;
  }

  .history-breadcrumb {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
    padding-bottom: 14px;
    margin-bottom: 28px;
    border-bottom: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-mute);
  }

  .history-breadcrumb button {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    cursor: pointer;
  }

  .history-breadcrumb button:hover {
    color: ${HISTORY_ZONE.main};
  }

  .history-article {
    min-height: 280px;
  }

  .history-article-head {
    padding-bottom: 28px;
    margin-bottom: 28px;
    border-bottom: 1px solid var(--line);
  }

  .history-article-head h2 {
    font-size: 42px;
  }

  .history-prose {
    font-family: var(--font-serif-tc);
    font-size: 17px;
    line-height: 2.08;
    color: var(--ink);
  }

  .history-prose p {
    margin: 0 0 1.3em;
  }

  .history-prose h1,
  .history-prose h2,
  .history-prose h3 {
    color: var(--ink-title);
    line-height: 1.35;
  }

  .history-prose h1 {
    font-family: var(--font-display);
    font-size: 34px;
    margin: 2.2em 0 .75em;
  }

  .history-prose h2 {
    font-family: var(--font-display);
    font-size: 28px;
    margin: 2em 0 .7em;
    scroll-margin-top: 24px;
  }

  .history-prose h3 {
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${HISTORY_ZONE.main};
    margin: 2em 0 .65em;
    scroll-margin-top: 24px;
  }

  .history-prose blockquote {
    margin: 28px 0;
    padding: 4px 0 4px 18px;
    border-left: 3px solid ${HISTORY_ZONE.main};
    color: ${HISTORY_ZONE.main};
    font-family: var(--font-display);
    font-style: italic;
    font-size: 19px;
    line-height: 1.65;
  }

  .history-prose a {
    color: ${HISTORY_ZONE.soft};
    text-decoration-color: color-mix(in srgb, ${HISTORY_ZONE.soft} 52%, transparent);
  }

  .history-prose hr {
    border: 0;
    height: 1px;
    margin: 38px 0;
    background: linear-gradient(90deg, transparent, ${HISTORY_ZONE.main}, transparent);
    opacity: .55;
  }

  .history-prose img {
    max-width: 100%;
    height: auto;
    margin: 24px auto;
  }

  .history-prose pre {
    overflow: auto;
    padding: 16px;
    background: var(--bg-sunken);
    border: 1px solid var(--line);
  }

  .history-prose code {
    font-family: var(--font-mono);
    font-size: .9em;
  }

  .history-prose table {
    width: 100%;
    border-collapse: collapse;
    margin: 24px 0;
    font-size: 14px;
  }

  .history-prose th,
  .history-prose td {
    border-bottom: 1px solid var(--line);
    padding: 9px 10px;
    text-align: left;
  }

  .history-prose th {
    color: ${HISTORY_ZONE.main};
    background: var(--history-tint);
  }

  .history-prose .hint,
  .history-prose .tabs-container,
  .history-prose .content-card {
    border: 1px solid var(--line);
    background: var(--bg-card);
  }

  .history-prose .hint {
    padding: 14px 16px;
    margin: 20px 0;
  }

  .history-prose .tabs-header {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--line);
  }

  .history-prose .tab-btn {
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--ink-soft);
    padding: 10px 14px;
    cursor: pointer;
  }

  .history-prose .tab-btn.active {
    color: ${HISTORY_ZONE.main};
    border-bottom-color: ${HISTORY_ZONE.main};
  }

  .history-prose .tabs-body {
    padding: 16px;
  }

  .history-prose .tab-panel {
    display: none;
  }

  .history-prose .tab-panel:first-child {
    display: block;
  }

  .history-page-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    margin-top: 54px;
    padding-top: 22px;
    border-top: 1px solid var(--line);
  }

  .history-page-nav button {
    min-width: 0;
    border: 1px solid var(--line);
    background: var(--bg-card);
    color: var(--ink-soft);
    padding: 16px;
    text-align: left;
    cursor: pointer;
  }

  .history-page-nav button:last-child {
    text-align: right;
  }

  .history-page-nav button:disabled {
    opacity: .35;
    cursor: not-allowed;
  }

  .history-page-nav span {
    display: block;
    margin-bottom: 5px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: .16em;
    color: ${HISTORY_ZONE.main};
  }

  .history-page-nav strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-serif-tc);
    font-size: 14px;
    color: var(--ink-title);
  }

  .history-state {
    display: block;
    padding: 18px;
    color: var(--ink-mute);
    font-family: var(--font-serif-tc);
    font-size: 13px;
    line-height: 1.6;
  }

  .history-state-error {
    color: #b86060;
  }

  .history-state button {
    display: block;
    margin-top: 10px;
    border: 1px solid var(--line-strong);
    background: var(--bg-card);
    color: var(--ink);
    padding: 6px 10px;
    cursor: pointer;
  }

  .history-state-large {
    min-height: 260px;
    display: grid;
    place-items: center;
    text-align: center;
  }

  .empty-notice {
    color: var(--ink-mute);
    font-style: italic;
  }

  @media (max-width: 760px) {
    .history-topbar {
      padding: 0 16px;
    }

    .history-topbar-link {
      display: none;
    }

    .history-sidebar {
      position: absolute;
      inset: 0 auto 0 0;
      box-shadow: 18px 0 42px rgba(0,0,0,.24);
    }

    .history-landing,
    .history-reading {
      padding: 32px 20px 56px;
    }

    .history-landing h2 {
      font-size: 42px;
    }

    .history-article-head h2 {
      font-size: 32px;
    }

    .history-arch-grid,
    .history-page-nav {
      grid-template-columns: 1fr;
    }

    .history-arch-card {
      min-height: 220px;
    }
  }
`;
