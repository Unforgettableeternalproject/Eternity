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
import VisualsPhantom from './VisualsPhantom';
import type { PhantomVariant } from './VisualsPhantom';
import type {
  HomepageBlock,
  ZoneHeaderData,
  UepDialogueItem,
  CrossRoad,
} from '../editor/homepage/types';
import { fromContentBlock } from '../editor/homepage/types';
import ZoneHomepageRenderer from '../zone/ZoneHomepageRenderer';
import type { ImageItem, VisualsData } from '../editor/VisualsEditorBody';
import SpriteViewer from './SpriteViewer';
import './VisualsReader.css';

// ──────────────────────────────────────────────────────────────
// 型別
// ──────────────────────────────────────────────────────────────
type PageType =
  | 'zone'
  | 'division'
  | 'subcategory'
  | 'gallery'
  | 'homepage'
  | 'page';

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
  content: {
    id: string;
    type: string;
    content: string;
    attrs?: Record<string, unknown>;
  }[];
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
    intro:
      '你站在一條看不到盡頭的長廊，兩側懸掛著無數的肖像。每一張臉都似乎在對你訴說著他們的故事——有些溫暖，有些冰冷，有些你甚至覺得見過。',
    uepNote:
      '這裡是我幫你整理好的所有「設定圖」喔，每一張都對應到一個我認識的人或地方!',
    galleryStyle: 'corridor',
  },
  {
    id: 'illustrations',
    label: '鑲框室',
    labelEn: 'ILLUSTRATIONS · FRAMED HALL',
    icon: '❒',
    intro:
      '有一道厚重的木門，門後是一個寬敞的長方形房間。所有的牆都掛滿了被鍍金邊框圍住的畫作。你彷彿置身於一座古老的美術館之中。',
    uepNote: '這些都是我比較花心思去構想的場景! 你可以慢慢看~',
    galleryStyle: 'museum',
  },
  {
    id: 'sketchs',
    label: '抽象萃取間',
    labelEn: 'SKETCHS · EXTRACTION ROOM',
    icon: '✎',
    intro:
      '這個區域瀰漫著鉛筆與炭灰的氣味，紙張被無序地釘在四面八方的軟木牆上。這些是尚未完成的意念，半成品的幻象。',
    uepNote: '這些是還沒完成的草稿~ 有時候我也會回來修一修它們!',
    galleryStyle: 'pinboard',
  },
  {
    id: 'pixel',
    label: '基底實驗室',
    labelEn: 'PIXEL · BASE LAYER LAB',
    icon: '▦',
    intro:
      '你進入了一個被冷光照亮的小房間。中央的儀器正在播放著一張張不斷重組的小型圖樣。每一個像素都是經過精密計算的。',
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

function findDivisionNode(
  tree: PageTreeNode[],
  divId: string
): PageTreeNode | null {
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

function findParentDivision(
  tree: PageTreeNode[],
  nodeId: string
): DivisionDef | null {
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

/** 從 subcategory 中找到第一張可用的縮圖 URL */
function findFirstThumb(node: PageTreeNode): string | null {
  for (const child of node.children || []) {
    if (child.pageType === 'gallery' && !child.metadata?.hidden) {
      const images = Array.isArray(child.metadata?.images)
        ? (child.metadata.images as { file: string }[])
        : [];
      if (images.length > 0 && images[0].file) {
        return images[0].file;
      }
    }
    // 遞迴搜尋
    const found = findFirstThumb(child);
    if (found) return found;
  }
  return null;
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
  const [divisionPage, setDivisionPage] = useState<Page | null>(null);
  const [subcatPage, setSubcatPage] = useState<Page | null>(null);

  // Tree
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);

  // Homepage blocks
  const [homepageBlocks, setHomepageBlocks] = useState<HomepageBlock[]>([]);
  const [contentReady, setContentReady] = useState(false);
  const bootMountTime = useRef(Date.now());
  const bootFired = useRef(false);

  // Spoiler
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [spoilerWarning, setSpoilerWarning] = useState<{
    id: string;
    level: number;
    gate: string;
    onConfirm: () => void;
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
    () =>
      (typeof localStorage !== 'undefined' &&
        localStorage.getItem('uep-theme')) ||
      'dark'
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // 十字路口 hover 追蹤
  const [crossroadHover, setCrossroadHover] = useState<string | null>(null);

  // Corridor 索引
  const [corridorIdx, setCorridorIdx] = useState(0);

  // 滾動位置記憶 — key 是 view state 的標識
  const scrollMemory = useRef<Map<string, number>>(new Map());
  const pendingScrollKey = useRef<string | null>(null);

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
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void fetchTree();
    void fetchHomepage();
    const t = setTimeout(() => setContentReady(true), 5000);
    return () => clearTimeout(t);
  }, [fetchTree, fetchHomepage]);

  useEffect(() => {
    if (!treeLoading && !bootFired.current) {
      bootFired.current = true;
      const elapsed = Date.now() - bootMountTime.current;
      const delay = Math.max(0, 1800 - elapsed);
      setTimeout(() => setContentReady(true), delay);
    }
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
  }, [tree]);

  // === Navigation ===
  function pushUrl(params: Record<string, string>) {
    const url = new URL(window.location.href);
    url.search = '';
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    window.history.pushState({}, '', url.toString());
  }

  /** 建立目前 view 的 scroll key */
  function currentScrollKey(): string {
    if (view === 'gallery' && activeGalleryId)
      return `gallery:${activeGalleryId}`;
    if (view === 'subcat' && activeSubcatId) return `subcat:${activeSubcatId}`;
    if (view === 'division' && activeDivisionId)
      return `division:${activeDivisionId}`;
    return 'landing';
  }

  /** 離開目前頁面前保存滾動位置 */
  function saveScroll() {
    if (scrollRef.current) {
      scrollMemory.current.set(currentScrollKey(), scrollRef.current.scrollTop);
    }
  }

  /** 標記需要恢復的滾動位置 key（實際恢復在 useEffect 中執行） */
  function restoreScroll(key: string) {
    pendingScrollKey.current = key;
  }

  // 在 React re-render 後實際恢復滾動位置
  useEffect(() => {
    if (!pendingScrollKey.current) return;
    const key = pendingScrollKey.current;
    pendingScrollKey.current = null;
    // 雙層 rAF 確保 DOM 已完成 paint（含 key 變化導致的 remount）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const saved = scrollMemory.current.get(key);
        if (saved != null && saved > 0) {
          scrollRef.current?.scrollTo({ top: saved });
        } else {
          scrollRef.current?.scrollTo({ top: 0 });
        }
      });
    });
  }, [view, activeDivisionId, activeSubcatId, activeGalleryId]);

  function navigateToLanding(push = true) {
    saveScroll();
    setView('landing');
    setActiveDivisionId(null);
    setActiveSubcatId(null);
    setActiveGalleryId(null);
    setGalleryPage(null);
    setDivisionPage(null);
    setSubcatPage(null);
    restoreScroll('landing');
    if (push) {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.pushState({}, '', url.toString());
    }
  }

  async function navigateToDivision(divId: string, push = true) {
    saveScroll();
    setView('division');
    setActiveDivisionId(divId);
    setActiveSubcatId(null);
    setActiveGalleryId(null);
    setGalleryPage(null);
    setDivisionPage(null);
    setSubcatPage(null);
    restoreScroll(`division:${divId}`);
    if (push) pushUrl({ division: divId });
    // 載入 division 頁面內容
    const divNode = findDivisionNode(tree, divId);
    if (divNode) {
      try {
        const slug = divNode.id.replace('visuals/', '');
        const res = await fetch(`${API_BASE}/api/content/visuals/${slug}`);
        if (res.ok) {
          const json = await res.json();
          if (json.ok) setDivisionPage(json.data);
        }
      } catch {
        /* ignore */
      }
    }
  }

  async function navigateToSubcat(subcatId: string, groupIdx = 0, push = true) {
    saveScroll();
    const subcatChanged = subcatId !== activeSubcatId;
    setView('subcat');
    setActiveSubcatId(subcatId);
    setActiveGroupIdx(groupIdx);
    setActiveGalleryId(null);
    setGalleryPage(null);
    const divDef = findParentDivision(tree, subcatId);
    if (divDef) setActiveDivisionId(divDef.id);
    restoreScroll(`subcat:${subcatId}`);
    if (push) pushUrl({ subcat: subcatId, group: String(groupIdx) });
    // 只在切換到不同 subcat 時 fetch
    if (subcatChanged) {
      setSubcatPage(null);
      const subcatNode = findNodeById(tree, subcatId);
      if (subcatNode) {
        try {
          const slug = subcatNode.id.replace('visuals/', '');
          const res = await fetch(`${API_BASE}/api/content/visuals/${slug}`);
          if (res.ok) {
            const json = await res.json();
            if (json.ok) setSubcatPage(json.data);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function navigateToGallery(pageId: string, push = true) {
    saveScroll();
    setView('gallery');
    setActiveGalleryId(pageId);
    setCorridorIdx(0);
    const divDef = findParentDivision(tree, pageId);
    if (divDef) setActiveDivisionId(divDef.id);
    restoreScroll(`gallery:${pageId}`);
    if (push) pushUrl({ page: pageId });
    // Fetch page
    try {
      const slug = pageId.replace('visuals/', '');
      const res = await fetch(`${API_BASE}/api/content/visuals/${slug}`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok) setGalleryPage(json.data);
    } catch {
      /* ignore */
    }
  }

  // === Spoiler unlock ===
  function requestUnlock(
    id: string,
    level: number,
    gate: string,
    onConfirm: () => void
  ) {
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

  // === 十字路口道路 SVG ===
  function renderCrossroadSvg() {
    const cx = 50,
      cy = 50;
    const rw = 2; // 路寬（半邊）
    // 路線終點 — 在卡片邊緣前停住（不穿透卡片）
    const ends = {
      fwd: { x: cx, y: 18 },
      bck: { x: cx, y: 82 },
      lft: { x: 18, y: cy },
      rgt: { x: 82, y: cy },
    };
    const dirs = ['fwd', 'lft', 'rgt', 'bck'] as const;
    // 引導線長度（中心到終點的距離）
    const guideLen = 34;

    return (
      <svg
        className="visuals-crossroad-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          {dirs.map((d) => {
            const e = ends[d];
            const isV = d === 'fwd' || d === 'bck';
            // 漸層方向：從中心向終點方向
            return (
              <radialGradient
                key={`g-${d}`}
                id={`glow-${d}`}
                cx={`${e.x}%`}
                cy={`${e.y}%`}
                r={isV ? '12%' : '12%'}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#9F86C0" stopOpacity="0.9" />
                <stop offset="60%" stopColor="#9F86C0" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#9F86C0" stopOpacity="0" />
              </radialGradient>
            );
          })}
        </defs>

        {/* 道路邊線 + 中線 */}
        {dirs.map((d) => {
          const e = ends[d];
          const isV = d === 'fwd' || d === 'bck';
          return (
            <g key={`road-${d}`}>
              {isV ? (
                <>
                  <line
                    x1={cx - rw}
                    y1={cy}
                    x2={e.x - rw}
                    y2={e.y}
                    className="visuals-road-edge"
                  />
                  <line
                    x1={cx + rw}
                    y1={cy}
                    x2={e.x + rw}
                    y2={e.y}
                    className="visuals-road-edge"
                  />
                  <line
                    x1={cx}
                    y1={cy}
                    x2={e.x}
                    y2={e.y}
                    className="visuals-road-center"
                  />
                </>
              ) : (
                <>
                  <line
                    x1={cx}
                    y1={cy - rw}
                    x2={e.x}
                    y2={e.y - rw}
                    className="visuals-road-edge"
                  />
                  <line
                    x1={cx}
                    y1={cy + rw}
                    x2={e.x}
                    y2={e.y + rw}
                    className="visuals-road-edge"
                  />
                  <line
                    x1={cx}
                    y1={cy}
                    x2={e.x}
                    y2={e.y}
                    className="visuals-road-center"
                  />
                </>
              )}
            </g>
          );
        })}

        {/* 路盡頭微光 */}
        {dirs.map((d) => (
          <circle
            key={`glow-${d}`}
            className="visuals-road-glow"
            data-dir={d}
            cx={ends[d].x}
            cy={ends[d].y}
            r={6}
            fill={`url(#glow-${d})`}
          />
        ))}

        {/* Hover 引導線 — 從中心繪製出來 */}
        {dirs.map((d) => (
          <line
            key={`guide-${d}`}
            className="visuals-road-guide"
            data-dir={d}
            x1={cx}
            y1={cy}
            x2={ends[d].x}
            y2={ends[d].y}
            strokeDasharray={guideLen}
            strokeDashoffset={guideLen}
          />
        ))}
      </svg>
    );
  }

  // === Render helpers ===
  const activeDivision =
    DIVISIONS.find((d) => d.id === activeDivisionId) || null;

  // ─── RENDER: Landing ───
  function renderLanding() {
    // 資料驅動模式：有 homepage blocks 時使用
    if (homepageBlocks.length > 0) {
      return (
        <div className="visuals-landing-page">
          {homepageBlocks.map((block) => {
            switch (block.type) {
              case 'zone-header': {
                const d = block.data as ZoneHeaderData;
                return (
                  <div key={block.id}>
                    <div className="visuals-landing-kicker">
                      Volume III · VISUALS
                    </div>
                    <h1 className="visuals-landing-title">{d.title}</h1>
                    {d.subtitle && (
                      <div className="visuals-landing-subtitle">
                        {d.subtitle}
                      </div>
                    )}
                  </div>
                );
              }
              case 'uep-dialogue': {
                const items = block.data as UepDialogueItem[];
                return (
                  <div key={block.id} className="visuals-landing-uep">
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
              case 'cross-road-grid': {
                const { roads } = block.data as { roads: CrossRoad[] };
                return (
                  <div
                    key={block.id}
                    className="visuals-crossroad"
                    data-hover={crossroadHover || undefined}
                    onMouseLeave={() => setCrossroadHover(null)}
                  >
                    {renderCrossroadSvg()}
                    {/* 中央羅盤 */}
                    <div className="visuals-crossroad-center">
                      <svg width={110} height={110} viewBox="0 0 110 110">
                        <circle
                          cx={55}
                          cy={55}
                          r={48}
                          fill="none"
                          stroke={ACCENT}
                          strokeOpacity={0.3}
                          strokeWidth={1}
                        />
                        <circle
                          cx={55}
                          cy={55}
                          r={36}
                          fill="none"
                          stroke={ACCENT}
                          strokeOpacity={0.15}
                          strokeWidth={0.5}
                          strokeDasharray="3 4"
                        />
                        <line
                          x1={55}
                          y1={7}
                          x2={55}
                          y2={103}
                          stroke={ACCENT}
                          strokeOpacity={0.4}
                          strokeWidth={0.5}
                        />
                        <line
                          x1={7}
                          y1={55}
                          x2={103}
                          y2={55}
                          stroke={ACCENT}
                          strokeOpacity={0.4}
                          strokeWidth={0.5}
                        />
                        <text
                          x={55}
                          y={59}
                          textAnchor="middle"
                          fill={ACCENT}
                          fontSize={18}
                          fontFamily="var(--font-display)"
                        >
                          ✦
                        </text>
                      </svg>
                    </div>
                    {/* 四個方向 */}
                    {roads.map((road) => {
                      const divMatch = road.href.match(/division=(\w+)/);
                      const divId = divMatch?.[1];
                      return (
                        <button
                          key={road.area}
                          className="visuals-crossroad-card"
                          data-area={road.area}
                          onClick={() => divId && navigateToDivision(divId)}
                          onMouseEnter={() => setCrossroadHover(road.area)}
                        >
                          <span className="visuals-crossroad-dir">
                            {road.dir}
                          </span>
                          <span className="visuals-crossroad-name">
                            {road.name}
                          </span>
                          <span className="visuals-crossroad-hint">
                            {road.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              }
              case 'rich-text': {
                const { html } = block.data as { html: string };
                return (
                  <div
                    key={block.id}
                    className="visuals-prose"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                );
              }
              default:
                return null;
            }
          })}
        </div>
      );
    }

    // Fallback：靜態十字路口
    return (
      <div className="visuals-landing-page">
        <div className="visuals-landing-kicker">Volume III · VISUALS</div>
        <h1 className="visuals-landing-title">幻影重現室</h1>
        <div className="visuals-landing-subtitle">
          畫作、插圖、視覺作品。半透明的人物像在水面盪漾。
        </div>

        <div className="visuals-landing-uep">
          {VISUALS_ZONE.uep.map((text, i) => (
            <UepDialogue
              key={i}
              side="left"
              effects={i === 0 ? ['shimmer', 'halo'] : []}
              text={text}
            />
          ))}
        </div>

        <div
          className="visuals-crossroad"
          data-hover={crossroadHover || undefined}
          onMouseLeave={() => setCrossroadHover(null)}
        >
          {renderCrossroadSvg()}
          <div className="visuals-crossroad-center">
            <svg width={110} height={110} viewBox="0 0 110 110">
              <circle
                cx={55}
                cy={55}
                r={48}
                fill="none"
                stroke={ACCENT}
                strokeOpacity={0.3}
                strokeWidth={1}
              />
              <circle
                cx={55}
                cy={55}
                r={36}
                fill="none"
                stroke={ACCENT}
                strokeOpacity={0.15}
                strokeWidth={0.5}
                strokeDasharray="3 4"
              />
              <line
                x1={55}
                y1={7}
                x2={55}
                y2={103}
                stroke={ACCENT}
                strokeOpacity={0.4}
                strokeWidth={0.5}
              />
              <line
                x1={7}
                y1={55}
                x2={103}
                y2={55}
                stroke={ACCENT}
                strokeOpacity={0.4}
                strokeWidth={0.5}
              />
              <text
                x={55}
                y={59}
                textAnchor="middle"
                fill={ACCENT}
                fontSize={18}
                fontFamily="var(--font-display)"
              >
                ✦
              </text>
            </svg>
          </div>
          {DIVISIONS.map((div, i) => {
            const areas = ['fwd', 'lft', 'rgt', 'bck'] as const;
            const dirs = ['前方', '左方', '右方', '後方'];
            return (
              <button
                key={div.id}
                className="visuals-crossroad-card"
                data-area={areas[i]}
                onClick={() => navigateToDivision(div.id)}
                onMouseEnter={() => setCrossroadHover(areas[i])}
              >
                <span className="visuals-crossroad-dir">{dirs[i]}</span>
                <span className="visuals-crossroad-name">{div.label}</span>
                <span className="visuals-crossroad-hint">
                  {div.intro.slice(0, 30)}...
                </span>
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

    // 展示風格：API metadata > DIVISIONS 硬編碼 > fallback
    const divLayout =
      (divisionPage?.metadata?.layout as string) || activeDivision.galleryStyle;

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
          <span className="visuals-division-header-icon">
            {activeDivision.icon}
          </span>
          <h2>{activeDivision.label}</h2>
        </div>
        <div className="visuals-division-stats">{subcats.length} 個子分類</div>
        <div className="visuals-gradient-divider" />

        {/* 內容：優先使用 API，fallback 到硬編碼 */}
        {divisionPage?.content && divisionPage.content.length > 0 ? (
          <div className="visuals-prose">
            {divisionPage.content
              .filter((b) => b.type === 'rich_text')
              .map((b) => (
                <div
                  key={b.id}
                  dangerouslySetInnerHTML={{ __html: b.content }}
                />
              ))}
          </div>
        ) : (
          <>
            <p className="visuals-narrative">
              <span className="visuals-drop-cap">
                {activeDivision.intro[0]}
              </span>
              {activeDivision.intro.slice(1)}
            </p>
            <UepDialogue
              side="left"
              effects={['shimmer', 'halo']}
              text={activeDivision.uepNote}
            />
          </>
        )}

        {/* Subcat — 依 division 風格渲染 */}
        {renderDivisionSubcats(divLayout, subcats)}

        {subcats.length === 0 && (
          <div className="visuals-empty">尚無子分類</div>
        )}

        <div className="visuals-back-bar">
          <button
            className="visuals-back-btn"
            onClick={() => navigateToLanding()}
          >
            ← 返回幻影重現室
          </button>
        </div>
      </div>
    );
  }

  // ─── RENDER: Subcat ───
  // ─── Division Subcat 風格渲染 ───
  function renderDivisionSubcats(style: string, subcats: PageTreeNode[]) {
    switch (style) {
      case 'corridor':
        return (
          <div className="visuals-div-corridor">
            <div className="visuals-div-corridor-axis" />
            {subcats.map((sc, i) => {
              const count = countGalleries(sc);
              const locked = sc.metadata?.locked === true;
              const side = i % 2 === 0 ? 'left' : 'right';
              return (
                <div
                  key={sc.id}
                  className={`visuals-div-corridor-slot visuals-div-corridor-slot--${side}`}
                >
                  <button
                    className="visuals-div-corridor-door"
                    onClick={() => !locked && navigateToSubcat(sc.id)}
                    disabled={locked}
                    style={
                      locked
                        ? { opacity: 0.35, cursor: 'not-allowed' }
                        : undefined
                    }
                  >
                    <div className="visuals-div-corridor-num">
                      {locked ? '🔒' : String(i + 1).padStart(2, '0')}
                    </div>
                    <div className="visuals-div-corridor-title">{sc.title}</div>
                    <div className="visuals-div-corridor-meta">
                      {locked ? 'sealed' : `${count} galleries`}
                    </div>
                  </button>
                  <div className="visuals-div-corridor-connector" />
                </div>
              );
            })}
          </div>
        );

      case 'museum':
        return (
          <div className="visuals-div-museum">
            {subcats.map((sc) => {
              const count = countGalleries(sc);
              const locked = sc.metadata?.locked === true;
              return (
                <button
                  key={sc.id}
                  className="visuals-div-museum-frame"
                  onClick={() => !locked && navigateToSubcat(sc.id)}
                  disabled={locked}
                  style={
                    locked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined
                  }
                >
                  <span className="visuals-div-museum-hook" />
                  <div className="visuals-div-museum-inner">
                    <div className="visuals-div-museum-ornament">❖</div>
                    <div className="visuals-div-museum-label">
                      「{locked ? '🔒 ' : ''}
                      {sc.title}」
                    </div>
                    <div className="visuals-div-museum-divider" />
                    <div className="visuals-div-museum-count">
                      {locked ? '— sealed —' : `${count} galleries`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        );

      case 'pinboard':
        return (
          <div className="visuals-div-pinboard">
            {subcats.map((sc, i) => {
              const count = countGalleries(sc);
              const locked = sc.metadata?.locked === true;
              // 用 sin/cos 產生自然的隨機傾斜與偏移（同 gallery pinboard）
              const rot = Math.sin(i * 2.34 + 0.7) * 6;
              const yOff = Math.cos(i * 1.87 + 0.3) * 6;
              return (
                <button
                  key={sc.id}
                  className="visuals-div-pinboard-note"
                  onClick={() => !locked && navigateToSubcat(sc.id)}
                  disabled={locked}
                  style={
                    {
                      '--note-rot': `${rot.toFixed(1)}deg`,
                      '--note-y': `${yOff.toFixed(1)}px`,
                      ...(locked
                        ? { opacity: 0.4, cursor: 'not-allowed' }
                        : {}),
                    } as React.CSSProperties
                  }
                >
                  <span className="visuals-div-pinboard-pin" />
                  <div className="visuals-div-pinboard-title">
                    {locked ? '🔒 ' : ''}
                    {sc.title}
                  </div>
                  <div className="visuals-div-pinboard-count">
                    {locked ? 'sealed' : `${count} galleries`}
                  </div>
                </button>
              );
            })}
          </div>
        );

      case 'pixel':
        return (
          <div className="visuals-div-gridpaper">
            <div className="visuals-div-gridpaper-cards">
              {subcats.map((sc) => {
                const count = countGalleries(sc);
                const locked = sc.metadata?.locked === true;
                return (
                  <button
                    key={sc.id}
                    className="visuals-div-gridpaper-card"
                    onClick={() => !locked && navigateToSubcat(sc.id)}
                    disabled={locked}
                    style={
                      locked
                        ? { opacity: 0.35, cursor: 'not-allowed' }
                        : undefined
                    }
                  >
                    <span className="visuals-div-gridpaper-icon">▦</span>
                    <span className="visuals-div-gridpaper-title">
                      {locked ? `[SEALED] ${sc.title}` : sc.title}
                    </span>
                    <span className="visuals-div-gridpaper-count">
                      {locked ? '—' : `${count} entries`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );

      default:
        return (
          <div className="visuals-gallery-card-grid">
            {subcats.map((sc) => {
              const count = countGalleries(sc);
              return (
                <button
                  key={sc.id}
                  className="visuals-gallery-card"
                  onClick={() => navigateToSubcat(sc.id)}
                >
                  <div
                    className="visuals-placeholder-art"
                    style={{
                      background: `linear-gradient(135deg, ${ACCENT}, #9F86C0)`,
                    }}
                  >
                    {sc.title.slice(0, 2)}
                  </div>
                  <div className="visuals-gallery-card-body">
                    <div className="visuals-gallery-card-title">{sc.title}</div>
                    <div className="visuals-gallery-card-meta">
                      {count} galleries
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        );
    }
  }

  // 拖曳切換群組
  const dragStartX = useRef<number | null>(null);

  function handleViewerPointerDown(e: React.PointerEvent) {
    dragStartX.current = e.clientX;
  }

  function handleViewerPointerUp(e: React.PointerEvent, groupCount: number) {
    if (dragStartX.current === null) return;
    const dx = e.clientX - dragStartX.current;
    dragStartX.current = null;
    const threshold = 60;
    if (dx < -threshold && activeGroupIdx < groupCount - 1) {
      navigateToSubcat(activeSubcatId!, activeGroupIdx + 1);
    } else if (dx > threshold && activeGroupIdx > 0) {
      navigateToSubcat(activeSubcatId!, activeGroupIdx - 1);
    }
  }

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
    const safeGroupIdx = Math.min(
      activeGroupIdx,
      Math.max(0, groupList.length - 1)
    );
    const currentGroup = groupList[safeGroupIdx] || '全部';
    const currentGalleries = groupMap.get(currentGroup) || galleries;
    const maxIdx = Math.max(0, groupList.length - 1);

    return (
      <div className="visuals-subcat-page">
        {/* Breadcrumb */}
        <div className="visuals-breadcrumb">
          <button onClick={() => navigateToLanding()}>幻影重現室</button>
          <span className="visuals-breadcrumb-sep">/</span>
          <button
            onClick={() =>
              activeDivision && navigateToDivision(activeDivision.id)
            }
          >
            {activeDivision?.label || '...'}
          </button>
          <span className="visuals-breadcrumb-sep">/</span>
          <span>{subcatNode.title}</span>
        </div>

        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 36,
            fontWeight: 600,
            color: 'var(--ink-title)',
            margin: '8px 0 4px',
            textAlign: 'center',
          }}
        >
          {subcatNode.title}
        </h2>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--ink-mute)',
            letterSpacing: '0.16em',
            textAlign: 'center',
          }}
        >
          {galleries.length} galleries · {groupList.length} groups
        </div>
        <div className="visuals-gradient-divider" />

        {/* 富文本內容（來自編輯器） */}
        {subcatPage?.content && subcatPage.content.length > 0 && (
          <div className="visuals-prose visuals-subcat-intro">
            {subcatPage.content
              .filter((b) => b.type === 'rich_text')
              .map((b) => (
                <div
                  key={b.id}
                  dangerouslySetInnerHTML={{ __html: b.content }}
                />
              ))}
          </div>
        )}

        {/* 群組檢視器 */}
        <div className="visuals-viewer">
          {/* 導航列 — 只顯示群組名和計數 */}
          <div className="visuals-viewer-nav">
            <div className="visuals-viewer-label">
              <div className="visuals-viewer-group-name">{currentGroup}</div>
              <div className="visuals-viewer-group-counter">
                {groupList.length > 0
                  ? `${safeGroupIdx + 1} / ${groupList.length}`
                  : '—'}
              </div>
            </div>
          </div>

          {/* 內容區 — 箭頭浮在兩側 */}
          <div
            className="visuals-viewer-body"
            onPointerDown={handleViewerPointerDown}
            onPointerUp={(e) => handleViewerPointerUp(e, groupList.length)}
          >
            {groupList.length > 1 && (
              <button
                className="visuals-viewer-side-arrow is-left"
                disabled={safeGroupIdx <= 0}
                onClick={(e) => {
                  e.stopPropagation();
                  navigateToSubcat(activeSubcatId!, safeGroupIdx - 1);
                }}
              >
                <svg width="20" height="36" viewBox="0 0 20 36" fill="none">
                  <polyline
                    points="16,2 4,18 16,34"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}

            {currentGalleries.length === 0 ? (
              <div className="visuals-empty">此分組尚無畫廊</div>
            ) : (
              <div className="visuals-gallery-card-grid">
                {currentGalleries.map((g) => {
                  const images = Array.isArray(g.metadata?.images)
                    ? (g.metadata.images as ImageItem[])
                    : [];
                  const spoiler = (g.metadata?.spoilerLevel as number) || 0;
                  const gate = (g.metadata?.gate as string) || '';
                  const firstImg = images.length > 0 ? images[0] : null;
                  const thumbUrl = firstImg ? buildImageUrl(firstImg.file) : '';
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

                  // 精靈圖縮圖：顯示第一個動畫的第一幀
                  const isSpriteThumb =
                    firstImg?.isSpriteSheet &&
                    firstImg.frameWidth &&
                    firstImg.frameHeight &&
                    firstImg.columns;

                  return (
                    <button
                      key={g.id}
                      className="visuals-gallery-card"
                      onClick={handleClick}
                    >
                      {thumbUrl && isSpriteThumb ? (
                        (() => {
                          const cols = firstImg.columns!;
                          const rows =
                            firstImg.rows ||
                            Math.ceil((firstImg.frameCount || 1) / cols);
                          const anims = firstImg.animations || {};
                          const animKeys = Object.keys(anims);
                          // 取第一個動畫的起始幀
                          const startFrame =
                            animKeys.length > 0 ? anims[animKeys[0]][0] : 0;
                          const frameCol = startFrame % cols;
                          const frameRow = Math.floor(startFrame / cols);
                          // 百分比定位：讓每幀正好填滿容器寬度
                          const bgPosX =
                            cols > 1 ? (frameCol / (cols - 1)) * 100 : 0;
                          const bgPosY =
                            rows > 1 ? (frameRow / (rows - 1)) * 100 : 0;
                          return (
                            <div
                              className="visuals-gallery-card-thumb visuals-sprite-thumb"
                              role="img"
                              aria-label={g.title}
                              style={{
                                backgroundImage: `url(${thumbUrl})`,
                                backgroundSize: `${cols * 100}% auto`,
                                backgroundPosition: `${bgPosX}% ${bgPosY}%`,
                                backgroundRepeat: 'no-repeat',
                                imageRendering: 'pixelated',
                                filter: isLocked
                                  ? spoilerFilter(spoiler)
                                  : 'none',
                              }}
                            />
                          );
                        })()
                      ) : thumbUrl ? (
                        <img
                          className="visuals-gallery-card-thumb"
                          src={thumbUrl}
                          alt={g.title}
                          style={{
                            filter: isLocked ? spoilerFilter(spoiler) : 'none',
                          }}
                        />
                      ) : (
                        <div
                          className="visuals-placeholder-art"
                          style={{
                            background: `linear-gradient(135deg, ${ACCENT}, #9F86C0)`,
                          }}
                        >
                          {g.title.slice(0, 2)}
                        </div>
                      )}
                      <div className="visuals-gallery-card-body">
                        <div className="visuals-gallery-card-title">
                          {g.title}
                        </div>
                        <div className="visuals-gallery-card-meta">
                          {images.length} 張圖片
                          {spoiler > 0 && (
                            <span
                              style={{
                                color: spoiler === 3 ? 'crimson' : 'goldenrod',
                                marginLeft: 8,
                              }}
                            >
                              L{spoiler}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {groupList.length > 1 && (
              <button
                className="visuals-viewer-side-arrow is-right"
                disabled={safeGroupIdx >= maxIdx}
                onClick={(e) => {
                  e.stopPropagation();
                  navigateToSubcat(activeSubcatId!, safeGroupIdx + 1);
                }}
              >
                <svg width="20" height="36" viewBox="0 0 20 36" fill="none">
                  <polyline
                    points="4,2 16,18 4,34"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="visuals-back-bar">
          <button
            className="visuals-back-btn"
            onClick={() =>
              activeDivision && navigateToDivision(activeDivision.id)
            }
          >
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
    const images: ImageItem[] = Array.isArray(meta.images)
      ? (meta.images as ImageItem[])
      : [];
    // 優先使用 gallery 自身的 layout，再 fallback 到 division 的 metadata/硬編碼
    const style =
      (meta.layout as string) ||
      (divisionPage?.metadata?.layout as string) ||
      activeDivision?.galleryStyle ||
      'museum';

    return (
      <div className="visuals-gallery-page">
        {/* Breadcrumb */}
        <div className="visuals-breadcrumb">
          <button onClick={() => navigateToLanding()}>幻影重現室</button>
          <span className="visuals-breadcrumb-sep">/</span>
          <button
            onClick={() =>
              activeDivision && navigateToDivision(activeDivision.id)
            }
          >
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
          <div className="visuals-landing-kicker">
            {activeDivision?.labelEn}
          </div>
          <h2>{galleryPage.title}</h2>
          <div className="visuals-gallery-count">{images.length} pieces</div>
        </div>
        <div className="visuals-gradient-divider" />

        {images.length === 0 ? (
          <div className="visuals-empty">此畫廊尚無圖片</div>
        ) : (
          renderGalleryByStyle(style, images)
        )}

        <div className="visuals-back-bar">
          <button
            className="visuals-back-btn"
            onClick={() =>
              activeSubcatId
                ? navigateToSubcat(activeSubcatId)
                : activeDivision
                  ? navigateToDivision(activeDivision.id)
                  : navigateToLanding()
            }
          >
            ← 返回
          </button>
        </div>
      </div>
    );
  }

  // ─── Gallery Styles ───
  function renderGalleryByStyle(style: string, images: ImageItem[]) {
    switch (style) {
      case 'corridor':
        return renderCorridor(images);
      case 'museum':
        return renderMuseum(images);
      case 'pinboard':
        return renderPinboard(images);
      case 'pixel':
        return renderPixel(images);
      case 'sprite':
        return renderSprite(images);
      default:
        return renderMuseum(images);
    }
  }

  function renderCorridor(images: ImageItem[]) {
    const art = images[corridorIdx] || images[0];
    if (!art) return null;
    const prev = () =>
      setCorridorIdx((corridorIdx - 1 + images.length) % images.length);
    const next = () => setCorridorIdx((corridorIdx + 1) % images.length);

    return (
      <div className="visuals-gallery-corridor">
        <div className="visuals-corridor-stage">
          <button className="visuals-corridor-arrow" onClick={prev}>
            ‹
          </button>
          <div
            className="visuals-corridor-main"
            onClick={() => openLightbox(images, corridorIdx)}
          >
            <img src={buildImageUrl(art.file)} alt={art.caption || ''} />
            <div className="visuals-gallery-hover-overlay">
              <span className="visuals-gallery-hover-icon">⤢</span>
            </div>
          </div>
          <button className="visuals-corridor-arrow" onClick={next}>
            ›
          </button>
        </div>
        <div className="visuals-corridor-caption">
          <div className="visuals-corridor-counter">
            {String(corridorIdx + 1).padStart(2, '0')} /{' '}
            {String(images.length).padStart(2, '0')}
          </div>
          <div className="visuals-corridor-title">
            {art.caption || galleryPage?.title}
          </div>
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
          <div
            key={art.id}
            className="visuals-museum-frame"
            onClick={() => openLightbox(images, i)}
          >
            <div className="visuals-gallery-img-container">
              <img src={buildImageUrl(art.file)} alt={art.caption || ''} />
              <div className="visuals-gallery-hover-overlay">
                <span className="visuals-gallery-hover-icon">⤢</span>
              </div>
            </div>
            <div className="visuals-museum-label">
              「{art.caption || '無題'}」
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderPinboard(images: ImageItem[]) {
    return (
      <div className="visuals-gallery-pinboard">
        {images.map((art, i) => {
          // 用 sin 函式產生更自然的隨機傾斜角度（±7°）
          const rot = Math.sin(i * 2.34 + 0.7) * 7;
          // 輕微的垂直偏移讓排列更有散落感
          const yOff = Math.cos(i * 1.87 + 0.3) * 8;
          return (
            <div
              key={art.id}
              className="visuals-pinboard-card"
              style={
                {
                  '--pin-rot': `${rot.toFixed(1)}deg`,
                  '--pin-y': `${yOff.toFixed(1)}px`,
                } as React.CSSProperties
              }
              onClick={() => openLightbox(images, i)}
            >
              <span className="visuals-pinboard-pin" />
              <div className="visuals-pinboard-photo">
                <img src={buildImageUrl(art.file)} alt={art.caption || ''} />
                <div className="visuals-gallery-hover-overlay">
                  <span className="visuals-gallery-hover-icon">⤢</span>
                </div>
              </div>
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
          <div
            key={art.id}
            className="visuals-pixel-cell"
            onClick={() => openLightbox(images, i)}
          >
            <div className="visuals-gallery-img-container is-pixel">
              <img src={buildImageUrl(art.file)} alt={art.caption || ''} />
              <div className="visuals-gallery-hover-overlay">
                <span className="visuals-gallery-hover-icon">⤢</span>
              </div>
            </div>
            <div className="visuals-pixel-label">
              {art.caption || art.file.split('/').pop()}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ─── RENDER: Sprite ───
  function renderSprite(images: ImageItem[]) {
    const sprite = images.find((img) => img.isSpriteSheet);
    if (!sprite) return renderMuseum(images);
    return (
      <SpriteViewer
        sprite={sprite}
        spriteUrl={buildImageUrl(sprite.file)}
        onOpenLightbox={() => openLightbox(images, images.indexOf(sprite))}
      />
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
        <div
          className="visuals-lightbox-inner"
          onClick={(e) => e.stopPropagation()}
        >
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
      <div
        className="visuals-spoiler-dialog"
        onClick={() => setSpoilerWarning(null)}
      >
        <div
          className="visuals-spoiler-dialog-inner"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="visuals-spoiler-dialog-title">
            ⚠ SPOILER WARNING · LEVEL {spoilerWarning.level}
          </div>
          <div className="visuals-spoiler-dialog-gate">
            {spoilerWarning.gate || '此內容包含劇透，確定要繼續嗎？'}
          </div>
          <div className="visuals-spoiler-dialog-actions">
            <button
              className="visuals-spoiler-dialog-confirm"
              onClick={confirmUnlock}
            >
              我已知情，繼續
            </button>
            <button
              className="visuals-spoiler-dialog-cancel"
              onClick={() => setSpoilerWarning(null)}
            >
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
      {/* 入場動畫 — 幻影閃現 */}
      <div className={`vis-boot ${contentReady ? 'is-ready' : ''}`} aria-hidden="true">
        <div className="vis-boot-flash vis-boot-flash--l" />
        <div className="vis-boot-flash vis-boot-flash--r" />
        <div className="vis-boot-flash vis-boot-flash--l2" />
        <div className="vis-boot-flash vis-boot-flash--r2" />
        <div className="vis-boot-grain" />
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

      <div className="visuals-main">
        <ZoneAtmosphere zone={VISUALS_ZONE} intensity="subtle" skipGlyphs />
        <div className="visuals-content" ref={scrollRef}>
          <VisualsPhantom
            variant={
              (view === 'landing'
                ? 'landing'
                : (activeDivisionId ?? 'landing')) as PhantomVariant
            }
          />
          <div
            key={`${view}-${activeDivisionId}-${activeSubcatId}-${activeGalleryId}`}
            className="visuals-view-animate"
          >
            {view === 'landing' && renderLanding()}
            {view === 'division' && renderDivision()}
            {view === 'subcat' && renderSubcat()}
            {view === 'gallery' && renderGallery()}
          </div>
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
            setTimeout(() => {
              window.location.href = `/${z.slug}`;
            }, 1100);
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

      <PortalTransition zone={portalZone} onDone={() => setPortalZone(null)} />
      <PortalTransition
        zone={null}
        homeMode={homePortal}
        onDone={() => setHomePortal(false)}
      />
    </div>
  );
}
