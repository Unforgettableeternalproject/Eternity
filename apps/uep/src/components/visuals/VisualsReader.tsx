/* eslint-disable @typescript-eslint/no-unused-vars */
/* global AbortController */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ZONES } from '../../data/zones';
import {
  canMirrorGallery,
  completeUnlockRitual,
  getIslandRuntime,
  pushPhantomGallery,
  shouldMountIsland,
  triggerHistoryRelated,
  useDesktopIslandViewport,
  useEntityDragSource,
  useUnlockEligibility,
} from '../../islands';
import { getApiBase } from '../../lib/apiBase';
import { canonicalizePagePath } from '../../lib/pagePath';
import { useProgress, buildProgressTreeAdapter } from '../../progress';
import { resolveGalleryImages } from '../../visuals';
import type { ResolvedGalleryImage } from '../../visuals';
import type { ImageItem, VisualsData } from '../editor/VisualsEditorBody';
import type {
  HomepageBlock,
  ZoneHeaderData,
  UepDialogueItem,
  CrossRoad,
} from '../editor/homepage/types';
import { fromContentBlock } from '../editor/homepage/types';
import UepDialogue from '../ui/UepDialogue';
import ZoneAtmosphere from '../ui/ZoneAtmosphere';
import renderHtmlWithUep from '../ui/renderHtmlWithUep';
import { ReaderShell } from '../zone/ReaderShell';
import { ZoneBreadcrumb } from '../zone/ZoneBreadcrumb';
import ZoneHomepageRenderer from '../zone/ZoneHomepageRenderer';
import { ZoneStateDisplay } from '../zone/ZoneStateDisplay';
import VisualsPhantomCard from './VisualsPhantomCard';
import { shouldRevealPhantomCard } from './phantomCardRoll';
import type { GroupSlot } from './phantomCardRoll';
import { isHidden, isLocked } from '../zone/contentVisibility';
import { useScrollMemory } from '../zone/useScrollMemory';
import { useZoneBootReady } from '../zone/useZoneBootReady';
import { useZoneRouter, pushUrl, clearUrl } from '../zone/useZoneRouter';

import SpriteViewer from './SpriteViewer';
import VisualsPhantom, { resolvePhantomVariant } from './VisualsPhantom';
import { isGalleryUnlockedInZone } from './visualsVisibility';

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
const API_BASE = getApiBase();

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

/**
 * 把 subcat 底下的 gallery 依 `metadata.group` 分桶。
 *
 * 抽成檔案層級函式是為了讓元件頂層也算得到「這個 subcat 有幾個分組」——
 * S9-B 的解鎖儀式只在**兩個以上分組**的區塊觸發，而那個判定要在 effect 裡
 * 用，不能只活在 renderSubcat 的區域變數裡。
 */
function buildGalleryGroups(subcatNode: PageTreeNode): {
  galleries: PageTreeNode[];
  groupMap: Map<string, PageTreeNode[]>;
  groupList: string[];
} {
  const galleries = (subcatNode.children || [])
    .filter((c) => c.pageType === 'gallery' && !isHidden(c))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const groupMap = new Map<string, PageTreeNode[]>();
  for (const g of galleries) {
    const group = (g.metadata?.group as string) || '全部';
    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group)!.push(g);
  }
  return { galleries, groupMap, groupList: [...groupMap.keys()] };
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
  if (node.pageType === 'gallery' && !isHidden(node)) count++;
  for (const c of node.children || []) count += countGalleries(c);
  return count;
}

/** 從 subcategory 中找到第一張可用的縮圖 URL */
function findFirstThumb(node: PageTreeNode): string | null {
  for (const child of node.children || []) {
    if (child.pageType === 'gallery' && !isHidden(child)) {
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

// ── 三態解鎖（S8 下半場 V-B.19；求值搬入 visuals/ 模組與浮島共用）──

/** 圖片 + 已求值的顯示狀態（renderer 與 lightbox 共用單位） */
type GalleryImageView = ResolvedGalleryImage<ImageItem>;

/** A 鎖定佔位格——不載入實際圖片（劇透保護），格子存在讓總張數可見 */
function LockedImageCell({ label }: { label?: string }) {
  return (
    <div className="visuals-img-locked-cell" aria-label="尚未解鎖的圖片">
      <span className="visuals-img-locked-icon">⛉</span>
      <span className="visuals-img-locked-text">{label || 'LOCKED'}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Visuals Monologue Player — 獨白播放器（獨立元件，不依賴 AudioProvider）
// ──────────────────────────────────────────────────────────────
const VMONO_API_BASE = getApiBase();

function VisualsMonoPlayer({
  audioKey,
  title,
  subtitle,
}: {
  audioKey: string;
  title?: string;
  subtitle?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const isSeekingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekProg, setSeekProg] = useState<number | null>(null);
  const [volume, setVolumeState] = useState(() =>
    typeof window !== 'undefined'
      ? parseFloat(localStorage.getItem('uep-player-volume') ?? '0.6')
      : 0.6
  );

  const audioUrl = `${VMONO_API_BASE}/api/assets/${audioKey
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

  useEffect(() => {
    const a = new Audio(audioUrl);
    a.preload = 'metadata';
    a.volume = volume;
    audioRef.current = a;

    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => {
      setIsPlaying(false);
      setProgress(1);
      cancelAnimationFrame(rafRef.current);
    };
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);

    return () => {
      cancelAnimationFrame(rafRef.current);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
      a.pause();
      a.src = '';
    };
  }, [audioUrl]);

  const updateProgress = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!isSeekingRef.current) {
      setCurrentTime(a.currentTime);
      setProgress(a.duration > 0 ? a.currentTime / a.duration : 0);
    }
    if (!a.paused) {
      rafRef.current = requestAnimationFrame(updateProgress);
    }
  }, []);

  const handlePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.pause();
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    } else {
      a.play()
        .then(() => {
          setIsPlaying(true);
          cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(updateProgress);
        })
        .catch(() => {});
    }
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const displayProg = seekProg ?? progress;

  return (
    <div className="visuals-mono-player">
      <div className="visuals-mono-player-meta">
        {title && <div className="visuals-mono-player-title">{title}</div>}
        {subtitle && <div className="visuals-mono-player-sub">{subtitle}</div>}
      </div>
      <div className="visuals-mono-player-controls">
        <button
          className={`visuals-mono-player-btn${isPlaying ? ' is-playing' : ''}`}
          onClick={handlePlay}
          type="button"
        >
          <span
            className={isPlaying ? 'vmono-icon-pause' : 'vmono-icon-play'}
          />
        </button>
        <div className="visuals-mono-player-bar">
          <div className="visuals-mono-player-track">
            <div
              className="visuals-mono-player-fill"
              style={{ width: `${displayProg * 100}%` }}
            />
            <div
              className="visuals-mono-player-thumb"
              style={{ left: `${displayProg * 100}%` }}
            />
          </div>
          <input
            type="range"
            className="visuals-mono-player-seek"
            min={0}
            max={1}
            step={0.001}
            value={displayProg}
            onPointerDown={() => {
              isSeekingRef.current = true;
              setSeekProg(displayProg);
            }}
            onChange={(e) => setSeekProg(parseFloat(e.target.value))}
            onPointerUp={(e) => {
              const val = parseFloat((e.target as HTMLInputElement).value);
              isSeekingRef.current = false;
              setSeekProg(null);
              const a = audioRef.current;
              if (a?.duration) {
                a.currentTime = val * a.duration;
                setProgress(val);
                setCurrentTime(val * a.duration);
              }
            }}
          />
          <div className="visuals-mono-player-times">
            <span>{fmtTime(currentTime)}</span>
            <span>{duration > 0 ? fmtTime(duration) : '--:--'}</span>
          </div>
        </div>
        <div className="visuals-mono-player-vol">
          <input
            type="range"
            className="visuals-mono-player-vol-slider"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (audioRef.current) audioRef.current.volume = v;
              localStorage.setItem('uep-player-volume', String(v));
              setVolumeState(v);
            }}
          />
        </div>
      </div>
    </div>
  );
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
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [divisionPage, setDivisionPage] = useState<Page | null>(null);
  const [subcatPage, setSubcatPage] = useState<Page | null>(null);

  // Tree
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);

  // 進度 + tree-aware gating 求值器（S8 下半場 V-A.14：Visuals 接入
  // 進度系統，一開始就走 effectiveGate——progressPage 鏈 + 父容器繼承）
  const progress = useProgress();
  // resize／裝置旋轉即時重渲染——映照按鈕守門同 IslandHost（S8 手動
  // 驗收 #9 追加修復：shouldMountIsland 內部的桌面寬度判定只在渲染
  // 當下同步讀值，viewport 變化不會自己觸發重渲染）
  const desktopViewport = useDesktopIslandViewport();
  const progressTree = useMemo(() => buildProgressTreeAdapter(tree), [tree]);

  // ── 解鎖儀式「不在目錄中的畫廊」（S9-B）──
  const visualsUnlock = useUnlockEligibility('visuals');
  /** 中獎的位置。null = 尚未中；不持久化，離開 subcat 或重整就沒了。 */
  const [phantomSlot, setPhantomSlot] = useState<GroupSlot | null>(null);
  /** 上一次停留的位置——用來分辨「切換標籤」與「換區塊／剛進來」 */
  const lastGroupSlotRef = useRef<GroupSlot | null>(null);
  /** 中獎狀態的鏡像：擲骰 effect 要讀它，但不能讓它進 deps（見下） */
  const phantomSlotRef = useRef<GroupSlot | null>(null);

  // 失去資格就把已浮現的假卡收掉（Codex 2026-07-25 review）。
  // 假卡一旦浮現就留在網格裡，中間登出／切成觀測者／視窗縮到手機寬度都不會
  // 讓它消失——resize 不 unmount Reader，那張過期的卡仍然直接可點。
  useEffect(() => {
    if (!visualsUnlock.eligible) {
      phantomSlotRef.current = null;
      setPhantomSlot(null);
    }
  }, [visualsUnlock.eligible]);

  /**
   * 位置變化時擲骰（規則見 phantomCardRoll.shouldRevealPhantomCard）。
   *
   * ⚠️ 換區塊的重置與擲骰**必須在同一個 effect**、且 `phantomSlot` 不可進
   * deps：拆成兩個 effect 時，重置的 setState 會讓擲骰 effect 再跑一輪，
   * 而那時 `lastGroupSlotRef` 已更新成新位置 → 判定成「原地沒動」而不擲。
   * 結果是「從中過獎的區塊換到新區塊」永遠擲不到骰。
   */
  useEffect(() => {
    const prev = lastGroupSlotRef.current;
    const current: GroupSlot | null = activeSubcatId
      ? { subcatId: activeSubcatId, groupIdx: activeGroupIdx }
      : null;
    lastGroupSlotRef.current = current;

    // 中獎位置不跨區塊，也不持久化
    const changedSubcat = prev?.subcatId !== current?.subcatId;
    if (changedSubcat && phantomSlotRef.current !== null) {
      phantomSlotRef.current = null;
      setPhantomSlot(null);
    }

    if (
      shouldRevealPhantomCard({
        prev,
        current,
        eligible: visualsUnlock.eligible,
        alreadyWon: phantomSlotRef.current !== null,
      })
    ) {
      phantomSlotRef.current = current;
      setPhantomSlot(current);
    }
  }, [activeSubcatId, activeGroupIdx, visualsUnlock.eligible]);

  const handlePhantomCardOpen = useCallback(() => {
    phantomSlotRef.current = null;
    setPhantomSlot(null);
    completeUnlockRitual('visuals');
  }, []);

  // Homepage blocks
  const [homepageBlocks, setHomepageBlocks] = useState<HomepageBlock[]>([]);
  const {
    contentReady,
    markContentReady,
    setNavPending: setBootNavPending,
  } = useZoneBootReady();

  // Lightbox（三態感知：A 不進 lightbox、B 放大仍遮罩）
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [lightboxItems, setLightboxItems] = useState<GalleryImageView[]>([]);
  const [lbZoom, setLbZoom] = useState(1);
  const [lbPan, setLbPan] = useState({ x: 0, y: 0 });
  const [lbClosing, setLbClosing] = useState(false);
  const lbClosingRef = useRef(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // 十字路口 hover 追蹤
  const [crossroadHover, setCrossroadHover] = useState<string | null>(null);

  // Corridor 索引
  const [corridorIdx, setCorridorIdx] = useState(0);

  // 滾動位置記憶
  const { saveScroll: saveScrollTo, restoreScroll: restoreScrollTo } =
    useScrollMemory(scrollRef, [
      view,
      activeDivisionId,
      activeSubcatId,
      activeGalleryId,
    ]);

  // 畫廊卡拖進展開的便條島 → 建立一張寫著該 entity 正名的便條
  const entityDrag = useEntityDragSource();

  /*
   * 停在某個畫廊時，讓 History 島浮出「這個畫廊相關的段落」。
   * 陳列走廊綁 entityKey、鑲框室綁 storyKey，兩者互斥，取有值的那個。
   */
  useEffect(() => {
    if (!activeGalleryId) return;
    const node = findNodeById(tree, activeGalleryId);
    if (!node) return;
    const metadata = (node.metadata ?? {}) as Record<string, unknown>;
    const storyKey =
      typeof metadata.storyKey === 'string' ? metadata.storyKey.trim() : '';
    const entityKey =
      typeof metadata.entityKey === 'string' ? metadata.entityKey.trim() : '';
    const key = storyKey || entityKey;
    if (!key) return;

    const controller = new AbortController();
    void triggerHistoryRelated({
      apiBase: API_BASE,
      sourceZone: 'visuals',
      keyType: storyKey ? 'story' : 'entity',
      key,
      label: node.title,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [activeGalleryId, tree]);

  // === Fetch tree ===
  const fetchTree = useCallback(async () => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const res = await fetch(`${API_BASE}/api/content/visuals/tree`);
      if (!res.ok) {
        setTreeError(`伺服器回應異常 (${res.status})`);
        return;
      }
      const json = await res.json();
      if (json.ok) setTree(json.data || []);
    } catch (err) {
      console.error('fetchTree error:', err);
      setTreeError(err instanceof Error ? err.message : String(err));
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
  }, [fetchTree, fetchHomepage]);

  useEffect(() => {
    if (!treeLoading) {
      markContentReady();
    }
  }, [treeLoading, markContentReady]);

  // === URL 路由（useZoneRouter 統一管理 deep link 與 popstate）===
  useZoneRouter({
    routes: [
      {
        param: 'page',
        handler: (value) => {
          // 統一用 slug（不帶 area prefix），向後相容帶 prefix 的舊連結
          const fullId = canonicalizePagePath(
            value.startsWith('visuals/') ? value : ['visuals', value].join('/')
          );
          navigateToGallery(fullId, false);
        },
      },
      {
        param: 'subcat',
        handler: (value) => {
          const fullId = canonicalizePagePath(
            value.startsWith('visuals/') ? value : ['visuals', value].join('/')
          );
          const group = new URLSearchParams(window.location.search).get(
            'group'
          );
          navigateToSubcat(fullId, group ? parseInt(group, 10) : 0, false);
        },
      },
      {
        param: 'division',
        handler: (value) => {
          const fullId = canonicalizePagePath(
            value.startsWith('visuals/') ? value : ['visuals', value].join('/')
          );
          navigateToDivision(fullId, false);
        },
      },
    ],
    onLanding: () => navigateToLanding(false),
    treeReady: !treeLoading && tree.length > 0,
    setBootNavPending: setBootNavPending,
  });

  // === Navigation ===
  function currentScrollKey(): string {
    if (view === 'gallery' && activeGalleryId)
      return `gallery:${activeGalleryId}`;
    if (view === 'subcat' && activeSubcatId) return `subcat:${activeSubcatId}`;
    if (view === 'division' && activeDivisionId)
      return `division:${activeDivisionId}`;
    return 'landing';
  }

  function saveScroll() {
    saveScrollTo(currentScrollKey());
  }

  function restoreScroll(key: string) {
    restoreScrollTo(key);
  }

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
    if (push) clearUrl();
  }

  async function navigateToDivision(divId: string, push = true) {
    saveScroll();
    // 深連結／popstate 會傳完整路徑（visuals/profiles），統一正規化為裸分館 id，
    // 讓 activeDivision 查找、scroll key 與 Phantom variant 都拿到一致的值
    const defId = divId.replace(/^visuals\//, '');
    setView('division');
    setActiveDivisionId(defId);
    setActiveSubcatId(null);
    setActiveGalleryId(null);
    setGalleryPage(null);
    setDivisionPage(null);
    setSubcatPage(null);
    restoreScroll(`division:${defId}`);
    if (push) pushUrl({ division: defId });
    // 載入 division 頁面內容
    const divNode = findDivisionNode(tree, defId);
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
    setBootNavPending(false);
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
    if (push)
      pushUrl({
        subcat: subcatId.replace(/^visuals\//, ''),
        group: String(groupIdx),
      });
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
    setBootNavPending(false);
  }

  /** gallery fetch 請求序號——快速切換時只有最新請求可落地 */
  const galleryFetchSeq = useRef(0);

  async function navigateToGallery(pageId: string, push = true) {
    saveScroll();
    setView('gallery');
    setActiveGalleryId(pageId);
    setCorridorIdx(0);
    // 先清上一頁資料——避免以新 gallery 的閘搭配舊 gallery 的內容渲染
    setGalleryPage(null);
    setGalleryError(null);
    const divDef = findParentDivision(tree, pageId);
    if (divDef) setActiveDivisionId(divDef.id);
    restoreScroll(`gallery:${pageId}`);
    if (push) pushUrl({ page: pageId.replace(/^visuals\//, '') });
    // hidden 完全不對前台公開（contentVisibility 契約）：不 fetch 內容，
    // renderGallery 依 tree node 呈「不存在」
    const node = findNodeById(tree, pageId);
    if (node && isHidden(node)) {
      setBootNavPending(false);
      return;
    }
    // Fetch page
    const seq = ++galleryFetchSeq.current;
    try {
      const slug = pageId.replace('visuals/', '');
      const res = await fetch(`${API_BASE}/api/content/visuals/${slug}`);
      if (seq !== galleryFetchSeq.current) return;
      if (!res.ok) {
        setGalleryError(`伺服器回應異常 (${res.status})`);
        return;
      }
      const json = await res.json();
      if (seq !== galleryFetchSeq.current) return;
      if (json.ok) setGalleryPage(json.data);
      else setGalleryError('畫廊資料載入失敗');
    } catch (err) {
      if (seq === galleryFetchSeq.current) {
        setGalleryError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBootNavPending(false);
    }
  }

  // === Lightbox ===
  /**
   * 開啟 lightbox：A 鎖定圖不可放大（點擊直接無效），
   * 且不進入導航序列（prev/next 不會落在鎖定圖上）。
   */
  function openLightbox(items: GalleryImageView[], clickedIdx: number) {
    const target = items[clickedIdx];
    if (!target || target.state === 'locked') return;
    const viewable = items.filter((it) => it.state !== 'locked');
    setLightboxItems(viewable);
    setLightboxIdx(viewable.indexOf(target));
    setLbZoom(1);
    setLbPan({ x: 0, y: 0 });
  }

  /** 無三態情境（精靈圖 gallery）沿用原始序列 */
  function openLightboxPlain(images: ImageItem[], idx: number) {
    openLightbox(
      images.map((img) => ({ img, state: 'unlocked' as const })),
      idx
    );
  }

  function closeLightbox() {
    if (lbClosingRef.current) return;
    lbClosingRef.current = true;
    setLbClosing(true);
    setTimeout(() => {
      setLightboxIdx(null);
      setLightboxItems([]);
      setLbClosing(false);
      lbClosingRef.current = false;
    }, 250);
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
      if (e.key === 'ArrowRight' && lightboxIdx < lightboxItems.length - 1) {
        setLightboxIdx(lightboxIdx + 1);
        setLbZoom(1);
        setLbPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIdx, lightboxItems.length]);

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
    // Tree 載入失敗時顯示錯誤
    if (treeError) {
      return (
        <div className="visuals-landing-page">
          <ZoneStateDisplay
            kind="error"
            message={treeError}
            onRetry={() => void fetchTree()}
            large
          />
        </div>
      );
    }

    // 資料驅動模式：有 homepage blocks 時使用
    if (homepageBlocks.length > 0) {
      return (
        <div className="visuals-landing-page">
          {homepageBlocks.map((block) => {
            if (block.hidden) return null;
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
                  <React.Fragment key={block.id}>
                    {renderHtmlWithUep(html, block.id, 'visuals-prose')}
                  </React.Fragment>
                );
              }
              case 'visuals-audio-block': {
                const ad = block.data as {
                  audioKey: string;
                  title?: string;
                  subtitle?: string;
                };
                if (!ad.audioKey) return null;
                return (
                  <div key={block.id} className="visuals-landing-audio">
                    <VisualsMonoPlayer
                      audioKey={ad.audioKey}
                      title={ad.title}
                      subtitle={ad.subtitle}
                    />
                  </div>
                );
              }
              default:
                return null;
            }
          })}
        </div>
      );
    }

    // homepage 區塊載入中（資料就緒後由上方資料驅動分支接手）
    return (
      <div className="visuals-landing-page">
        <ZoneStateDisplay
          kind="loading"
          message="正在讀取幻影重現室..."
          large
        />
      </div>
    );
  }

  // ─── RENDER: Division ───
  function renderDivision() {
    if (!activeDivision) return null;
    const divNode = findDivisionNode(tree, activeDivision.id);
    const subcats = (divNode?.children || [])
      .filter((c) => c.pageType === 'subcategory' && !isHidden(c))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // 展示風格：API metadata > DIVISIONS 硬編碼 > fallback
    const divLayout =
      (divisionPage?.metadata?.layout as string) || activeDivision.galleryStyle;

    return (
      <div className="visuals-division-page">
        <ZoneBreadcrumb
          segments={[
            { label: '幻影重現室', onClick: () => navigateToLanding() },
            { label: activeDivision.labelEn },
          ]}
          color="var(--visuals-main)"
        />

        {/* Header */}
        <div className="visuals-division-header">
          <span className="visuals-division-header-icon">
            {activeDivision.icon}
          </span>
          <h2>{activeDivision.label}</h2>
        </div>
        <div className="visuals-division-stats">
          {subcats.length} subcategories
        </div>
        <div className="visuals-gradient-divider" />

        {/* 內容：優先使用 API，fallback 到硬編碼 */}
        {divisionPage?.content && divisionPage.content.length > 0 ? (
          <div className="visuals-prose">
            {divisionPage.content
              .filter((b) => b.type === 'rich_text')
              .map((b) => (
                <React.Fragment key={b.id}>
                  {renderHtmlWithUep(b.content, b.id, 'visuals-prose')}
                </React.Fragment>
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
              const locked = isLocked(sc, progress, sc.id, progressTree);
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
              const locked = isLocked(sc, progress, sc.id, progressTree);
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
              const locked = isLocked(sc, progress, sc.id, progressTree);
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
                const locked = isLocked(sc, progress, sc.id, progressTree);
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
    if (!subcatNode) return <ZoneStateDisplay kind="loading" />;

    const { galleries, groupMap, groupList } = buildGalleryGroups(subcatNode);
    const safeGroupIdx = Math.min(
      activeGroupIdx,
      Math.max(0, groupList.length - 1)
    );
    const currentGroup = groupList[safeGroupIdx] || '全部';
    const currentGalleries = groupMap.get(currentGroup) || galleries;
    const maxIdx = Math.max(0, groupList.length - 1);

    return (
      <div className="visuals-subcat-page">
        <ZoneBreadcrumb
          segments={[
            { label: '幻影重現室', onClick: () => navigateToLanding() },
            {
              label: activeDivision?.label || '...',
              onClick: activeDivision
                ? () => navigateToDivision(activeDivision.id)
                : undefined,
            },
            { label: subcatNode.title },
          ]}
          color="var(--visuals-main)"
        />

        <h2 className="visuals-subcat-title">{subcatNode.title}</h2>
        <div className="visuals-subcat-meta">
          {galleries.length} galleries · {groupList.length} groups
        </div>
        <div className="visuals-gradient-divider" />

        {/* 富文本內容（來自編輯器） */}
        {subcatPage?.content && subcatPage.content.length > 0 && (
          <div className="visuals-prose visuals-subcat-intro">
            {subcatPage.content
              .filter((b) => b.type === 'rich_text')
              .map((b) => (
                <React.Fragment key={b.id}>
                  {renderHtmlWithUep(b.content, b.id, 'visuals-prose')}
                </React.Fragment>
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
              <div
                className="visuals-gallery-card-grid"
                {...entityDrag.handlers}
              >
                {currentGalleries.map((g) => {
                  const images = Array.isArray(g.metadata?.images)
                    ? (g.metadata.images as ImageItem[])
                    : [];

                  // gallery 閘（tree-aware）：未過時一切不可見——
                  // 連縮圖與張數都不外洩，整卡呈鎖定態（不變量 1）。
                  // 推導旗標（clue 展示授旗）可解鎖，static locked 仍優先
                  const gateLocked = !isGalleryUnlockedInZone(
                    g,
                    progress,
                    progressTree
                  );
                  if (gateLocked) {
                    return (
                      <button
                        key={g.id}
                        className="visuals-gallery-card visuals-gallery-card--sealed"
                        disabled
                      >
                        <LockedImageCell label="SEALED" />
                        <div className="visuals-gallery-card-body">
                          <div className="visuals-gallery-card-title">
                            🔒 {g.title}
                          </div>
                          <div className="visuals-gallery-card-meta">
                            — sealed —
                          </div>
                        </div>
                      </button>
                    );
                  }

                  const firstImg = images.length > 0 ? images[0] : null;
                  const thumbUrl = firstImg ? buildImageUrl(firstImg.file) : '';

                  const handleClick = () => {
                    void navigateToGallery(g.id);
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
                      /*
                       * 陳列走廊的畫廊綁 entityKey，可以被拖進便條島；
                       * 鑲框室的插圖綁 storyKey，不在 dossier 命名空間裡，
                       * 自然拖不動（findCanonicalEntityName 查不到）
                       */
                      data-entity-key={
                        (g.metadata?.entityKey as string) ?? undefined
                      }
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
                              }}
                            />
                          );
                        })()
                      ) : thumbUrl ? (
                        <img
                          className="visuals-gallery-card-thumb"
                          src={thumbUrl}
                          alt={g.title}
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
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* 解鎖儀式（S9-B）：獨立渲染在網格末尾，不混進上面那個由
                    伺服器 tree 驅動的清單——那條路徑會先過 gate 閘（鎖定
                    即 disabled 死卡），點擊又會打真 API。 */}
                {phantomSlot?.subcatId === activeSubcatId &&
                  phantomSlot?.groupIdx === safeGroupIdx && (
                    <VisualsPhantomCard onOpen={handlePhantomCardOpen} />
                  )}
                {entityDrag.ghost}
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

  /**
   * 映照（V-C）：把目前 gallery 投射到浮動幻影並展開島。
   * 只在已解鎖 gallery 頁提供入口（sealed 分支先 return），
   * bridge 值放 window——島收合 unmount 後展開仍續示。
   */
  function mirrorGalleryToIsland(images: ImageItem[]) {
    if (!galleryPage) return;
    const meta = galleryPage.metadata || {};
    pushPhantomGallery({
      id: galleryPage.id,
      title: galleryPage.title,
      entityKey: typeof meta.entityKey === 'string' ? meta.entityKey : null,
      divisionId: galleryPage.id.split('/')[1] ?? null,
      // gallery 閘快照——島依 progress 變化重驗（pristineOnly 可失效）
      gate: meta.gate ?? null,
      locked: meta.locked === true,
      images,
      source: 'mirror',
    });
    getIslandRuntime().open('visuals');
  }

  // ─── RENDER: Gallery ───
  function renderGallery() {
    const galleryNode = activeGalleryId
      ? findNodeById(tree, activeGalleryId)
      : null;

    // hidden 完全不對前台公開（contentVisibility 契約）：列表已排除，
    // 這裡擋 `?page=` deep link 直達——一律視為不存在，不洩漏內容
    if (galleryNode && isHidden(galleryNode)) {
      return (
        <div className="visuals-gallery-page">
          <ZoneStateDisplay kind="error" message="這個畫廊不存在。" large />
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

    // 載入失敗：顯示錯誤與重試，不殘留上一頁內容
    if (galleryError) {
      return (
        <div className="visuals-gallery-page">
          <ZoneStateDisplay
            kind="error"
            message={galleryError}
            onRetry={() =>
              activeGalleryId && void navigateToGallery(activeGalleryId, false)
            }
            large
          />
        </div>
      );
    }

    if (!galleryPage) return <ZoneStateDisplay kind="loading" />;

    const meta = galleryPage.metadata || {};

    // gallery 閘 deep-link 守門（不變量 1）：閘未過時整個 gallery 呈鎖定態
    // ——不渲染任何圖片（含鎖定佔位）。列表入口已擋，這裡擋 URL 直達。
    // 推導旗標（clue 展示授旗）可解鎖，static locked 仍優先
    if (
      galleryNode &&
      !isGalleryUnlockedInZone(galleryNode, progress, progressTree)
    ) {
      return (
        <div className="visuals-gallery-page">
          <ZoneBreadcrumb
            segments={[
              { label: '幻影重現室', onClick: () => navigateToLanding() },
              { label: galleryPage.title },
            ]}
            color="var(--visuals-main)"
          />
          <div className="visuals-gallery-sealed">
            <span className="visuals-img-locked-icon">⛉</span>
            <div className="visuals-gallery-sealed-title">此畫廊尚未解鎖</div>
            <div className="visuals-gallery-sealed-hint">
              {typeof meta.gateHint === 'string' && meta.gateHint
                ? meta.gateHint
                : '繼續閱讀故事以解開封印。'}
            </div>
          </div>
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
        <ZoneBreadcrumb
          segments={[
            { label: '幻影重現室', onClick: () => navigateToLanding() },
            {
              label: activeDivision?.label || '...',
              onClick: activeDivision
                ? () => navigateToDivision(activeDivision.id)
                : undefined,
            },
            ...(activeSubcatId
              ? [
                  {
                    label: findNodeById(tree, activeSubcatId)?.title || '...',
                    onClick: () => navigateToSubcat(activeSubcatId!),
                  },
                ]
              : []),
            { label: galleryPage.title },
          ]}
          color="var(--visuals-main)"
        />

        <div className="visuals-gallery-header">
          <h2>{galleryPage.title}</h2>
          <div className="visuals-gallery-count">{images.length} pieces</div>
          {/* 映照入口（V-C）：投射整個 gallery 到浮動幻影。掛載守門同
              Echoes 加入佇列按鈕——島不可用（未解鎖/停用/觀測者）時不
              顯示；gallery 閘已由上方 sealed 分支把關（只投已解鎖）。 */}
          {desktopViewport &&
            shouldMountIsland(progress, 'visuals') &&
            canMirrorGallery({
              divisionId: galleryPage.id.split('/')[1] ?? null,
              layout: style,
              imageCount: images.length,
            }) && (
              <button
                type="button"
                className="visuals-mirror-btn"
                title="將此畫廊映照到浮動幻影"
                onClick={() => mirrorGalleryToIsland(images)}
              >
                <span aria-hidden>❏</span> 映照
              </button>
            )}
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
    // 精靈圖 gallery 本輪不接三態（設計文件定案）
    if (style === 'sprite') return renderSprite(images);
    const items = resolveGalleryImages(images, progress, galleryPage?.id);
    switch (style) {
      case 'corridor':
        return renderCorridor(items);
      case 'museum':
        return renderMuseum(items);
      case 'pinboard':
        return renderPinboard(items);
      case 'pixel':
        return renderPixel(items);
      default:
        return renderMuseum(items);
    }
  }

  function renderCorridor(items: GalleryImageView[]) {
    const item = items[corridorIdx] || items[0];
    if (!item) return null;
    const prev = () =>
      setCorridorIdx((corridorIdx - 1 + items.length) % items.length);
    const next = () => setCorridorIdx((corridorIdx + 1) % items.length);
    const locked = item.state === 'locked';
    const partial = item.state === 'partial';

    return (
      <div className="visuals-gallery-corridor">
        <div className="visuals-corridor-stage">
          <button className="visuals-corridor-arrow" onClick={prev}>
            ‹
          </button>
          {locked ? (
            <div className="visuals-corridor-main is-locked">
              <LockedImageCell />
            </div>
          ) : (
            <div
              className={`visuals-corridor-main${partial ? ' visuals-img-partial' : ''}`}
              onClick={() => openLightbox(items, corridorIdx)}
            >
              <img
                src={buildImageUrl(item.img.file)}
                alt={item.img.caption || ''}
              />
              <div className="visuals-gallery-hover-overlay">
                <span className="visuals-gallery-hover-icon">⤢</span>
              </div>
            </div>
          )}
          <button className="visuals-corridor-arrow" onClick={next}>
            ›
          </button>
        </div>
        <div className="visuals-corridor-caption">
          <div className="visuals-corridor-counter">
            {String(corridorIdx + 1).padStart(2, '0')} /{' '}
            {String(items.length).padStart(2, '0')}
          </div>
          <div className="visuals-corridor-title">
            {locked ? '？？？' : item.img.caption || galleryPage?.title}
          </div>
        </div>
        <div className="visuals-corridor-strip">
          {items.map((it, i) => (
            <button
              key={it.img.id}
              className={`visuals-corridor-thumb ${i === corridorIdx ? 'is-active' : ''}${it.state === 'partial' ? ' visuals-img-partial' : ''}`}
              onClick={() => setCorridorIdx(i)}
            >
              {it.state === 'locked' ? (
                <LockedImageCell label="" />
              ) : (
                <img src={buildImageUrl(it.img.file)} alt="" />
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderMuseum(items: GalleryImageView[]) {
    return (
      <div className="visuals-gallery-museum">
        {items.map((it, i) => (
          <div
            key={it.img.id}
            className={`visuals-museum-frame${it.state === 'locked' ? ' is-locked' : ''}`}
            onClick={
              it.state === 'locked' ? undefined : () => openLightbox(items, i)
            }
          >
            {it.state === 'locked' ? (
              <div className="visuals-gallery-img-container">
                <LockedImageCell />
              </div>
            ) : (
              <div
                className={`visuals-gallery-img-container${it.state === 'partial' ? ' visuals-img-partial' : ''}`}
              >
                <img
                  src={buildImageUrl(it.img.file)}
                  alt={it.img.caption || ''}
                />
                <div className="visuals-gallery-hover-overlay">
                  <span className="visuals-gallery-hover-icon">⤢</span>
                </div>
              </div>
            )}
            <div className="visuals-museum-label">
              「{it.state === 'locked' ? '？？？' : it.img.caption || '無題'}」
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderPinboard(items: GalleryImageView[]) {
    return (
      <div className="visuals-gallery-pinboard">
        {items.map((it, i) => {
          // 用 sin 函式產生更自然的隨機傾斜角度（±7°）
          const rot = Math.sin(i * 2.34 + 0.7) * 7;
          // 輕微的垂直偏移讓排列更有散落感
          const yOff = Math.cos(i * 1.87 + 0.3) * 8;
          return (
            <div
              key={it.img.id}
              className={`visuals-pinboard-card${it.state === 'locked' ? ' is-locked' : ''}`}
              style={
                {
                  '--pin-rot': `${rot.toFixed(1)}deg`,
                  '--pin-y': `${yOff.toFixed(1)}px`,
                } as React.CSSProperties
              }
              onClick={
                it.state === 'locked' ? undefined : () => openLightbox(items, i)
              }
            >
              <span className="visuals-pinboard-pin" />
              <div
                className={`visuals-pinboard-photo${it.state === 'partial' ? ' visuals-img-partial' : ''}`}
              >
                {it.state === 'locked' ? (
                  <LockedImageCell />
                ) : (
                  <>
                    <img
                      src={buildImageUrl(it.img.file)}
                      alt={it.img.caption || ''}
                    />
                    <div className="visuals-gallery-hover-overlay">
                      <span className="visuals-gallery-hover-icon">⤢</span>
                    </div>
                  </>
                )}
              </div>
              <div className="visuals-pinboard-label">
                {it.state === 'locked' ? '？？？' : it.img.caption || ''}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderPixel(items: GalleryImageView[]) {
    return (
      <div className="visuals-gallery-pixel">
        {items.map((it, i) => (
          <div
            key={it.img.id}
            className={`visuals-pixel-cell${it.state === 'locked' ? ' is-locked' : ''}`}
            onClick={
              it.state === 'locked' ? undefined : () => openLightbox(items, i)
            }
          >
            {it.state === 'locked' ? (
              <div className="visuals-gallery-img-container is-pixel">
                <LockedImageCell />
              </div>
            ) : (
              <div
                className={`visuals-gallery-img-container is-pixel${it.state === 'partial' ? ' visuals-img-partial' : ''}`}
              >
                <img
                  src={buildImageUrl(it.img.file)}
                  alt={it.img.caption || ''}
                />
                <div className="visuals-gallery-hover-overlay">
                  <span className="visuals-gallery-hover-icon">⤢</span>
                </div>
              </div>
            )}
            <div className="visuals-pixel-label">
              {it.state === 'locked'
                ? '？？？'
                : it.img.caption || it.img.file.split('/').pop()}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ─── RENDER: Sprite ───
  function renderSprite(images: ImageItem[]) {
    const sprite = images.find((img) => img.isSpriteSheet);
    if (!sprite)
      return renderMuseum(
        images.map((img) => ({ img, state: 'unlocked' as const }))
      );
    return (
      <SpriteViewer
        sprite={sprite}
        spriteUrl={buildImageUrl(sprite.file)}
        onOpenLightbox={() => openLightboxPlain(images, images.indexOf(sprite))}
      />
    );
  }

  // ─── RENDER: Lightbox ───
  function renderLightbox() {
    if (lightboxIdx === null || lightboxItems.length === 0) return null;
    const current = lightboxItems[lightboxIdx];
    if (!current) return null;
    const art = current.img;
    // B 部分解鎖：放大仍遮罩（模糊不解除）
    const isPartial = current.state === 'partial';

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
      <div
        className={`visuals-lightbox${lbClosing ? ' is-closing' : ''}`}
        onClick={closeLightbox}
      >
        <div
          className="visuals-lightbox-inner"
          onClick={(e) => e.stopPropagation()}
        >
          <button className="visuals-lightbox-close" onClick={closeLightbox}>
            關閉 ✕
          </button>
          <img
            className={`visuals-lightbox-img ${lbZoom > 1 ? 'is-panning' : ''}${isPartial ? ' is-partial' : ''}`}
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
            <div className="visuals-lightbox-caption">
              {art.caption || ''}
              {isPartial && (
                <span className="visuals-lightbox-partial-tag">
                  · 部分解鎖：影像尚未完全顯現
                </span>
              )}
            </div>
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
                disabled={lightboxIdx >= lightboxItems.length - 1}
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

  // === Main render ===
  return (
    <ReaderShell zoneId="visuals" className="visuals-reader">
      {/* 入場動畫 — 幻影閃現 */}
      <div
        className={`vis-boot ${contentReady ? 'is-ready' : ''}`}
        aria-hidden="true"
      >
        <div className="vis-boot-flash vis-boot-flash--l" />
        <div className="vis-boot-flash vis-boot-flash--r" />
        <div className="vis-boot-flash vis-boot-flash--l2" />
        <div className="vis-boot-flash vis-boot-flash--r2" />
        <div className="vis-boot-grain" />
      </div>

      <div className="visuals-main">
        <ZoneAtmosphere zone={VISUALS_ZONE} intensity="subtle" skipGlyphs />
        <div className="visuals-content" ref={scrollRef}>
          <VisualsPhantom
            variant={resolvePhantomVariant(
              view === 'landing' ? 'landing' : activeDivisionId
            )}
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
    </ReaderShell>
  );
}
