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

// Changelog item 類型定義（與 ChangelogEditorBody 一致）
interface LogItem {
  id: string;
  type: string;
  subject: string;
  text: string;
  state: string;
}
const LOG_ITEM_TYPES = [
  { id: 'zone', label: '區域', color: '#3A3A3A', shortLabel: 'ZN' },
  { id: 'ui', label: 'UI / UX', color: '#5E548E', shortLabel: 'UI' },
  { id: 'service', label: '系統 / 服務', color: '#355C7D', shortLabel: 'SVC' },
  { id: 'content', label: '內容 / 文本', color: '#6B3F2A', shortLabel: 'CN' },
  { id: 'misc', label: '雜項', color: '#888', shortLabel: 'MS' },
];
const LOG_STATE_COLORS: Record<string, string> = {
  ok: STO_GOLD,
  wip: '#c39c2d',
  risk: '#a85a2d',
  sealed: '#888',
};

interface ClearingDef {
  slug: string;
  label: string;
  labelEn: string;
  icon: string;
  style: 'dialogue' | 'log' | 'blog';
  intro: string;
  uepNote: string;
  motto: string;
  footerHint: string;
}

const CLEARINGS: ClearingDef[] = [
  {
    slug: 'boxes',
    label: '箱子堆成的遊樂場',
    labelEn: 'PLAYGROUND',
    icon: '◰',
    style: 'dialogue',
    intro: '從外面看起來頂多就只有四五十個箱子，沒想到一踏進入口卻是一整座完整的遊樂場。看起來在 U.E.P 的世界中甚麼都是可能的 —— 而且她有時候會在這裡晃，所以你也許可以撿到一段對話。',
    uepNote: "哈囉! 你來這裡找我了嗎? 雖然我也不知道我自己什麼時候會在這裡 (>'-'<)",
    motto: 'a playground for stray dialogues. — storage/boxes',
    footerHint: 'U.E.P 並不固定會在這裡。每一次踏入時遇到的場景也可能不同 —— 地鐵站、咖啡廳、海邊長椅都可能。',
  },
  {
    slug: 'changelog',
    label: '零散的紀錄',
    labelEn: 'CHANGELOG',
    icon: '☰',
    style: 'log',
    intro: '桌上的紙條都是某人的紀錄，感覺不像是 U.E.P 自己寫的。算是小小閱讀了一下，很多裡面記載的內容都跟這個世界的其他地區相關 —— 比起說是紀錄，這些文件更像是某種更新公告。',
    uepNote: '咦? 這些不是我寫的! 但我也看不出來是誰寫的 (・ω・ )...',
    motto: 'someone keeps leaving notes. — storage/changelog',
    footerHint: '黑色墨水是某種被刻意遮掉的文字。每一次回到這張桌前，又會有新的紀錄被擺上來。',
  },
  {
    slug: 'extras',
    label: '外界的言語',
    labelEn: 'EXTRAS',
    icon: '◐',
    style: 'blog',
    intro: '不只從一扇窗傳來 —— 這裡的每一處窗戶都可以聽到一種來自異域的空靈聲。冒著精神被汙染的風險，你靠近了那些聲音的源頭，並把聽到的句子一字一句記下來。這裡放的是這些字條的整理。',
    uepNote: '你可以靠近那扇窗看看! 不過如果聽到什麼會讓你不舒服的就趕快離開喔 (•́ω•̀ )ﾉ',
    motto: 'voices from outside the room. — storage/extras',
    footerHint: '這些字條的整理過程比較特別 —— 我會先把腦中模糊的想法 raw 倒下來，再用 LLM 幫忙看看自己到底在說什麼，最後組成一篇文章。',
  },
];

// ──────────────────────────────────────────────────────────────────
// 視窗 SVG（用於 extras 風格 clearing 的裝飾插圖）
// ──────────────────────────────────────────────────────────────────
function WindowSvg() {
  return (
    <svg viewBox="0 0 120 160" className="sto-window-svg">
      <defs>
        <linearGradient id="sto-winglow" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="rgba(213,182,24,0.45)" />
          <stop offset="55%" stopColor="rgba(213,182,24,0.10)" />
          <stop offset="100%" stopColor="rgba(213,182,24,0)" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="108" height="148" fill="none" stroke="var(--ink-soft)" strokeOpacity="0.6" />
      <rect x="14" y="14" width="92" height="132" fill="#0c0a08" />
      <rect x="14" y="14" width="92" height="132" fill="url(#sto-winglow)" />
      <line x1="60" y1="14" x2="60" y2="146" stroke="var(--ink-soft)" strokeOpacity="0.5" />
      <line x1="14" y1="80" x2="106" y2="80" stroke="var(--ink-soft)" strokeOpacity="0.5" />
      <circle cx="36" cy="44" r="1" fill="rgba(213,182,24,0.65)" />
      <circle cx="80" cy="110" r="1.3" fill="rgba(213,182,24,0.55)" />
      <circle cx="48" cy="100" r="0.8" fill="rgba(213,182,24,0.5)" />
      <circle cx="78" cy="58" r="0.9" fill="rgba(213,182,24,0.55)" />
      <rect x="2" y="146" width="116" height="10" fill="var(--bg-soft)" stroke="var(--ink-soft)" strokeOpacity="0.4" />
    </svg>
  );
}

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
  // Changelog reading state
  const [logFilterType, setLogFilterType] = useState<string>('all');
  const [logCollapsed, setLogCollapsed] = useState<Record<string, boolean>>({});

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
          <React.Fragment key={block.id}>
            {renderHtmlWithUep(html, block.id, 'sto-prose')}
          </React.Fragment>
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
    const clearingDef = CLEARINGS.find((c) => c.slug === activeClearingId);
    const entries = (cNode.children || [])
      .filter((c) => c.pageType === 'stuff' || c.pageType === 'subcategory')
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // D1 資料優先，靜態定義 fallback
    const clearingTitle = clearingPage?.title || clearingDef?.label || cNode.title;
    const clearingContentHtml = clearingPage?.content?.[0]?.content || '';
    const labelEn =
      typeof meta.labelEn === 'string' ? meta.labelEn
      : clearingDef?.labelEn || cNode.slug.toUpperCase();
    const clearingStyle =
      typeof meta.style === 'string' ? meta.style
      : clearingDef?.style || 'blog';
    const clearingIcon =
      typeof meta.icon === 'string' ? meta.icon : clearingDef?.icon || '';
    const clearingDesc =
      typeof meta.description === 'string' ? meta.description : '';

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
          <span className="sto-clearing-title-icon">{clearingIcon}</span>
          <h1 className="sto-clearing-title">{clearingTitle}</h1>
        </div>

        {/* 統計 */}
        <div className="sto-clearing-stats">
          {labelEn.toLowerCase()} ·{' '}
          {entries.filter((e) => e.metadata?.locked !== true).length}/
          {entries.length} entries
        </div>

        <div className="sto-gradient-line" />

        {/* 從 D1 載入的 clearing 介紹內容，若無則 fallback 到靜態定義 */}
        {clearingStyle === 'blog' && (
          <>
            <div className="sto-extras-intro-grid">
              <WindowSvg />
              {clearingContentHtml ? (
                <div className="sto-clearing-intro-text">{renderHtmlWithUep(clearingContentHtml, 'cl-intro', 'sto-prose')}</div>
              ) : (
                <p className="sto-clearing-intro-text">
                  {clearingDef?.intro || ''}
                </p>
              )}
            </div>
          </>
        )}

        {(clearingStyle === 'dialogue' || clearingStyle === 'log') && (
          <>
            {clearingContentHtml ? (
              <div className="sto-clearing-intro-text">{renderHtmlWithUep(clearingContentHtml, 'cl-intro-dl', 'sto-prose')}</div>
            ) : clearingDef?.intro ? (
              <p className="sto-clearing-intro-text">
                <span className="sto-drop-cap">{clearingDef.intro[0]}</span>
                {clearingDef.intro.slice(1)}
              </p>
            ) : null}
          </>
        )}

        {/* UEP 對話：D1 metadata 優先，靜態定義 fallback */}
        {(() => {
          const uepText =
            typeof meta.uepNote === 'string' ? meta.uepNote : clearingDef?.uepNote;
          return uepText ? (
            <div style={{ margin: '24px 0 8px' }}>
              <UepDialogue side="left" text={uepText} />
            </div>
          ) : null;
        })()}

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

        {/* 底部提示 */}
        {clearingDef?.footerHint && (
          <div className="sto-clearing-footer-hint">
            <span className="sto-footer-hint-icon">ⓘ</span>
            {clearingDef.footerHint}
          </div>
        )}
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
              {/* 標籤列表 */}
              {Array.isArray(entry.metadata?.tags) && (entry.metadata.tags as string[]).length > 0 && (
                <div className="sto-card-tags">
                  {(entry.metadata.tags as string[]).map((t, j) => (
                    <span key={j} className="sto-card-tag">{t}</span>
                  ))}
                </div>
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
                {/* 標籤列表 */}
                {Array.isArray(entry.metadata?.tags) && (entry.metadata.tags as string[]).length > 0 && (
                  <div className="sto-card-tags">
                    {(entry.metadata.tags as string[]).map((t, j) => (
                      <span key={j} className="sto-card-tag">{t}</span>
                    ))}
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
                {/* 標籤列表 */}
                {Array.isArray(entry.metadata?.tags) && (entry.metadata.tags as string[]).length > 0 && (
                  <div className="sto-card-tags">
                    {(entry.metadata.tags as string[]).map((t, j) => (
                      <span key={j} className="sto-card-tag">{t}</span>
                    ))}
                  </div>
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

        {(clearingStyle === 'log' || readingPage.content?.some((b) => b.type === 'log_items')) && renderLogReading(readingPage)}

        {clearingStyle === 'blog' && !readingPage.content?.some((b) => b.type === 'log_items') && (
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
            <div key={`${key}-${i}`} style={{
              margin: '8px 0',
              textAlign: (side || 'left') === 'right' ? 'right' : 'left',
            }}>
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
        case 'break': {
          sceneCount += 1;
          const breakLabel = el.getAttribute('data-label') || text || `場景 ${String(sceneCount).padStart(2, '0')}`;
          elements.push(
            <div key={`${key}-${i}`} className="sto-script-break">
              <span className="sto-script-break-line" />
              <span className="sto-script-break-label">· {breakLabel} ·</span>
              <span className="sto-script-break-line" />
            </div>
          );
          break;
        }
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

  // ── Changelog 結構化渲染 ──────────────────────────────────────
  function renderLogReading(page: Page) {
    // 從 content blocks 解析 log_items
    const itemsBlock = page.content?.find((b) => b.type === 'log_items');
    let logItems: LogItem[] = [];
    if (itemsBlock) {
      try {
        const arr = typeof itemsBlock.content === 'string'
          ? JSON.parse(itemsBlock.content)
          : itemsBlock.content;
        if (Array.isArray(arr)) logItems = arr;
      } catch { /* fallback 空陣列 */ }
    }

    // 如果沒有結構化資料，fallback 到富文本渲染
    if (logItems.length === 0) {
      return (
        <>
          <div className="sto-log-meta-grid">
            <div className="sto-log-meta-cell">
              <div className="sto-log-meta-label">version</div>
              <div className="sto-log-meta-value">
                {typeof page.metadata?.version === 'string' ? `v${page.metadata.version}` : '—'}
              </div>
            </div>
            <div className="sto-log-meta-cell">
              <div className="sto-log-meta-label">date</div>
              <div className="sto-log-meta-value">
                {typeof page.metadata?.date === 'string' ? page.metadata.date : '—'}
              </div>
            </div>
            <div className="sto-log-meta-cell">
              <div className="sto-log-meta-label">author</div>
              <div className="sto-log-meta-value">
                {typeof page.metadata?.author === 'string'
                  ? <span className="sto-log-meta-redact">{page.metadata.author}</span>
                  : '—'}
              </div>
            </div>
            <div className="sto-log-meta-cell">
              <div className="sto-log-meta-label">entries</div>
              <div className="sto-log-meta-value">
                {page.content?.length || 0}
              </div>
            </div>
          </div>
          <article className="sto-reading-body">
            {renderRichContent(page)}
          </article>
        </>
      );
    }

    // 結構化渲染
    const typeCounts: Record<string, number> = {};
    for (const it of logItems) {
      typeCounts[it.type] = (typeCounts[it.type] || 0) + 1;
    }
    const visibleTypes = LOG_ITEM_TYPES.filter((t) => typeCounts[t.id]);
    const filteredItems = logFilterType === 'all'
      ? logItems
      : logItems.filter((it) => it.type === logFilterType);

    // 按 type 分群
    const grouped: Record<string, LogItem[]> = {};
    for (const it of filteredItems) {
      if (!grouped[it.type]) grouped[it.type] = [];
      grouped[it.type].push(it);
    }

    let globalIdx = 0;

    return (
      <>
        {/* Metadata 面板 */}
        <div className="sto-log-meta-grid">
          <div className="sto-log-meta-cell">
            <div className="sto-log-meta-label">version</div>
            <div className="sto-log-meta-value">
              {typeof page.metadata?.version === 'string' ? `v${page.metadata.version}` : '—'}
            </div>
          </div>
          <div className="sto-log-meta-cell">
            <div className="sto-log-meta-label">date</div>
            <div className="sto-log-meta-value">
              {typeof page.metadata?.date === 'string' ? page.metadata.date : '—'}
            </div>
          </div>
          <div className="sto-log-meta-cell">
            <div className="sto-log-meta-label">author</div>
            <div className="sto-log-meta-value">
              {typeof page.metadata?.author === 'string'
                ? <span className="sto-log-meta-redact">{page.metadata.author}</span>
                : '—'}
            </div>
          </div>
          <div className="sto-log-meta-cell">
            <div className="sto-log-meta-label">entries</div>
            <div className="sto-log-meta-value">{logItems.length}</div>
          </div>
        </div>

        {/* 篩選列 */}
        <div className="sto-log-filter-bar">
          <div className="sto-log-filter-chips">
            <button
              className={`sto-log-filter-chip ${logFilterType === 'all' ? 'is-active' : ''}`}
              style={{ '--chip-color': STO_GOLD } as React.CSSProperties}
              onClick={() => setLogFilterType('all')}
            >
              全部
            </button>
            {visibleTypes.map((t) => (
              <button
                key={t.id}
                className={`sto-log-filter-chip ${logFilterType === t.id ? 'is-active' : ''}`}
                style={{ '--chip-color': t.color } as React.CSSProperties}
                onClick={() => setLogFilterType(t.id)}
              >
                <span className="sto-log-chip-square" style={{ background: t.color }}>
                  <span>{t.shortLabel}</span>
                </span>
                {t.label}
              </button>
            ))}
          </div>
          <span className="sto-log-filter-count">
            顯示 {filteredItems.length} / {logItems.length}
          </span>
        </div>

        {/* 分群顯示 */}
        <div className="sto-log-groups">
          {visibleTypes
            .filter((t) => grouped[t.id])
            .map((t) => {
              const items = grouped[t.id];
              const isCollapsed = logCollapsed[t.id] === true;
              return (
                <div key={t.id} className="sto-log-group">
                  <button
                    className="sto-log-group-header"
                    onClick={() =>
                      setLogCollapsed((prev) => ({
                        ...prev,
                        [t.id]: !prev[t.id],
                      }))
                    }
                  >
                    <span className="sto-log-group-chip" style={{ background: t.color }}>
                      {t.shortLabel}
                    </span>
                    <span className="sto-log-group-label">{t.label}</span>
                    <span className="sto-log-group-count">{items.length} 項</span>
                    <span
                      className="sto-log-group-arrow"
                      style={{
                        color: t.color,
                        transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0)',
                      }}
                    >
                      ▾
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="sto-log-group-items">
                      {items.map((item) => {
                        globalIdx++;
                        const stColor = LOG_STATE_COLORS[item.state] || '#888';
                        return (
                          <div key={item.id || globalIdx} className="sto-log-item">
                            <span className="sto-log-item-num">
                              {String(globalIdx).padStart(2, '0')}
                            </span>
                            <div className="sto-log-item-content">
                              <div className="sto-log-item-subject">{item.subject}</div>
                              <div className="sto-log-item-text">
                                {renderRedactedText(item.text)}
                              </div>
                            </div>
                            <span
                              className="sto-log-item-state"
                              style={{ color: stColor, borderColor: stColor }}
                            >
                              {item.state}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {/* EOF */}
        <div className="sto-log-eof">
          <span className="sto-log-eof-line" />
          <span className="sto-log-eof-label">· EOF ·</span>
          <span className="sto-log-eof-line" />
        </div>
      </>
    );
  }

  // 處理 ◼︎ 遮蔽文字
  function renderRedactedText(text: string) {
    if (!text) return null;
    const parts = text.split(/(◼︎+)/);
    return parts.map((part, i) =>
      part.startsWith('◼︎') ? (
        <span key={i} className="sto-redact">{part}</span>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      )
    );
  }

  // ── 富文本渲染（log / blog 共用）─────────────────────────────
  function renderRichContent(page: Page) {
    return (
      <div className="sto-blog-body">
        {page.content.map((block, i) => {
          // 跳過非 HTML 類型的 block（如 log_items JSON）
          if (block.type !== 'rich_text' && block.type !== 'paragraph') return null;
          // 偵測到 data-role 屬性時自動用結構化渲染
          if (block.content?.includes('data-role=')) {
            return renderStructuredHtml(block.content, i);
          }
          return renderHtmlWithUep(block.content, `rc-${i}`, 'sto-prose');
        })}
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
