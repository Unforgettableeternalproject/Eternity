/* eslint-disable @typescript-eslint/no-unused-vars */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ZONES } from '../../data/zones';
import BigMapModal from '../ui/BigMapModal';
import Minimap from '../ui/Minimap';
import PortalTransition from '../ui/PortalTransition';
import TopBar from '../ui/TopBar';
import IntroOverlay from '../ui/IntroOverlay';
import UepDialogue from '../ui/UepDialogue';
import ZoneAtmosphere from '../ui/ZoneAtmosphere';
import type { HomepageBlock, ZoneHeaderData, UepDialogueItem } from '../editor/homepage/types';
import { fromContentBlock } from '../editor/homepage/types';
import type { ImageItem, VisualsData } from '../editor/VisualsEditorBody';
import './VisualsReader.css';

// ──────────────────────────────────────────────────────────────
// 型別
// ──────────────────────────────────────────────────────────────
type PageType = 'zone' | 'division' | 'subcategory' | 'gallery' | 'homepage' | 'page';

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
  parentId: string | null;
  pageType: string;
}

// ──────────────────────────────────────────────────────────────
// 常數
// ──────────────────────────────────────────────────────────────
const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

const VISUALS_ZONE = ZONES.find((z) => z.id === 'visuals')!;
const ACCENT = '#5E548E';

interface DivisionDef {
  id: string;
  label: string;
  labelEn: string;
  icon: string;
  intro: string;
  uepNote: string;
  galleryStyle: 'corridor' | 'museum' | 'pinboard' | 'pixel';
}

const DIVISIONS: DivisionDef[] = [
  {
    id: 'profiles',
    label: '陳列走廊',
    labelEn: 'PROFILES · GALLERY HALL',
    icon: '⬚',
    intro: '你站在一條看不到盡頭的長廊，兩側懸掛著無數的肖像。每一張臉都似乎在對你訴說著他們的故事——有些溫暖，有些冰冷，有些你甚至覺得見過。',
    uepNote: '這裡是我幫你整理好的所有「設定圖」喔，每一張都對應到一個我認識的人或地方!',
    galleryStyle: 'corridor',
  },
  {
    id: 'illustrations',
    label: '鑲框室',
    labelEn: 'ILLUSTRATIONS · FRAMED HALL',
    icon: '❒',
    intro: '有一道厚重的木門，門後是一個寬敞的長方形房間。所有的牆都掛滿了被鍍金邊框圍住的畫作。你彷彿置身於一座古老的美術館之中。',
    uepNote: '這些都是我比較花心思去構想的場景! 你可以慢慢看~',
    galleryStyle: 'museum',
  },
  {
    id: 'sketchs',
    label: '抽象萃取間',
    labelEn: 'SKETCHS · EXTRACTION ROOM',
    icon: '✎',
    intro: '這個區域瀰漫著鉛筆與炭灰的氣味，紙張被無序地釘在四面八方的軟木牆上。這些是尚未完成的意念，半成品的幻象。',
    uepNote: '這些是還沒完成的草稿~ 有時候我也會回來修一修它們!',
    galleryStyle: 'pinboard',
  },
  {
    id: 'pixel',
    label: '基底實驗室',
    labelEn: 'PIXEL · BASE LAYER LAB',
    icon: '▦',
    intro: '你進入了一個被冷光照亮的小房間。中央的儀器正在播放著一張張不斷重組的小型圖樣。每一個像素都是經過精密計算的。',
    uepNote: '最近 Bernie 在玩像素藝術! 我覺得很有趣所以也想保存下來~',
    galleryStyle: 'pixel',
  },
];

// ──────────────────────────────────────────────────────────────
// 工具函式
// ──────────────────────────────────────────────────────────────
function buildImageUrl(key: string): string {
  return `${API_BASE}/api/assets/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function findDivisionNode(tree: PageTreeNode[], divId: string): PageTreeNode | null {
  for (const n of tree) {
    if (n.pageType === 'division' && n.slug.endsWith(divId)) return n;
    for (const c of n.children || []) {
      if (c.pageType === 'division' && c.slug.endsWith(divId)) return c;
    }
  }
  return null;
}

function findNodeById(tree: PageTreeNode[], id: string): PageTreeNode | null {
  for (const n of tree) {
    if (n.id === id) return n;
    const found = findNodeById(n.children || [], id);
    if (found) return found;
  }
  return null;
}

function findParentDivision(tree: PageTreeNode[], nodeId: string): DivisionDef | null {
  for (const n of tree) {
    for (const div of n.children || []) {
      if (div.pageType !== 'division') continue;
      const found = findNodeById([div], nodeId);
      if (found) {
        return DIVISIONS.find((d) => div.slug.endsWith(d.id)) || null;
      }
    }
    // 也檢查直接 division
    if (n.pageType === 'division') {
      const found = findNodeById([n], nodeId);
      if (found) {
        return DIVISIONS.find((d) => n.slug.endsWith(d.id)) || null;
      }
    }
  }
  return null;
}

function countGalleries(node: PageTreeNode): number {
  let count = 0;
  if (node.pageType === 'gallery' && !node.metadata?.hidden) count++;
  for (const c of node.children || []) count += countGalleries(c);
  return count;
}

function spoilerFilter(level: number): string {
  if (level === 1) return 'blur(4px)';
  if (level === 2) return 'blur(10px)';
  if (level === 3) return 'blur(18px) saturate(0.4)';
  return 'none';
}

// ──────────────────────────────────────────────────────────────
// 主元件
// ──────────────────────────────────────────────────────────────
type View = 'landing' | 'division' | 'subcat' | 'gallery';

export default function VisualsReader() {
  return <VisualsReaderInner />;
}

function VisualsReaderInner() {
  // === State ===
  const [view, setView] = useState<View>('landing');
  const [activeDivisionId, setActiveDivisionId] = useState<string | null>(null);
  const [activeSubcatId, setActiveSubcatId] = useState<string | null>(null);
  const [activeGalleryId, setActiveGalleryId] = useState<string | null>(null);
  const [activeGroupIdx, setActiveGroupIdx] = useState(0);
  const [galleryPage, setGalleryPage] = useState<Page | null>(null);

  // Tree
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);

  // Homepage blocks
  const [homepageBlocks, setHomepageBlocks] = useState<HomepageBlock[]>([]);
  const [contentReady, setContentReady] = useState(false);

  // Spoiler
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [spoilerWarning, setSpoilerWarning] = useState<{
    id: string; level: number; gate: string; onConfirm: () => void;
  } | null>(null);

  // Lightbox
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [lightboxImages, setLightboxImages] = useState<ImageItem[]>([]);
  const [lbZoom, setLbZoom] = useState(1);
  const [lbPan, setLbPan] = useState({ x: 0, y: 0 });

  // UI chrome
  const [showMap, setShowMap] = useState(false);
  const [homePortal, setHomePortal] = useState(false);
  const [portalZone, setPortalZone] = useState<any>(null);
  const [introZone, setIntroZone] = useState<any>(null);
  const [theme, setTheme] = useState(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem('uep-theme')) || 'dark'
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Corridor 索引
  const [corridorIdx, setCorridorIdx] = useState(0);

  // === Fetch tree ===
  const fetchTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/content/visuals/tree`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok) setTree(json.data || []);
    } catch (err) {
      console.error('fetchTree error:', err);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  // === Fetch homepage blocks ===
  const fetchHomepage = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/content/visuals/homepage`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok && json.data?.content) {
        const raw = json.data.content;
        const blocks: HomepageBlock[] = (Array.isArray(raw) ? raw : [])
          .map((b: any) => fromContentBlock(b))
          .filter(Boolean) as HomepageBlock[];
        setHomepageBlocks(blocks);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void fetchTree();
    void fetchHomepage();
    const t = setTimeout(() => setContentReady(true), 2000);
    return () => clearTimeout(t);
  }, [fetchTree, fetchHomepage]);

  useEffect(() => {
    if (!treeLoading) setContentReady(true);
  }, [treeLoading]);

  // === URL state ===
  useEffect(() => {
    if (treeLoading || tree.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page');
    const subcat = params.get('subcat');
    const division = params.get('division');
    const group = params.get('group');

    if (page) {
      navigateToGallery(page, false);
    } else if (subcat) {
      navigateToSubcat(subcat, group ? parseInt(group) : 0, false);
    } else if (division) {
      navigateToDivision(division, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeLoading, tree]);

  useEffect(() => {
    const handler = () => {
      const params = new URLSearchParams(window.location.search);
      const page = params.get('page');
      const subcat = params.get('subcat');
      const division = params.get('division');
      const group = params.get('group');

      if (page) {
        navigateToGallery(page, false);
      } else if (subcat) {
        navigateToSubcat(subcat, group ? parseInt(group) : 0, false);
      } else if (division) {
        navigateToDivision(division, false);
      } else {
        navigateToLanding(false);
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  // === Navigation ===
  function pushUrl(params: Record<string, string>) {
    const url = new URL(window.location.href);
    url.search = '';
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    window.history.pushState({}, '', url.toString());
  }

  function navigateToLanding(push = true) {
    setView('landing');
    setActiveDivisionId(null);
    setActiveSubcatId(null);
    setActiveGalleryId(null);
    setGalleryPage(null);
    scrollRef.current?.scrollTo({ top: 0 });
    if (push) {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.pushState({}, '', url.toString());
    }
  }

  function navigateToDivision(divId: string, push = true) {
    setView('division');
    setActiveDivisionId(divId);
    setActiveSubcatId(null);
    setActiveGalleryId(null);
    setGalleryPage(null);
    scrollRef.current?.scrollTo({ top: 0 });
    if (push) pushUrl({ division: divId });
  }

  function navigateToSubcat(subcatId: string, groupIdx = 0, push = true) {
    setView('subcat');
    setActiveSubcatId(subcatId);
    setActiveGroupIdx(groupIdx);
    setActiveGalleryId(null);
    setGalleryPage(null);
    // 從 subcatId 推導 divisionId
    const divDef = findParentDivision(tree, subcatId);
    if (divDef) setActiveDivisionId(divDef.id);
    scrollRef.current?.scrollTo({ top: 0 });
    if (push) pushUrl({ subcat: subcatId, group: String(groupIdx) });
  }

  async function navigateToGallery(pageId: string, push = true) {
    setView('gallery');
    setActiveGalleryId(pageId);
    setCorridorIdx(0);
    // 推導 divisionId
    const divDef = findParentDivision(tree, pageId);
    if (divDef) setActiveDivisionId(divDef.id);
    scrollRef.current?.scrollTo({ top: 0 });
    if (push) pushUrl({ page: pageId });
    // Fetch page
    try {
      const slug = pageId.replace('visuals/', '');
      const res = await fetch(`${API_BASE}/api/content/visuals/${slug}`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok) setGalleryPage(json.data);
    } catch { /* ignore */ }
  }

  // === Spoiler unlock ===
  function requestUnlock(id: string, level: number, gate: string, onConfirm: () => void) {
    setSpoilerWarning({ id, level, gate, onConfirm });
  }

  function confirmUnlock() {
    if (!spoilerWarning) return;
    setUnlocked((prev) => new Set(prev).add(spoilerWarning.id));
    spoilerWarning.onConfirm();
    setSpoilerWarning(null);
  }

  function isUnlocked(id: string): boolean {
    return unlocked.has(id);
  }

  // === Lightbox ===
  function openLightbox(images: ImageItem[], idx: number) {
    setLightboxImages(images);
    setLightboxIdx(idx);
    setLbZoom(1);
    setLbPan({ x: 0, y: 0 });
  }

  function closeLightbox() {
    setLightboxIdx(null);
    setLightboxImages([]);
  }

  useEffect(() => {
    if (lightboxIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft' && lightboxIdx > 0) {
        setLightboxIdx(lightboxIdx - 1);
        setLbZoom(1);
        setLbPan({ x: 0, y: 0 });
      }
      if (e.key === 'ArrowRight' && lightboxIdx < lightboxImages.length - 1) {
        setLightboxIdx(lightboxIdx + 1);
        setLbZoom(1);
        setLbPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIdx, lightboxImages.length]);

  // === Render helpers ===
  const activeDivision = DIVISIONS.find((d) => d.id === activeDivisionId) || null;

  // ─── RENDER: Landing ───
  function renderLanding() {
    return (
      <div className="visuals-landing-page">
        {/* Header */}
        <div className="visuals-landing-kicker">Volume III · VISUALS</div>
        <h1 className="visuals-landing-title">幻影重現室</h1>
        <div className="visuals-landing-subtitle">
          畫作、插圖、視覺作品。半透明的人物像在水面盪漾。
        </div>

        {/* UEP dialogues */}
        <div className="visuals-landing-uep">
          {VISUALS_ZONE.uep.map((text, i) => (
            <UepDialogue key={i} side="left" effects={i === 0 ? ['shimmer', 'halo'] : []} text={text} />
          ))}
        </div>

        {/* Division grid */}
        <div className="visuals-division-grid">
          {DIVISIONS.map((div) => {
            const node = findDivisionNode(tree, div.id);
            const count = node ? countGalleries(node) : 0;
            return (
              <button
                key={div.id}
                className="visuals-division-card"
                onClick={() => navigateToDivision(div.id)}
              >
                <div className="visuals-division-card-icon">{div.icon}</div>
                <div className="visuals-division-card-name">{div.label}</div>
                <div className="visuals-division-card-en">{div.labelEn}</div>
                <div className="visuals-division-card-desc">
                  {div.intro.slice(0, 50)}...
                  {count > 0 && (
                    <span style={{ marginLeft: 8, color: ACCENT }}>
                      {count} 個畫廊
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── RENDER: Division ───
  function renderDivision() {
    if (!activeDivision) return null;
    const divNode = findDivisionNode(tree, activeDivision.id);
    const subcats = (divNode?.children || [])
      .filter((c) => c.pageType === 'subcategory' && !c.metadata?.hidden)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return (
      <div className="visuals-division-page">
        {/* Breadcrumb */}
        <div className="visuals-breadcrumb">
          <button onClick={() => navigateToLanding()}>幻影重現室</button>
          <span className="visuals-breadcrumb-sep">/</span>
          <span>{activeDivision.labelEn}</span>
        </div>

        {/* Header */}
        <div className="visuals-division-header">
          <span className="visuals-division-header-icon">{activeDivision.icon}</span>
          <h2>{activeDivision.label}</h2>
        </div>
        <div className="visuals-division-stats">
          {subcats.length} categories · {activeDivision.galleryStyle} layout
        </div>
        <div className="visuals-gradient-divider" />

        {/* Intro */}
        <p className="visuals-narrative">
          <span className="visuals-drop-cap">{activeDivision.intro[0]}</span>
          {activeDivision.intro.slice(1)}
        </p>

        <UepDialogue side="left" effects={['shimmer', 'halo']} text={activeDivision.uepNote} />

        {/* Subcat list */}
        <div className="visuals-subcat-list">
          {subcats.map((sc, i) => {
            const galleryCount = countGalleries(sc);
            const locked = sc.metadata?.locked === true;
            return (
              <button
                key={sc.id}
                className={`visuals-subcat-card ${locked ? 'is-locked' : ''}`}
                onClick={() => !locked && navigateToSubcat(sc.id)}
                disabled={locked}
              >
                <span className="visuals-subcat-card-num">
                  {String(i + 1).padStart(2, '0')}.
                </span>
                <div>
                  <div className="visuals-subcat-card-title">{sc.title}</div>
                </div>
                <span className="visuals-subcat-card-count">
                  {locked ? '— sealed —' : `${galleryCount} galleries`}
                </span>
                <span className="visuals-subcat-card-arrow">
                  {locked ? '🔒' : '→'}
                </span>
              </button>
            );
          })}
        </div>

        {subcats.length === 0 && <div className="visuals-empty">尚無子分類</div>}

        <div className="visuals-back-bar">
          <button className="visuals-back-btn" onClick={() => navigateToLanding()}>
            ← 返回幻影重現室
          </button>
        </div>
      </div>
    );
  }

  // ─── RENDER: Subcat ───
  function renderSubcat() {
    if (!activeSubcatId) return null;
    const subcatNode = findNodeById(tree, activeSubcatId);
    if (!subcatNode) return <div className="visuals-empty">載入中...</div>;

    const galleries = (subcatNode.children || [])
      .filter((c) => c.pageType === 'gallery' && !c.metadata?.hidden)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // Build group list
    const groupMap = new Map<string, PageTreeNode[]>();
    for (const g of galleries) {
      const group = (g.metadata?.group as string) || '全部';
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(g);
    }
    const groupList = [...groupMap.keys()];
    const safeGroupIdx = Math.min(activeGroupIdx, Math.max(0, groupList.length - 1));
    const currentGroup = groupList[safeGroupIdx] || '全部';
    const currentGalleries = groupMap.get(currentGroup) || galleries;

    return (
      <div className="visuals-subcat-page">
        {/* Breadcrumb */}
        <div className="visuals-breadcrumb">
          <button onClick={() => navigateToLanding()}>幻影重現室</button>
          <span className="visuals-breadcrumb-sep">/</span>
          <button onClick={() => activeDivision && navigateToDivision(activeDivision.id)}>
            {activeDivision?.label || '...'}
          </button>
          <span className="visuals-breadcrumb-sep">/</span>
          <span>{subcatNode.title}</span>
        </div>

        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 600, color: 'var(--ink-title)', margin: '8px 0 4px' }}>
          {subcatNode.title}
        </h2>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)', letterSpacing: '0.16em' }}>
          {galleries.length} galleries · {groupList.length} groups
        </div>
        <div className="visuals-gradient-divider" />

        {/* Group navigation */}
        {groupList.length > 1 && (
          <div className="visuals-tag-bar">
            <button
              className="visuals-tag-btn"
              disabled={safeGroupIdx <= 0}
              onClick={() => navigateToSubcat(activeSubcatId!, safeGroupIdx - 1)}
            >
              ‹
            </button>
            <div className="visuals-tag-label">
              {currentGroup} ({safeGroupIdx + 1} / {groupList.length})
            </div>
            <button
              className="visuals-tag-btn"
              disabled={safeGroupIdx >= groupList.length - 1}
              onClick={() => navigateToSubcat(activeSubcatId!, safeGroupIdx + 1)}
            >
              ›
            </button>
          </div>
        )}

        {/* Gallery cards */}
        <div className="visuals-gallery-card-grid">
          {currentGalleries.map((g) => {
            const images = Array.isArray(g.metadata?.images) ? (g.metadata.images as ImageItem[]) : [];
            const spoiler = (g.metadata?.spoilerLevel as number) || 0;
            const gate = (g.metadata?.gate as string) || '';
            const thumbUrl = images.length > 0 ? buildImageUrl(images[0].file) : '';
            const isLocked = spoiler > 0 && !isUnlocked(g.id);

            const handleClick = () => {
              if (isLocked) {
                requestUnlock(g.id, spoiler, gate, () => {
                  void navigateToGallery(g.id);
                });
              } else {
                void navigateToGallery(g.id);
              }
            };

            return (
              <button key={g.id} className="visuals-gallery-card" onClick={handleClick}>
                {thumbUrl ? (
                  <img
                    className="visuals-gallery-card-thumb"
                    src={thumbUrl}
                    alt={g.title}
                    style={{ filter: isLocked ? spoilerFilter(spoiler) : 'none' }}
                  />
                ) : (
                  <div className="visuals-placeholder-art" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9F86C0)` }}>
                    PLACEHOLDER
                  </div>
                )}
                <div className="visuals-gallery-card-body">
                  <div className="visuals-gallery-card-title">{g.title}</div>
                  <div className="visuals-gallery-card-meta">
                    {images.length} 張圖片
                    {spoiler > 0 && <span style={{ color: spoiler === 3 ? 'crimson' : 'goldenrod', marginLeft: 8 }}>L{spoiler}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {currentGalleries.length === 0 && <div className="visuals-empty">此分組尚無畫廊</div>}

        <div className="visuals-back-bar">
          <button className="visuals-back-btn" onClick={() => activeDivision && navigateToDivision(activeDivision.id)}>
            ← 返回{activeDivision?.label || ''}
          </button>
        </div>
      </div>
    );
  }

  // ─── RENDER: Gallery ───
  function renderGallery() {
    if (!galleryPage) return <div className="visuals-empty">載入中...</div>;

    const meta = galleryPage.metadata || {};
    const images: ImageItem[] = Array.isArray(meta.images) ? (meta.images as ImageItem[]) : [];
    const style = activeDivision?.galleryStyle || 'museum';

    return (
      <div className="visuals-gallery-page">
        {/* Breadcrumb */}
        <div className="visuals-breadcrumb">
          <button onClick={() => navigateToLanding()}>幻影重現室</button>
          <span className="visuals-breadcrumb-sep">/</span>
          <button onClick={() => activeDivision && navigateToDivision(activeDivision.id)}>
            {activeDivision?.label || '...'}
          </button>
          <span className="visuals-breadcrumb-sep">/</span>
          {activeSubcatId && (
            <>
              <button onClick={() => navigateToSubcat(activeSubcatId!)}>
                {findNodeById(tree, activeSubcatId)?.title || '...'}
              </button>
              <span className="visuals-breadcrumb-sep">/</span>
            </>
          )}
          <span>{galleryPage.title}</span>
        </div>

        <div className="visuals-gallery-header">
          <div className="visuals-landing-kicker">{activeDivision?.labelEn}</div>
          <h2>{galleryPage.title}</h2>
          <div className="visuals-gallery-count">{images.length} pieces · {style} layout</div>
        </div>
        <div className="visuals-gradient-divider" />

        {images.length === 0 ? (
          <div className="visuals-empty">此畫廊尚無圖片</div>
        ) : (
          renderGalleryByStyle(style, images)
        )}

        <div className="visuals-back-bar">
          <button className="visuals-back-btn" onClick={() => activeSubcatId ? navigateToSubcat(activeSubcatId) : activeDivision ? navigateToDivision(activeDivision.id) : navigateToLanding()}>
            ← 返回
          </button>
        </div>
      </div>
    );
  }

  // ─── Gallery Styles ───
  function renderGalleryByStyle(style: string, images: ImageItem[]) {
    switch (style) {
      case 'corridor': return renderCorridor(images);
      case 'museum': return renderMuseum(images);
      case 'pinboard': return renderPinboard(images);
      case 'pixel': return renderPixel(images);
      default: return renderMuseum(images);
    }
  }

  function renderCorridor(images: ImageItem[]) {
    const art = images[corridorIdx] || images[0];
    if (!art) return null;
    const prev = () => setCorridorIdx((corridorIdx - 1 + images.length) % images.length);
    const next = () => setCorridorIdx((corridorIdx + 1) % images.length);

    return (
      <div className="visuals-gallery-corridor">
        <div className="visuals-corridor-stage">
          <button className="visuals-corridor-arrow" onClick={prev}>‹</button>
          <div className="visuals-corridor-main" onClick={() => openLightbox(images, corridorIdx)}>
            <img src={buildImageUrl(art.file)} alt={art.caption || ''} />
          </div>
          <button className="visuals-corridor-arrow" onClick={next}>›</button>
        </div>
        <div className="visuals-corridor-caption">
          <div className="visuals-corridor-counter">
            {String(corridorIdx + 1).padStart(2, '0')} / {String(images.length).padStart(2, '0')}
          </div>
          <div className="visuals-corridor-title">{art.caption || galleryPage?.title}</div>
        </div>
        <div className="visuals-corridor-strip">
          {images.map((img, i) => (
            <button
              key={img.id}
              className={`visuals-corridor-thumb ${i === corridorIdx ? 'is-active' : ''}`}
              onClick={() => setCorridorIdx(i)}
            >
              <img src={buildImageUrl(img.file)} alt="" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderMuseum(images: ImageItem[]) {
    return (
      <div className="visuals-gallery-museum">
        {images.map((art, i) => (
          <div key={art.id} className="visuals-museum-frame" onClick={() => openLightbox(images, i)}>
            <img src={buildImageUrl(art.file)} alt={art.caption || ''} />
            <div className="visuals-museum-label">「{art.caption || '無題'}」</div>
          </div>
        ))}
      </div>
    );
  }

  function renderPinboard(images: ImageItem[]) {
    return (
      <div className="visuals-gallery-pinboard">
        {images.map((art, i) => {
          const rot = ((i % 5) - 2) * 1.2;
          return (
            <div
              key={art.id}
              className="visuals-pinboard-card"
              style={{ transform: `rotate(${rot}deg)` }}
              onClick={() => openLightbox(images, i)}
            >
              <span className="visuals-pinboard-pin" />
              <img src={buildImageUrl(art.file)} alt={art.caption || ''} />
              <div className="visuals-pinboard-label">{art.caption || ''}</div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderPixel(images: ImageItem[]) {
    return (
      <div className="visuals-gallery-pixel">
        {images.map((art, i) => (
          <div key={art.id} className="visuals-pixel-cell" onClick={() => openLightbox(images, i)}>
            <img src={buildImageUrl(art.file)} alt={art.caption || ''} />
            <div className="visuals-pixel-label">{art.caption || art.file.split('/').pop()}</div>
          </div>
        ))}
      </div>
    );
  }

  // ─── RENDER: Lightbox ───
  function renderLightbox() {
    if (lightboxIdx === null || lightboxImages.length === 0) return null;
    const art = lightboxImages[lightboxIdx];
    if (!art) return null;

    const handleWheel = (e: React.WheelEvent) => {
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.3 : 0.3;
      setLbZoom((z) => Math.max(1, Math.min(4, z + delta)));
      if (lbZoom + delta <= 1) setLbPan({ x: 0, y: 0 });
    };

    let isPanning = false;
    const handlePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
      if (lbZoom <= 1) return;
      isPanning = true;
      const startX = e.clientX - lbPan.x;
      const startY = e.clientY - lbPan.y;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        if (!isPanning) return;
        setLbPan({ x: ev.clientX - startX, y: ev.clientY - startY });
      };
      const onUp = () => {
        isPanning = false;
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
    };

    return (
      <div className="visuals-lightbox" onClick={closeLightbox}>
        <div className="visuals-lightbox-inner" onClick={(e) => e.stopPropagation()}>
          <button className="visuals-lightbox-close" onClick={closeLightbox}>
            關閉 ✕
          </button>
          <img
            className={`visuals-lightbox-img ${lbZoom > 1 ? 'is-panning' : ''}`}
            src={buildImageUrl(art.file)}
            alt={art.caption || ''}
            style={{
              transform: `scale(${lbZoom}) translate(${lbPan.x / lbZoom}px, ${lbPan.y / lbZoom}px)`,
            }}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            draggable={false}
          />
          <div className="visuals-lightbox-meta">
            <div className="visuals-lightbox-caption">{art.caption || ''}</div>
            <div className="visuals-lightbox-nav">
              <button
                className="visuals-lightbox-btn"
                disabled={lightboxIdx <= 0}
                onClick={() => {
                  setLightboxIdx(lightboxIdx - 1);
                  setLbZoom(1);
                  setLbPan({ x: 0, y: 0 });
                }}
              >
                ← prev
              </button>
              <button
                className="visuals-lightbox-btn"
                disabled={lightboxIdx >= lightboxImages.length - 1}
                onClick={() => {
                  setLightboxIdx(lightboxIdx + 1);
                  setLbZoom(1);
                  setLbPan({ x: 0, y: 0 });
                }}
              >
                next →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── RENDER: Spoiler Dialog ───
  function renderSpoilerDialog() {
    if (!spoilerWarning) return null;
    return (
      <div className="visuals-spoiler-dialog" onClick={() => setSpoilerWarning(null)}>
        <div className="visuals-spoiler-dialog-inner" onClick={(e) => e.stopPropagation()}>
          <div className="visuals-spoiler-dialog-title">
            ⚠ SPOILER WARNING · LEVEL {spoilerWarning.level}
          </div>
          <div className="visuals-spoiler-dialog-gate">
            {spoilerWarning.gate || '此內容包含劇透，確定要繼續嗎？'}
          </div>
          <div className="visuals-spoiler-dialog-actions">
            <button className="visuals-spoiler-dialog-confirm" onClick={confirmUnlock}>
              我已知情，繼續
            </button>
            <button className="visuals-spoiler-dialog-cancel" onClick={() => setSpoilerWarning(null)}>
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  // === Main render ===
  return (
    <div className="visuals-reader">
      {/* 進場霧化 */}
      <div
        className={`visuals-arrival ${contentReady ? 'is-ready' : ''}`}
        aria-hidden="true"
      />

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

      <div className="visuals-main">
        <ZoneAtmosphere zone={VISUALS_ZONE} intensity="subtle" />
        <div className="visuals-content" ref={scrollRef}>
          {view === 'landing' && renderLanding()}
          {view === 'division' && renderDivision()}
          {view === 'subcat' && renderSubcat()}
          {view === 'gallery' && renderGallery()}
        </div>
      </div>

      {renderLightbox()}
      {renderSpoilerDialog()}

      <Minimap
        zones={ZONES}
        currentId="visuals"
        onExpand={() => setShowMap(true)}
        onPickZone={(zoneId) => {
          if (zoneId === 'visuals') return;
          const z = ZONES.find((zz) => zz.id === zoneId);
          if (z) {
            setPortalZone(z);
            setTimeout(() => { window.location.href = `/${z.slug}`; }, 1100);
          }
        }}
        position="bottom-left"
      />

      {showMap && (
        <BigMapModal
          zones={ZONES}
          onClose={() => setShowMap(false)}
          onPick={(zone) => {
            setShowMap(false);
            if (zone.id === 'visuals') return;
            setPortalZone(zone);
            setTimeout(() => {
              window.location.href = `/${zone.slug}`;
            }, 1100);
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

      <PortalTransition
        zone={portalZone}
        onDone={() => setPortalZone(null)}
      />
      <PortalTransition
        zone={null}
        homeMode={homePortal}
        onDone={() => setHomePortal(false)}
      />
    </div>
  );
}
