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
  fromContentBlock,
} from '../editor/homepage/types';
import './ConceptsReader.css';

// ──────────────────────────────────────────────────────────────────
// 型別定義
// ──────────────────────────────────────────────────────────────────
type PageStatus = 'synced' | 'modified' | 'local_only';
type ConceptsPageType =
  | 'stack'
  | 'type'
  | 'subcategory'
  | 'context'
  | 'homepage'
  | 'page';

interface PageTreeNode {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  pageType: ConceptsPageType;
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
  content: { id: string; type: string; content: string }[];
  metadata: Record<string, unknown>;
  parentId: string | null;
  depth: number;
  pageType: ConceptsPageType;
  status: PageStatus;
  updatedAt: string;
}

interface StackDef {
  id: string;
  slug: string;
  label: string;
  labelEn: string;
  icon: string;
  intro: string;
  uepNote: string;
  style: 'dossier' | 'browser' | 'chrono' | 'diff';
}

interface TerminalModule {
  id: string;
  name: string;
  en: string;
  state: 'sync' | 'idle';
  records: number;
}

// ──────────────────────────────────────────────────────────────────
// 常數
// ──────────────────────────────────────────────────────────────────
const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

const CONC_MAIN = '#2D6A4F';
const CONC_SOFT = '#74C69D';

const CONCEPTS_ZONE = ZONES.find((z) => z.id === 'concepts')!;

// 四個 Stack 的硬編碼定義
const STACKS: StackDef[] = [
  {
    id: 'server/records',
    slug: 'server/records',
    label: '永續紀錄主機',
    labelEn: 'PERSISTENT_LOG_SERVER',
    icon: 'Σ',
    intro:
      '一台不會中斷運作的大型電腦，連接著後方的印表機，不知道都在記錄些甚麼呢？這裡保存著所有關於世界基礎設定的資料——角色列表、地區條列、魔獸紀錄，以及各式理論體系。',
    uepNote:
      '這台印表機的紀錄永遠不會停止喔！因為有新的冒險就會有新的東西需要被記錄下來~ (๑•̀ᗝ•́)و',
    style: 'dossier',
  },
  {
    id: 'server/browser',
    slug: 'server/browser',
    label: '個性瀏覽器',
    labelEn: 'IDENTITY_BROWSER',
    icon: 'Φ',
    intro:
      '很多全息投影的視窗在移動著，每一個都正動態地顯示著各種人物的資訊。這裡是角色的深度分析模組——記錄著他們的背景故事、人際關係、以及隱藏的秘密。',
    uepNote:
      '每個人都有屬於自己的祕密呢，不過透過這些視窗你可以稍微看到一些~ (≧▽≦)',
    style: 'browser',
  },
  {
    id: 'server/time_logs',
    slug: 'server/time_logs',
    label: '原質震盪時鐘',
    labelEn: 'ESSENCE_OSCILLATOR',
    icon: '⟳',
    intro:
      '從遠處就能聽到的鐘擺聲，其真身是一座巨大的電子時鐘。時間軸上的每一個刻度都記載著某個重要的事件，從創世到終結，一切都被精確地標記著。',
    uepNote:
      '時間是很有趣的東西呢！它看起來是直線的，但實際上...嘻嘻，你會慢慢知道的~ ✧',
    style: 'chrono',
  },
  {
    id: 'server/translation',
    slug: 'server/translation',
    label: '認知對照平台',
    labelEn: 'COGNITION_COMPARE',
    icon: '⇌',
    intro:
      '在這面大鏡子的前方有一座漂浮著的平台。各種名詞、術語和概念在這裡被翻譯成不同的語言，讓來自不同世界的觀察者都能理解。',
    uepNote:
      '名字是很重要的喔！同一個人可能在不同地方有不同的稱呼呢~ ( •̀ᴗ•́ )/',
    style: 'diff',
  },
];

// 本質符號——飄移粒子
const ESSENCE_SYMBOLS = [
  'Σ', '∑', '∮', '∇', '∂', 'Φ', 'Ψ', 'Ω', 'λ', 'δ', 'ε', 'θ',
];

// ──────────────────────────────────────────────────────────────────
// 主元件
// ──────────────────────────────────────────────────────────────────
export default function ConceptsReader() {
  // === 共用 UI 狀態 ===
  const [theme, setTheme] = useState(
    () =>
      (typeof localStorage !== 'undefined' &&
        localStorage.getItem('uep-theme')) ||
      'dark'
  );
  const [showMap, setShowMap] = useState(false);
  const [homePortal, setHomePortal] = useState(false);
  const [portalZone, setPortalZone] = useState<(typeof ZONES)[number] | null>(
    null
  );
  const [introZone, setIntroZone] = useState<(typeof ZONES)[number] | null>(
    null
  );

  // === 內容狀態 ===
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [homepageBlocks, setHomepageBlocks] = useState<HomepageBlock[]>([]);
  const [contentReady, setContentReady] = useState(false);

  // === 導航狀態 ===
  type View = 'landing' | 'stack' | 'reading';
  const [view, setView] = useState<View>('landing');
  const [activeStackId, setActiveStackId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [stackPage, setStackPage] = useState<Page | null>(null);
  const [readingPage, setReadingPage] = useState<Page | null>(null);
  const [pageLoading, setPageLoading] = useState(false);

  // === 側邊欄 ===
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // === Refs ===
  const scrollRef = useRef<HTMLDivElement>(null);

  // === 提取 tree 中的 stack 節點 ===
  const stackNodes = useMemo(() => {
    // tree 的第一層子節點是 homepage → children 是 stacks
    const flat: PageTreeNode[] = [];
    for (const node of tree) {
      if (node.pageType === 'homepage' && node.children) {
        flat.push(...node.children);
      } else if (node.pageType === 'stack') {
        flat.push(node);
      }
    }
    return flat;
  }, [tree]);

  // 用一個 flat list 快速查找任何節點
  const flatNodes = useMemo(() => {
    const acc: PageTreeNode[] = [];
    function walk(nodes: PageTreeNode[]) {
      for (const n of nodes) {
        acc.push(n);
        walk(n.children || []);
      }
    }
    walk(tree);
    return acc;
  }, [tree]);

  // === Homepage blocks 解析 ===
  const hpHeader = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'zone-header');
    return b ? (b.data as ZoneHeaderData) : null;
  }, [homepageBlocks]);

  const hpDialogues = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'uep-dialogue');
    return b ? (b.data as UepDialogueItem[]) : null;
  }, [homepageBlocks]);

  const hpRichTexts = useMemo(() => {
    return homepageBlocks
      .filter((b) => b.type === 'rich-text')
      .map((b) => (b.data as { html: string }).html);
  }, [homepageBlocks]);

  const hpModules = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'terminal-module-table');
    return b
      ? (b.data as { headerLabel: string; modules: TerminalModule[] })
      : null;
  }, [homepageBlocks]);

  // ──────────────────────────────────────────────────────────────────
  // 初始化
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    void fetchTree();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setContentReady(true), 2000);
    fetch(`${API_BASE}/api/content/concepts/homepage`)
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
        setContentReady(true);
      });
  }, []);

  // === URL 初始解析 ===
  useEffect(() => {
    if (treeLoading || !tree.length) return;
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page');
    const stack = params.get('stack');
    if (page) navigateToPage(page, false);
    else if (stack) navigateToStack(stack, false);
  }, [treeLoading, tree]);

  // === popstate ===
  useEffect(() => {
    function handler() {
      const params = new URLSearchParams(window.location.search);
      const page = params.get('page');
      const stack = params.get('stack');
      if (page) navigateToPage(page, false);
      else if (stack) navigateToStack(stack, false);
      else navigateToLanding(false);
    }
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [tree]);

  // ──────────────────────────────────────────────────────────────────
  // 資料載入
  // ──────────────────────────────────────────────────────────────────
  async function fetchTree() {
    setTreeLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/content/concepts/tree`);
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
      const res = await fetch(`${API_BASE}/api/content/concepts/${slug}`);
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

  // ──────────────────────────────────────────────────────────────────
  // URL 輔助
  // ──────────────────────────────────────────────────────────────────
  function pushUrl(params: Record<string, string>) {
    const url = new URL(window.location.href);
    url.search = '';
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    window.history.pushState({}, '', url.toString());
  }

  // ──────────────────────────────────────────────────────────────────
  // 導航
  // ──────────────────────────────────────────────────────────────────
  function navigateToLanding(push = true) {
    setView('landing');
    setActiveStackId(null);
    setActivePageId(null);
    setStackPage(null);
    setReadingPage(null);
    if (push) {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.pushState({}, '', url.toString());
    }
    scrollRef.current?.scrollTo(0, 0);
  }

  function navigateToStack(stackSlug: string, push = true) {
    const fullId = stackSlug.startsWith('concepts/')
      ? stackSlug
      : `concepts/${stackSlug}`;
    const slug = fullId.replace('concepts/', '');

    setView('stack');
    setActiveStackId(fullId);
    setActivePageId(null);
    setReadingPage(null);
    if (push) pushUrl({ stack: slug });
    scrollRef.current?.scrollTo(0, 0);

    // 展開 sidebar
    setExpandedNodes((prev) => new Set([...prev, fullId]));

    // fetch
    setPageLoading(true);
    fetchPageData(slug).then((p) => {
      setStackPage(p);
      setPageLoading(false);
    });
  }

  function navigateToPage(pageSlug: string, push = true) {
    const fullId = pageSlug.startsWith('concepts/')
      ? pageSlug
      : `concepts/${pageSlug}`;
    const slug = fullId.replace('concepts/', '');

    setView('reading');
    setActivePageId(fullId);
    if (push) pushUrl({ page: slug });
    scrollRef.current?.scrollTo(0, 0);

    // 判斷所屬 stack 並展開
    const stackDef = STACKS.find((s) => slug.startsWith(s.slug));
    if (stackDef) {
      setActiveStackId(`concepts/${stackDef.slug}`);
      setExpandedNodes((prev) => new Set([...prev, `concepts/${stackDef.slug}`]));
    }

    setPageLoading(true);
    fetchPageData(slug).then((p) => {
      setReadingPage(p);
      setPageLoading(false);
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Zone 切換
  // ──────────────────────────────────────────────────────────────────
  function handlePickZone(zoneId: string) {
    if (zoneId === 'concepts') return;
    const z = ZONES.find((zz) => zz.id === zoneId);
    if (z) {
      setPortalZone(z);
      setTimeout(() => {
        window.location.href = `/${z.slug}`;
      }, 1100);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 內容解析：從 HTML 中抽取結構化資料
  // ──────────────────────────────────────────────────────────────────

  /** 從 HTML 中抽取所有 <table> 區段（含前方 <h3> 標題） */
  function extractTables(html: string): { title: string; headers: string[]; rows: string[][] }[] {
    const results: { title: string; headers: string[]; rows: string[][] }[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const tables = doc.querySelectorAll('table');
    tables.forEach((table) => {
      // 找前方最近的 h3 作為標題
      let title = '';
      let prev = table.previousElementSibling;
      while (prev) {
        if (prev.tagName === 'H3' || prev.tagName === 'H2') {
          title = prev.textContent?.trim() || '';
          break;
        }
        if (prev.tagName === 'HR') { prev = prev.previousElementSibling; continue; }
        break;
      }
      const headers: string[] = [];
      table.querySelectorAll('thead th').forEach((th) => headers.push(th.textContent?.trim() || ''));
      const rows: string[][] = [];
      table.querySelectorAll('tbody tr').forEach((tr) => {
        const cells: string[] = [];
        tr.querySelectorAll('td').forEach((td) => cells.push(td.textContent?.trim() || ''));
        // 跳過分隔線行
        if (cells.every((c) => /^[-—]+$/.test(c))) return;
        rows.push(cells);
      });
      if (rows.length > 0) results.push({ title, headers, rows });
    });
    return results;
  }

  /** 從 HTML 中抽取 <details> 區段 */
  function extractDetails(html: string): { title: string; content: string }[] {
    const results: { title: string; content: string }[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    doc.querySelectorAll('details').forEach((det) => {
      const summary = det.querySelector('summary');
      const title = summary?.textContent?.trim() || '未知';
      // 取 summary 以外的所有內容
      const clone = det.cloneNode(true) as HTMLElement;
      clone.querySelector('summary')?.remove();
      results.push({ title, content: clone.innerHTML });
    });
    return results;
  }

  /** 抽取 hints（提示區塊）和非結構化散文 */
  function extractProse(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    // 移除 tables 和 details，留下提示和段落
    doc.querySelectorAll('table, details').forEach((el) => el.remove());
    return doc.body.innerHTML;
  }

  // ──────────────────────────────────────────────────────────────────
  // Landing 視圖
  // ──────────────────────────────────────────────────────────────────
  function renderLanding() {
    return (
      <section className="conc-landing">
        <div className="conc-landing-inner">
          {homepageBlocks.length > 0 ? (
            homepageBlocks.map((block) => {
              switch (block.type) {
                case 'zone-header': {
                  const d = block.data as ZoneHeaderData;
                  return (
                    <div key={block.id}>
                      <div className="conc-kicker">
                        Volume IV · CONCEPTS
                      </div>
                      <div className="conc-landing-title-row">
                        <h1 className="conc-landing-title">{d.title}</h1>
                        <span className="conc-terminal-badge">
                          $ root@uep:~ · CONNECTED
                        </span>
                      </div>
                      {d.subtitle && (
                        <p className="conc-landing-subtitle">{d.subtitle}</p>
                      )}
                    </div>
                  );
                }
                case 'uep-dialogue': {
                  const items = block.data as UepDialogueItem[];
                  return (
                    <div key={block.id} className="conc-landing-uep">
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
                  const d = block.data as { html: string };
                  return (
                    <div
                      key={block.id}
                      className="conc-prose"
                      dangerouslySetInnerHTML={{ __html: d.html }}
                    />
                  );
                }
                case 'terminal-module-table': {
                  const d = block.data as {
                    headerLabel: string;
                    modules: TerminalModule[];
                  };
                  return (
                    <div key={block.id} className="conc-module-table">
                      <div className="conc-module-table-bar">
                        <span>{d.headerLabel}</span>
                        <span>{d.modules.length} units</span>
                      </div>
                      {d.modules.map((mod, i) => (
                        <button
                          key={mod.id}
                          className="conc-module-row"
                          onClick={() => {
                            const stack = STACKS[i];
                            if (stack) navigateToStack(stack.slug);
                          }}
                        >
                          <span className="conc-mod-num">{mod.id}</span>
                          <span className="conc-mod-name">{mod.name}</span>
                          <span className="conc-mod-en">{mod.en}</span>
                          <span
                            className={`conc-mod-state ${mod.state}`}
                          >
                            <span className="conc-mod-dot" />
                            {mod.state}
                          </span>
                          <span className="conc-mod-rec">
                            {mod.records} rec
                          </span>
                          <span className="conc-mod-arrow">›</span>
                        </button>
                      ))}
                    </div>
                  );
                }
                default:
                  return null;
              }
            })
          ) : (
            /* fallback 硬編碼 */
            <div>
              <div className="conc-kicker">Volume IV · CONCEPTS</div>
              <h1 className="conc-landing-title">概念調整房</h1>
              <p className="conc-landing-subtitle">
                世界觀、設定文件。一切關於這個世界「為什麼是這樣」的解答都在這裡。
              </p>
            </div>
          )}
        </div>
      </section>
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Stack 視圖
  // ──────────────────────────────────────────────────────────────────
  function renderStack() {
    const stackDef = STACKS.find(
      (s) => `concepts/${s.slug}` === activeStackId
    );
    const stackNode = stackNodes.find((n) => n.id === activeStackId);
    if (!stackDef || !stackNode) return null;

    const children = stackNode.children || [];

    return (
      <div className="conc-stack-page">
        {/* StackHeader */}
        <div className="conc-stack-header">
          <div className="conc-stack-breadcrumb">
            <span className="conc-stack-breadcrumb-line" />
            <button onClick={navigateToLanding.bind(null, true)}>
              CONCEPTS
            </button>
            <span>·</span>
            <span>{stackDef.labelEn}</span>
          </div>
          <div className="conc-stack-title-row">
            <span className="conc-stack-icon">{stackDef.icon}</span>
            <h1 className="conc-stack-title">{stackDef.label}</h1>
            <div className="conc-stack-sync-badge">
              <span className="conc-mod-dot sync" />
              {children.length} types · sync ok
            </div>
          </div>
          <div className="conc-stack-path">
            {stackDef.labelEn}
            <span className="conc-stack-motto">
              // {stackDef.style}.layout
            </span>
          </div>
          <div className="conc-gradient-line" />
        </div>

        {/* Intro 段落（首字放大） */}
        <p className="conc-stack-intro">
          <span className="conc-drop-cap">{stackDef.intro[0]}</span>
          {stackDef.intro.slice(1)}
        </p>

        {/* UEP 對話 */}
        <div className="conc-stack-uep">
          <UepDialogue
            side="left"
            effects={['shimmer', 'halo'] as never[]}
            text={stackDef.uepNote}
          />
        </div>

        {/* API 內容 */}
        {stackPage?.content?.some((b) => b.content?.trim()) && (
          <div
            className="conc-prose"
            dangerouslySetInnerHTML={{
              __html: stackPage.content.map((b) => b.content || '').join(''),
            }}
          />
        )}

        {/* 終端目錄列表 */}
        <div className="conc-dir-listing">
          <div className="conc-dir-bar">
            <span>
              $ ls ./{stackDef.slug.split('/').pop()} --long
            </span>
            <span>{children.length} entries</span>
          </div>
          <div className="conc-dir-header-row">
            <span>#</span>
            <span>name</span>
            <span>identifier</span>
            <span>entries</span>
            <span>state</span>
            <span />
          </div>
          {children.map((child, i) => {
            const isHidden = child.metadata?.hidden === true;
            const childCount = child.children?.length || 0;
            return (
              <button
                key={child.id}
                className={`conc-dir-row ${i % 2 ? 'alt' : ''} ${isHidden ? 'locked' : ''}`}
                onClick={() => navigateToPage(child.slug)}
              >
                <span className="conc-dir-num">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="conc-dir-name-cell">
                  <div className="conc-dir-name">{child.title}</div>
                  <div className="conc-dir-hint">
                    {typeof child.metadata?.description === 'string'
                      ? (child.metadata.description as string).slice(0, 40)
                      : isHidden
                        ? 'sealed'
                        : `${childCount || '—'}`}
                  </div>
                </div>
                <span className="conc-dir-en">{child.slug.split('/').pop()}</span>
                <span className="conc-dir-count">
                  {childCount > 0 ? childCount : '—'}
                </span>
                <span
                  className={`conc-dir-state ${isHidden ? 'sealed' : 'sync'}`}
                >
                  <span className="conc-mod-dot" />
                  {isHidden ? 'sealed' : 'sync'}
                </span>
                <span className="conc-dir-arrow">›</span>
              </button>
            );
          })}
          <div className="conc-dir-tip">
            <span className="conc-dir-tip-prompt">$</span>
            <span>
              tip — 被標記為{' '}
              <span className="conc-hl">sealed</span> 的類別會隨著故事進度自動解鎖
            </span>
            <span className="conc-cursor" />
          </div>
        </div>

        {/* 返回按鈕 */}
        <div className="conc-back-bar">
          <button
            className="conc-back-btn"
            onClick={() => navigateToLanding()}
          >
            ← 返回概念調整房
          </button>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Reading 視圖
  // ──────────────────────────────────────────────────────────────────
  function renderReading() {
    if (pageLoading) {
      return (
        <div className="conc-page-loading">
          <span className="conc-cursor" />
          &nbsp;載入中...
        </div>
      );
    }
    if (!readingPage) {
      return <div className="conc-page-loading">找不到頁面</div>;
    }

    const node = flatNodes.find((n) => n.id === readingPage.id);
    const children = node?.children || [];
    const stackDef = STACKS.find((s) =>
      readingPage.slug.startsWith(s.slug)
    );

    // 麵包屑
    const crumbs = readingPage.slug.split('/').filter(Boolean);

    return (
      <div className="conc-reading-page">
        {/* 麵包屑 */}
        <div className="conc-stack-breadcrumb">
          <span className="conc-stack-breadcrumb-line" />
          <button onClick={() => navigateToLanding()}>CONCEPTS</button>
          {stackDef && (
            <>
              <span>·</span>
              <button onClick={() => navigateToStack(stackDef.slug)}>
                {stackDef.labelEn}
              </button>
            </>
          )}
          <span>·</span>
          <span>{crumbs[crumbs.length - 1]?.toUpperCase()}</span>
        </div>

        {/* 標題 */}
        <div className="conc-reading-header">
          <h1>{readingPage.title}</h1>
          {typeof node?.metadata?.description === 'string' && (
            <p className="conc-reading-desc">
              {node.metadata.description as string}
            </p>
          )}
          <span className="conc-reading-type-badge">
            {readingPage.pageType}
          </span>
        </div>

        {/* 子頁面列表 */}
        {children.length > 0 && (
          <div className="conc-dir-listing">
            <div className="conc-dir-bar">
              <span>$ ls ./{crumbs[crumbs.length - 1]} --long</span>
              <span>{children.length} entries</span>
            </div>
            {children.map((child, i) => {
              const isHidden = child.metadata?.hidden === true;
              return (
                <button
                  key={child.id}
                  className={`conc-dir-row ${i % 2 ? 'alt' : ''} ${isHidden ? 'locked' : ''}`}
                  onClick={() => navigateToPage(child.slug)}
                >
                  <span className="conc-dir-num">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="conc-dir-name-cell">
                    <div className="conc-dir-name">{child.title}</div>
                  </div>
                  <span className="conc-dir-en">
                    {child.slug.split('/').pop()}
                  </span>
                  <span className="conc-dir-count">
                    {child.children?.length || '—'}
                  </span>
                  <span
                    className={`conc-dir-state ${isHidden ? 'sealed' : 'sync'}`}
                  >
                    <span className="conc-mod-dot" />
                    {isHidden ? 'sealed' : 'sync'}
                  </span>
                  <span className="conc-dir-arrow">›</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 內容 */}
        {readingPage.content?.some((b) => b.content?.trim()) && (
          <div
            className="conc-prose"
            dangerouslySetInnerHTML={{
              __html: readingPage.content
                .map((b) => b.content || '')
                .join(''),
            }}
          />
        )}

        {/* 返回按鈕 */}
        <div className="conc-back-bar">
          {stackDef ? (
            <button
              className="conc-back-btn"
              onClick={() => navigateToStack(stackDef.slug)}
            >
              ← 返回{stackDef.label}
            </button>
          ) : (
            <button
              className="conc-back-btn"
              onClick={() => navigateToLanding()}
            >
              ← 返回概念調整房
            </button>
          )}
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // 主渲染
  // ──────────────────────────────────────────────────────────────────
  const isInShell = view === 'stack' || view === 'reading';
  const chromeUrl = activeStackId
    ? `uep.terminal ~ /concepts/${STACKS.find((s) => `concepts/${s.slug}` === activeStackId)?.slug.split('/').pop() || ''}/`
    : 'uep.terminal ~ /concepts/';

  return (
    <div className={`concepts-reader ${isInShell ? 'in-shell' : ''}`}>
      {/* 入場霧化 */}
      <div
        aria-hidden="true"
        className="conc-fog"
        style={{ opacity: contentReady ? 0 : 1 }}
      />

      {/* 掃描線 + 格線（shell 模式才啟用） */}
      {isInShell && (
        <>
          <div className="conc-scanline-overlay" aria-hidden="true" />
          <div className="conc-grid-overlay" aria-hidden="true" />
        </>
      )}

      {/* 終端地址欄（shell 模式才顯示） */}
      {isInShell && renderChrome(chromeUrl)}

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

      <div className="conc-main">
        <ZoneAtmosphere zone={CONCEPTS_ZONE} intensity="subtle" skipGlyphs />

        {/* 飄移符號粒子 */}
        <div className="conc-symbols" aria-hidden="true">
          {ESSENCE_SYMBOLS.flatMap((s, i) =>
            [0, 1].map((k) => {
              const idx = i * 2 + k;
              return (
                <span
                  key={idx}
                  className="conc-symbol"
                  style={{
                    left: `${(idx * 37) % 96}%`,
                    top: `${(idx * 23) % 92}%`,
                    fontSize: 12 + (idx % 4) * 5,
                    animationDuration: `${16 + (idx % 5)}s`,
                    animationDelay: `${(idx * 0.35) % 9}s`,
                  }}
                >
                  {s}
                </span>
              );
            })
          )}
        </div>

        {/* 側邊欄（shell 模式才顯示） */}
        {isInShell && renderSidebar()}

        {/* 主內容 */}
        <div className="conc-content" ref={scrollRef}>
          {view === 'landing' && renderLanding()}
          {view === 'stack' && renderStack()}
          {view === 'reading' && renderReading()}
        </div>
      </div>

      {/* 浮動元件 */}
      <Minimap
        zones={ZONES}
        currentId="concepts"
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
            setTimeout(() => {
              window.location.href = '/';
            }, 1100);
          }}
        />
      )}

      <IntroOverlay
        zone={introZone}
        onEnter={() => setIntroZone(null)}
        onClose={() => setIntroZone(null)}
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
