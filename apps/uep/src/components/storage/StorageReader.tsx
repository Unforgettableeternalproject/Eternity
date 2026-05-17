import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ZONES } from '../../data/zones';
import BigMapModal from '../ui/BigMapModal';
import Minimap from '../ui/Minimap';
import PortalTransition from '../ui/PortalTransition';
import TopBar from '../ui/TopBar';
import IntroOverlay from '../ui/IntroOverlay';
import UepDialogue from '../ui/UepDialogue';
import ZoneAtmosphere from '../ui/ZoneAtmosphere';
import {
  type HomepageBlock,
  type ZoneHeaderData,
  type UepDialogueItem,
  type StorageRoomArea,
  fromContentBlock,
} from '../editor/homepage/types';
import './StorageReader.css';

// ──────────────────────────────────────────────────────────────────
// 型別
// ──────────────────────────────────────────────────────────────────
interface PageTreeNode {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  pageType: string;
  depth: number;
  status: string;
  metadata: Record<string, unknown>;
  children: PageTreeNode[];
}

interface Page {
  id: string;
  title: string;
  slug: string;
  content: { id: string; type: string; content: string; attrs?: Record<string, unknown> }[];
  metadata: Record<string, unknown>;
  pageType: string;
}

// ──────────────────────────────────────────────────────────────────
// 常數
// ──────────────────────────────────────────────────────────────────
const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

const STORAGE_ZONE = ZONES.find((z) => z.id === 'storage')!;
const STO_GOLD = '#D5B618';

// ──────────────────────────────────────────────────────────────────
// 主元件
// ──────────────────────────────────────────────────────────────────
export default function StorageReader() {
  // === UI 狀態 ===
  const [theme, setTheme] = useState(
    () =>
      (typeof localStorage !== 'undefined' &&
        localStorage.getItem('uep-theme')) ||
      'dark'
  );
  const [showMap, setShowMap] = useState(false);
  const [homePortal, setHomePortal] = useState(false);
  const [portalZone, setPortalZone] = useState<(typeof ZONES)[number] | null>(null);
  const [introZone, setIntroZone] = useState<(typeof ZONES)[number] | null>(null);

  // === 內容狀態 ===
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [homepageBlocks, setHomepageBlocks] = useState<HomepageBlock[]>([]);
  const [contentReady, setContentReady] = useState(false);
  const hpLoaded = useRef(false);
  const navPending = useRef(false);
  const bootFired = useRef(false);
  const bootMountTime = useRef(Date.now());
  function tryBootReady() {
    if (hpLoaded.current && !navPending.current && !bootFired.current) {
      bootFired.current = true;
      const elapsed = Date.now() - bootMountTime.current;
      const delay = Math.max(0, 1800 - elapsed);
      setTimeout(() => setContentReady(true), delay);
    }
  }

  // === 導航狀態 ===
  type View = 'landing' | 'clearing' | 'reading';
  const [view, setView] = useState<View>('landing');
  const [activeClearingId, setActiveClearingId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [clearingPage, setClearingPage] = useState<Page | null>(null);
  const [readingPage, setReadingPage] = useState<Page | null>(null);
  const [transitionKey, setTransitionKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // === 衍生資料 ===
  const clearingNodes = useMemo(() => {
    for (const node of tree) {
      if (node.pageType === 'homepage' && node.children) return node.children;
    }
    return tree.filter((n) => n.pageType === 'clearing');
  }, [tree]);

  const flatNodes = useMemo(() => {
    const acc: PageTreeNode[] = [];
    (function walk(nodes: PageTreeNode[]) {
      for (const n of nodes) {
        acc.push(n);
        walk(n.children || []);
      }
    })(tree);
    return acc;
  }, [tree]);

  const hpHeader = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'zone-header');
    return b ? (b.data as ZoneHeaderData) : null;
  }, [homepageBlocks]);
  const hpDialogues = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'uep-dialogue');
    return b ? (b.data as UepDialogueItem[]) : null;
  }, [homepageBlocks]);
  const hpRichTexts = useMemo(
    () =>
      homepageBlocks
        .filter((b) => b.type === 'rich-text')
        .map((b) => (b.data as { html: string }).html),
    [homepageBlocks]
  );

  // ── 初始化 ─────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    void fetchTree();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      hpLoaded.current = true;
      navPending.current = false;
      bootFired.current = true;
      setContentReady(true);
    }, 5000);
    fetch(`${API_BASE}/api/content/storage/homepage`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: any) => {
        if (!json?.ok || !json.data?.content) return;
        const raw =
          typeof json.data.content === 'string'
            ? JSON.parse(json.data.content)
            : json.data.content;
        if (Array.isArray(raw) && raw.length > 0)
          setHomepageBlocks(raw.map(fromContentBlock));
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        hpLoaded.current = true;
        tryBootReady();
      });
  }, []);

  useEffect(() => {
    if (treeLoading || !tree.length) return;
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page');
    const clearing = params.get('clearing');
    if (page) {
      navPending.current = true;
      navigateToPage(page, false);
    } else if (clearing) {
      navPending.current = true;
      navigateToClearing(clearing, false);
    } else tryBootReady();
  }, [treeLoading, tree]);

  useEffect(() => {
    function handler() {
      const params = new URLSearchParams(window.location.search);
      const page = params.get('page');
      const clearing = params.get('clearing');
      if (page) navigateToPage(page, false);
      else if (clearing) navigateToClearing(clearing, false);
      else navigateToLanding(false);
    }
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [tree]);

  // ── 資料載入 ───────────────────────────────────────────────────
  async function fetchTree() {
    setTreeLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/content/storage/tree`);
      const json = await res.json();
      if (json.ok && json.data) setTree(json.data as PageTreeNode[]);
    } catch {
      /* 靜默 */
    } finally {
      setTreeLoading(false);
    }
  }

  async function fetchPageData(slug: string): Promise<Page | null> {
    try {
      const res = await fetch(`${API_BASE}/api/content/storage/${slug}`);
      const json = await res.json();
      if (json.ok && json.data) {
        const page = json.data;
        return {
          ...page,
          content:
            typeof page.content === 'string'
              ? JSON.parse(page.content)
              : page.content || [],
        } as Page;
      }
    } catch {
      /* 靜默 */
    }
    return null;
  }

  // ── URL ────────────────────────────────────────────────────────
  function pushUrl(params: Record<string, string>) {
    const url = new URL(window.location.href);
    url.search = '';
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    window.history.pushState({}, '', url.toString());
  }

  // ── 導航 ───────────────────────────────────────────────────────
  function navigateToLanding(push = true) {
    setView('landing');
    setActiveClearingId(null);
    setActivePageId(null);
    setReadingPage(null);
    setClearingPage(null);
    if (push) {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.pushState({}, '', url.toString());
    }
    scrollRef.current?.scrollTo(0, 0);
    setTransitionKey((k) => k + 1);
  }

  async function navigateToClearing(clearingSlug: string, push = true) {
    setView('clearing');
    setActiveClearingId(clearingSlug);
    setActivePageId(null);
    setReadingPage(null);
    const page = await fetchPageData(clearingSlug);
    if (page) setClearingPage(page);
    if (push) pushUrl({ clearing: clearingSlug });
    scrollRef.current?.scrollTo(0, 0);
    setTransitionKey((k) => k + 1);
    if (navPending.current) {
      navPending.current = false;
      tryBootReady();
    }
  }

  async function navigateToPage(pageSlug: string, push = true) {
    setActivePageId(pageSlug);
    const page = await fetchPageData(pageSlug);
    if (page) {
      setReadingPage(page);
      setView('reading');
      const node = flatNodes.find((n) => n.slug === pageSlug);
      if (node) {
        const parent = flatNodes.find((n) =>
          n.children?.some((c) => c.id === node.id)
        );
        if (parent && parent.pageType === 'clearing') {
          setActiveClearingId(parent.slug);
        }
      }
    }
    if (push) pushUrl({ page: pageSlug });
    scrollRef.current?.scrollTo(0, 0);
    setTransitionKey((k) => k + 1);
    if (navPending.current) {
      navPending.current = false;
      tryBootReady();
    }
  }

  // ── 主題 ───────────────────────────────────────────────────────
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    if (typeof localStorage !== 'undefined')
      localStorage.setItem('uep-theme', next);
  }

  // ── 地圖 ──────────────────────────────────────────────────────
  function handlePickZone(zoneId: string) {
    setShowMap(false);
    if (zoneId === 'storage') return;
    const z = ZONES.find((zone) => zone.id === zoneId);
    if (z) setPortalZone(z);
  }

  // ══════════════════════════════════════════════════════════════════
  // Landing 首頁（block loop 渲染，與其他 zone 一致）
  // ══════════════════════════════════════════════════════════════════
  function renderHomepageBlock(block: HomepageBlock, idx: number) {
    switch (block.type) {
      case 'zone-header': {
        const d = block.data as ZoneHeaderData;
        return (
          <React.Fragment key={block.id}>
            <div className="sto-kicker">Volume V · STORAGE</div>
            <h1 className="sto-landing-title">{d.title || '某人的置物空間'}</h1>
            {d.subtitle && (
              <p className="sto-landing-subtitle">{d.subtitle}</p>
            )}
          </React.Fragment>
        );
      }
      case 'uep-dialogue': {
        const items = block.data as UepDialogueItem[];
        return (
          <div key={block.id} className="sto-landing-uep">
            {items.map((d, i) => (
              <UepDialogue
                key={i}
                text={d.text}
                side={d.side}
                effects={d.effects as never[]}
              />
            ))}
          </div>
        );
      }
      case 'rich-text': {
        const { html } = block.data as { html: string };
        return (
          <div
            key={block.id}
            className="sto-prose"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }
      case 'storage-room-map': {
        const { areas } = block.data as { areas: StorageRoomArea[] };
        const positions = [
          { gridArea: 'a', x: 25, y: 20 },
          { gridArea: 'b', x: 75, y: 20 },
          { gridArea: 'c', x: 50, y: 75 },
        ];
        return (
          <div key={block.id} className="sto-room-map">
            <div className="sto-room-map-label">
              <span className="sto-room-map-line" />
              <span>那麼，接下來去哪裡看看好呢</span>
              <span className="sto-room-map-line" />
            </div>

            <div className="sto-room-floor">
              {/* 連接線 SVG */}
              <svg className="sto-room-paths" viewBox="0 0 100 100" preserveAspectRatio="none">
                {areas.length >= 2 && (
                  <line x1={positions[0].x} y1={positions[0].y} x2={positions[1].x} y2={positions[1].y}
                    className="sto-room-path" />
                )}
                {areas.length >= 3 && (
                  <>
                    <line x1={positions[0].x} y1={positions[0].y} x2={positions[2].x} y2={positions[2].y}
                      className="sto-room-path" />
                    <line x1={positions[1].x} y1={positions[1].y} x2={positions[2].x} y2={positions[2].y}
                      className="sto-room-path" />
                  </>
                )}
                {/* 中心裝飾 */}
                <circle cx="50" cy="38" r="2" className="sto-room-center-dot" />
              </svg>

              {/* 節點 */}
              <div className="sto-room-nodes">
                {areas.map((area, i) => {
                  const pos = positions[i] || positions[0];
                  const cNode = clearingNodes.find((n) => n.slug === area.slug);
                  const stuffCount = cNode
                    ? (cNode.children || []).filter((c) => c.pageType === 'stuff').length
                    : 0;
                  const openCount = cNode
                    ? (cNode.children || []).filter(
                        (c) => c.pageType === 'stuff' && c.metadata?.locked !== true
                      ).length
                    : 0;
                  return (
                    <button
                      key={area.slug}
                      className="sto-room-node"
                      style={{ gridArea: pos.gridArea } as React.CSSProperties}
                      onClick={() => navigateToClearing(area.slug)}
                    >
                      <div className="sto-room-node-beacon" />
                      <div className="sto-room-node-icon">{area.icon}</div>
                      <div className="sto-room-node-name">{area.name}</div>
                      <div className="sto-room-node-label">{area.label}</div>
                      <div className="sto-room-node-hint">{area.hint}</div>
                      <div className="sto-room-node-count">{openCount}/{stuffCount}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  }

  function renderLanding() {
    return (
      <section className="sto-landing">
        <div className="sto-landing-inner">
          {homepageBlocks.map((block, i) => renderHomepageBlock(block, i))}
        </div>
      </section>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // Clearing 子頁面
  // ══════════════════════════════════════════════════════════════════
  function renderClearing() {
    const cNode = clearingNodes.find((n) => n.slug === activeClearingId);
    if (!cNode) return null;
    const meta = cNode.metadata || {};
    const entries = (cNode.children || [])
      .filter((c) => c.pageType === 'stuff' || c.pageType === 'subcategory')
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const clearingContentHtml = clearingPage?.content?.[0]?.content || '';
    const labelEn = typeof meta.labelEn === 'string' ? meta.labelEn : cNode.slug.toUpperCase();
    const clearingStyle = typeof meta.style === 'string' ? meta.style : 'blog';

    return (
      <div className="sto-clearing-page">
        {/* 麵包屑 */}
        <div className="sto-breadcrumb">
          <span className="sto-breadcrumb-line" />
          <button onClick={() => navigateToLanding()}>某人的置物空間</button>
          <span>·</span>
          <span>{labelEn}</span>
        </div>

        {/* 標題列 */}
        <div className="sto-clearing-title-row">
          <span className="sto-clearing-title-icon">
            {typeof meta.icon === 'string' ? meta.icon : ''}
          </span>
          <h1 className="sto-clearing-title">{cNode.title}</h1>
        </div>

        {/* 統計 */}
        <div className="sto-clearing-stats">
          {labelEn.toLowerCase()} ·{' '}
          {entries.filter((e) => e.metadata?.locked !== true).length}/
          {entries.length} entries
        </div>

        <div className="sto-gradient-line" />

        {/* 動態內容：若 clearing 有 content 則渲染，否則用 metadata 的 intro */}
        {clearingContentHtml ? (
          <div className="sto-prose" dangerouslySetInnerHTML={{ __html: clearingContentHtml }} />
        ) : typeof meta.intro === 'string' ? (
          <p className="sto-prose-p">{meta.intro}</p>
        ) : null}

        {typeof meta.uepNote === 'string' && (
          <div style={{ marginTop: 18 }}>
            <UepDialogue side="left" text={meta.uepNote} />
          </div>
        )}

        {/* 條目列表 — 根據 clearing style 用不同卡片 */}
        <div className="sto-entries-header">
          <span>
            · {clearingStyle === 'dialogue'
              ? '撿到的對話'
              : clearingStyle === 'log'
                ? '桌上的紙條 (時序由近至遠)'
                : '整理好的字條'} ·
          </span>
        </div>
        {clearingStyle === 'dialogue' && renderBoxesEntries(entries)}
        {clearingStyle === 'log' && renderLogEntries(entries)}
        {clearingStyle === 'blog' && renderExtrasEntries(entries)}
      </div>
    );
  }

  // ── Clearing 入口卡片：boxes（紙箱風格）───────────────────────────
  function renderBoxesEntries(entries: PageTreeNode[]) {
    return (
      <div className="sto-crate-grid">
        {entries.map((entry, i) => {
          const isLocked = entry.metadata?.locked === true;
          const tilt = [-1.3, 0.8, -0.6, 1.4][i % 4];
          return (
            <button
              key={entry.id}
              className={`sto-crate-card ${isLocked ? 'locked' : ''}`}
              style={{ transform: `rotate(${tilt}deg)` }}
              onClick={() => !isLocked && navigateToPage(entry.slug)}
              disabled={isLocked}
            >
              <div className="sto-crate-tape" style={{ top: -10, left: 24, transform: 'rotate(-2deg)' }} />
              {!isLocked && (
                <div className="sto-crate-label">EP · {String(i + 1).padStart(2, '0')}</div>
              )}
              <div className="sto-crate-date">
                {typeof entry.metadata?.date === 'string' ? entry.metadata.date : ''}
                {typeof entry.metadata?.scene === 'string' && ` · ${entry.metadata.scene}`}
              </div>
              <div className="sto-crate-title">{entry.title}</div>
              {typeof entry.metadata?.hint === 'string' && (
                <div className="sto-crate-hint">{entry.metadata.hint}</div>
              )}
              {isLocked && (
                <div style={{
                  marginTop: 12,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9.5,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase' as const,
                  opacity: 0.75,
                }}>· not yet · sealed ·</div>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // ── Clearing 入口卡片：changelog（信紙風格）────────────────────────
  function renderLogEntries(entries: PageTreeNode[]) {
    return (
      <div className="sto-lognote-list">
        {entries.map((entry) => {
          const isLocked = entry.metadata?.locked === true;
          return (
            <button
              key={entry.id}
              className={`sto-lognote-card ${isLocked ? 'locked' : ''}`}
              onClick={() => !isLocked && navigateToPage(entry.slug)}
              disabled={isLocked}
            >
              {!isLocked && (
                <>
                  <div className="sto-lognote-holes">
                    {[0, 1, 2, 3].map((j) => (
                      <span key={j} className="sto-lognote-hole" />
                    ))}
                  </div>
                  {typeof entry.metadata?.version === 'string' && (
                    <div className="sto-lognote-tab">v{entry.metadata.version}</div>
                  )}
                </>
              )}
              <div className="sto-lognote-body">
                <div className="sto-lognote-date">
                  {typeof entry.metadata?.date === 'string' ? entry.metadata.date : ''} · 觀測誌
                </div>
                <div className="sto-lognote-title">{entry.title}</div>
                {typeof entry.metadata?.author === 'string' && (
                  <div className="sto-lognote-author">
                    by <span className="sto-redact">{entry.metadata.author}</span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  // ── Clearing 入口卡片：extras（部落格風格）─────────────────────────
  function renderExtrasEntries(entries: PageTreeNode[]) {
    return (
      <div className="sto-extras-list">
        {entries.map((entry, i) => {
          const isLocked = entry.metadata?.locked === true;
          return (
            <button
              key={entry.id}
              className={`sto-extras-card ${isLocked ? 'locked' : ''}`}
              onClick={() => !isLocked && navigateToPage(entry.slug)}
              disabled={isLocked}
            >
              <div>
                <div className="sto-extras-num">#{String(i + 1).padStart(2, '0')}</div>
                <div className="sto-extras-date">
                  {typeof entry.metadata?.date === 'string' ? entry.metadata.date : ''}
                </div>
              </div>
              <div>
                <div className="sto-extras-meta-line">
                  · {typeof entry.metadata?.mood === 'string' ? entry.metadata.mood : 'unsorted'}
                  {typeof entry.metadata?.wordCount === 'number' && ` · ≈ ${entry.metadata.wordCount} 字`}
                </div>
                <div className="sto-extras-title">{entry.title}</div>
                {typeof entry.metadata?.hint === 'string' && (
                  <div className="sto-extras-hint">{entry.metadata.hint}</div>
                )}
              </div>
              {!isLocked && <span className="sto-extras-arrow">→</span>}
            </button>
          );
        })}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // Reading 閱讀頁
  // ══════════════════════════════════════════════════════════════════
  function renderReading() {
    if (!readingPage) return null;
    const cNode = clearingNodes.find((n) => n.slug === activeClearingId);
    const meta = cNode?.metadata || {};
    const labelEn = typeof meta.labelEn === 'string' ? meta.labelEn : activeClearingId?.toUpperCase() || '';
    const clearingStyle = typeof meta.style === 'string' ? meta.style : 'blog';

    return (
      <div className="sto-reading-page">
        {/* 麵包屑 */}
        <div className="sto-breadcrumb">
          <span className="sto-breadcrumb-line" />
          <button onClick={() => navigateToLanding()}>某人的置物空間</button>
          <span>·</span>
          <button onClick={() => activeClearingId && navigateToClearing(activeClearingId)}>
            {labelEn}
          </button>
          <span>·</span>
          <span>{readingPage.slug.split('/').pop()}</span>
        </div>

        {/* 標題 */}
        <h1 className="sto-reading-title">{readingPage.title}</h1>

        <div className="sto-gradient-line" />

        {/* 根據 clearing style 的專屬面板 + 內容渲染 */}
        {clearingStyle === 'dialogue' && (
          <>
            {(typeof readingPage.metadata?.scene === 'string' || typeof readingPage.metadata?.when === 'string') && (
              <div className="sto-script-cast-panel">
                <div>
                  <div className="sto-script-cast-label">scene</div>
                  <div className="sto-script-cast-value">
                    {typeof readingPage.metadata.scene === 'string' ? readingPage.metadata.scene : '—'}
                  </div>
                </div>
                <div>
                  <div className="sto-script-cast-label">cast</div>
                  <div className="sto-script-cast-value">
                    旁白 · 你 · <span style={{ color: STO_GOLD }}>U.E.P</span>
                  </div>
                </div>
              </div>
            )}
            <article className="sto-reading-body">
              {renderScriptContent(readingPage)}
            </article>
          </>
        )}

        {clearingStyle === 'log' && (
          <>
            <div className="sto-log-meta-grid">
              <div className="sto-log-meta-cell">
                <div className="sto-log-meta-label">version</div>
                <div className="sto-log-meta-value">
                  {typeof readingPage.metadata?.version === 'string' ? `v${readingPage.metadata.version}` : '—'}
                </div>
              </div>
              <div className="sto-log-meta-cell">
                <div className="sto-log-meta-label">date</div>
                <div className="sto-log-meta-value">
                  {typeof readingPage.metadata?.date === 'string' ? readingPage.metadata.date : '—'}
                </div>
              </div>
              <div className="sto-log-meta-cell">
                <div className="sto-log-meta-label">author</div>
                <div className="sto-log-meta-value">
                  {typeof readingPage.metadata?.author === 'string'
                    ? <span className="sto-log-meta-redact">{readingPage.metadata.author}</span>
                    : '—'}
                </div>
              </div>
              <div className="sto-log-meta-cell">
                <div className="sto-log-meta-label">entries</div>
                <div className="sto-log-meta-value">
                  {readingPage.content?.length || 0}
                </div>
              </div>
            </div>
            <article className="sto-reading-body">
              {renderRichContent(readingPage)}
            </article>
          </>
        )}

        {clearingStyle === 'blog' && (
          <>
            <div className="sto-blog-meta">
              {typeof readingPage.metadata?.date === 'string' && (
                <span className="sto-blog-meta-accent">· heard {readingPage.metadata.date}</span>
              )}
              {typeof readingPage.metadata?.wordCount === 'number' && (
                <>
                  <span>·</span>
                  <span>≈ {readingPage.metadata.wordCount} 字</span>
                </>
              )}
              {typeof readingPage.metadata?.mood === 'string' && (
                <>
                  <span>·</span>
                  <span style={{ textTransform: 'uppercase' as const }}>mood · {readingPage.metadata.mood}</span>
                </>
              )}
            </div>
            <article className="sto-reading-body">
              {renderRichContent(readingPage)}
            </article>
          </>
        )}
      </div>
    );
  }

  // ── 劇本式渲染 ────────────────────────────────────────────────
  function renderScriptContent(page: Page) {
    return (
      <div>
        {page.content.map((block, i) => {
          if (block.type === 'rich_text' || block.type === 'paragraph') {
            return renderStructuredHtml(block.content, i);
          }
          return (
            <div
              key={i}
              className="sto-prose"
              dangerouslySetInnerHTML={{ __html: block.content }}
            />
          );
        })}
      </div>
    );
  }

  function renderStructuredHtml(html: string, key: number) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const elements: React.ReactNode[] = [];
    let sceneCount = 1;

    doc.body.childNodes.forEach((node, i) => {
      if (node.nodeType !== 1) {
        if (node.textContent?.trim()) {
          elements.push(
            <p key={`${key}-${i}`} className="sto-script-narrator">{node.textContent}</p>
          );
        }
        return;
      }
      const el = node as HTMLElement;
      const role = el.getAttribute('data-role');
      const side = el.getAttribute('data-side') as 'left' | 'right' | null;
      const text = el.textContent || '';

      switch (role) {
        case 'narrator':
          elements.push(
            <p key={`${key}-${i}`} className="sto-script-narrator">{text}</p>
          );
          break;
        case 'uep':
          elements.push(
            <div key={`${key}-${i}`} style={{ margin: '8px 0' }}>
              <UepDialogue side={side || 'left'} text={text} />
            </div>
          );
          break;
        case 'you':
          elements.push(
            <div key={`${key}-${i}`} className="sto-script-you">
              <span className="sto-script-you-label">你</span>
              「{text}」
            </div>
          );
          break;
        case 'sfx':
          elements.push(
            <div key={`${key}-${i}`} className="sto-script-sfx">—— {text} ——</div>
          );
          break;
        case 'break':
          sceneCount += 1;
          elements.push(
            <div key={`${key}-${i}`} className="sto-script-break">
              <span className="sto-script-break-line" />
              <span className="sto-script-break-label">· 場景 {String(sceneCount).padStart(2, '0')} ·</span>
              <span className="sto-script-break-line" />
            </div>
          );
          break;
        default:
          elements.push(
            <div
              key={`${key}-${i}`}
              className="sto-prose"
              dangerouslySetInnerHTML={{ __html: el.outerHTML }}
            />
          );
      }
    });

    return <React.Fragment key={key}>{elements}</React.Fragment>;
  }

  // ── 富文本渲染（log / blog 共用）─────────────────────────────
  function renderRichContent(page: Page) {
    return (
      <div className="sto-blog-body">
        {page.content.map((block, i) => (
          <div
            key={i}
            className="sto-prose"
            dangerouslySetInnerHTML={{ __html: block.content }}
          />
        ))}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════
  return (
    <div className="storage-reader" data-theme={theme}>
      {/* 入場動畫 */}
      <div className={`sto-boot ${contentReady ? 'is-ready' : ''}`}>
        <div className="sto-boot-lamp" />
      </div>

      <TopBar
        dark={theme === 'dark'}
        onOpenMap={() => setShowMap(true)}
        onGoHome={() => {
          setHomePortal(true);
          setTimeout(() => { window.location.href = '/'; }, 1100);
        }}
      />

      <div className="sto-main">
        <ZoneAtmosphere zone={STORAGE_ZONE} />
        <div className="sto-content" ref={scrollRef}>
          <div key={transitionKey} className="sto-page-transition">
            {view === 'landing' && renderLanding()}
            {view === 'clearing' && renderClearing()}
            {view === 'reading' && renderReading()}
          </div>
        </div>
      </div>

      <Minimap
        zones={ZONES}
        currentId="storage"
        onExpand={() => setShowMap(true)}
        onPickZone={handlePickZone}
        position="bottom-left"
      />

      {showMap && (
        <BigMapModal
          zones={ZONES}
          onClose={() => setShowMap(false)}
          onPick={(zone) => {
            setShowMap(false);
            handlePickZone(zone.id);
          }}
          onCenterClick={() => {
            setShowMap(false);
            setHomePortal(true);
            setTimeout(() => { window.location.href = '/'; }, 1100);
          }}
        />
      )}

      {portalZone && (
        <PortalTransition
          zone={portalZone}
          onDone={() => { window.location.href = `/${portalZone.slug}`; }}
        />
      )}

      {homePortal && (
        <PortalTransition
          zone={null}
          onDone={() => { window.location.href = '/'; }}
          homeMode
        />
      )}

      {introZone && (
        <IntroOverlay
          zone={introZone}
          onClose={() => setIntroZone(null)}
          onEnter={() => setIntroZone(null)}
        />
      )}
    </div>
  );
}
