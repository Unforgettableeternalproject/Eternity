import React, {
  Suspense,
  lazy,
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from 'react';

import {
  parseVerseStanzas,
  type HomepageData,
  type ZoneSectionContent,
} from '../../data/homepage-types';
import { ZONE_NARRATIVES, JOURNEY_TRANSITION } from '../../data/journey';
import { ZONES, VERSES, zoneTextColor } from '../../data/zones';
import type { ZoneData } from '../../data/zones';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import { useIsMobile } from '../../utils/useIsMobile';
import PieMap3D from '../map/PieMap3D';
import IntroOverlay from '../ui/IntroOverlay';
import Minimap from '../ui/Minimap';
import PortalTransition from '../ui/PortalTransition';
import TopBar from '../ui/TopBar';
import UepDialogue from '../ui/UepDialogue';
import renderHtmlWithUep from '../ui/renderHtmlWithUep';
import { acquireZoneEntryLock } from '../zone/zoneEntryLock';

import JourneyNav from './JourneyNav';
import JourneyScene from './JourneyScene';

/**
 * 大地圖彈窗走 lazy——它本來就是條件渲染（showMap），使用者不點就
 * 永遠不會出現，沒有理由讓它佔首屏 bundle。
 *
 * ⚠️ 同一區的 PieMap3D **不能**比照辦理：scroll gate 會讀 Atlas 的
 * offsetTop／offsetHeight 判斷區塊邊界，地圖延後載入會讓 Atlas 高度在
 * 載入前後改變，整組 gate 跟著錯位。
 */
const BigMapModal = lazy(() => import('../ui/BigMapModal'));
import './HomePage.css';
import { getApiBase } from '../../lib/apiBase';

const API_BASE = getApiBase();
const ZONE_VEIL_DURATION_MS = 1800;
const ZONE_VEIL_ALIGN_DELAY_MS = 100;
const DESKTOP_DOWN_GATE_MIN = 0.66;
const DESKTOP_DOWN_GATE_MAX = 1.1;
const DESKTOP_UP_GATE_MIN = -0.08;
const DESKTOP_UP_GATE_MAX = 0.36;
const MOBILE_DOWN_GATE_MIN = 0.42;
const MOBILE_DOWN_GATE_MAX = 0.9;
const MOBILE_UP_GATE_MIN = -0.08;
const MOBILE_UP_GATE_MAX = 0.42;
/** wheel delta 累積到此值時觸發全黑 → 播放動畫 */
const FADE_THRESHOLD = 600;
/**
 * 手機淡出走完多少比例才允許轉場。
 *
 * 桌面靠 wheel delta 累積表達「我真的要離開這一區」；手機沒有 wheel，
 * 原本是一進 gate band 就轉場——使用者的閱讀線還在螢幕中央、當前區塊
 * 底部的文字根本還沒讀到，就已經被帶走了。
 *
 * 改成 band 的前段是淡出區、走到尾段才轉場：淡出既是緩衝也是預告，
 * 而且因為進度是捲動位置的純函數，往回滑會自己退回去。
 * 不設 1.0 是留一點餘裕——最後幾 px 要求精準命中只會讓人覺得卡住。
 */
export const MOBILE_FADE_TRIGGER_PROGRESS = 0.92;
/**
 * 手機淡出區間：下一區塊頂緣的位置，以視窗高度為單位。
 *
 * **不能沿用 gate band [0.42, 0.90]。** 手機的 `.journey-scroll` 刻意關掉了
 * scroll snap（桌面是 y mandatory），所以捲動可以停在任意位置——遮罩還沒
 * 夠暗時，下一區塊的開頭就已經是畫面上一大片空白。
 *
 * 終點取 **1.02vh**：那時下一區塊的頂緣還在視窗底緣之下，也就是**接縫
 * 完全還沒進畫面**時遮罩就已經全黑。前一版終點放在 0.85vh（露出 15%
 * 才全黑），實測仍看得到邊界——遮罩本身有淡入的時間差，等到「快全黑」
 * 時接縫早就露出來了。寧可全黑得比需要的更早，那一段反正也沒東西可看。
 *
 * 起點 1.45vh 給 0.43vh（約 360px）的漸變距離。上限受最矮的區塊約束：
 * 實測手機版各區塊高 1.70～2.15vh，靜止對齊時 `nextTop` 等於當前區塊的
 * 高度，所以起點必須明顯低於 1.70vh，否則一停下來就已經是半黑的。
 */
const MOBILE_FADE_START_VH = 1.45;
const MOBILE_FADE_END_VH = 1.02;

/**
 * 手機往回捲的淡出區間：**當前**區塊頂緣的位置。
 *
 * 兩個方向的幾何不對稱：往下時下一區塊還在畫面外，天然就有跑道可以
 * 「在接縫進畫面之前就全黑」；往上時手指一動，上一區塊的底部**立刻**
 * 開始露出，沒有任何跑道。
 *
 * ⚠️ **起點不能取負值**（一度改成 -0.30vh，錯的）。負起點代表頂緣與視窗
 * 頂切齊時進度就已經接近 1——而那正是每個區塊的靜止位置。後果有兩個：
 * 停在區塊頂端時畫面是半黑的；更糟的是進度超過觸發門檻，**往上捲到區塊
 * 頂端的那一刻就被直接丟進上一個區塊**。
 *
 * 所以起點固定在 0，整段淡出只能發生在「接縫正在露出」的區間裡。
 * 終點壓到 0.10vh 讓它盡快全黑——往上註定會看到一點接縫，只能讓那一段
 * 短一些。真正讓這段變得不明顯的是手機的 proximity snap（見
 * JourneyScene.css）：靜止位置就是區塊頂端，使用者不會停在半途。
 */
const MOBILE_UP_FADE_START_VH = 0;
const MOBILE_UP_FADE_END_VH = 0.1;

/**
 * 桌面往回捲的硬門檻（當前區塊頂緣下沉多少就轉場）。
 * 桌面的漸變由 wheel handler 累積，scroll handler 只是保底，所以維持
 * 原本的單一門檻——**不要**改用手機那組區間常數，那是兩套不同的機制。
 */
const DESKTOP_UP_SCROLL_THRESHOLD_VH = 0.16;
const ATLAS_SCENE_INDEX = -3;

/** 大廳動畫 — 墜落速度線 */
const LOBBY_STREAKS: {
  left: string;
  delay: number;
  h: string;
  opacity: number;
}[] = [
  { left: '10%', delay: 0, h: '28vh', opacity: 0.35 },
  { left: '22%', delay: 0.08, h: '36vh', opacity: 0.5 },
  { left: '35%', delay: 0.04, h: '24vh', opacity: 0.3 },
  { left: '44%', delay: 0.14, h: '42vh', opacity: 0.55 },
  { left: '50%', delay: 0.02, h: '48vh', opacity: 0.6 },
  { left: '56%', delay: 0.1, h: '40vh', opacity: 0.5 },
  { left: '65%', delay: 0.06, h: '30vh', opacity: 0.4 },
  { left: '78%', delay: 0.12, h: '34vh', opacity: 0.45 },
  { left: '90%', delay: 0.16, h: '26vh', opacity: 0.3 },
];

/** 大廳動畫 — 亮色限定：上升速度線（從底部往上衝，暗色 CSS 隱藏） */
const LOBBY_RISES: {
  left: string;
  delay: number;
  h: string;
  opacity: number;
}[] = [
  { left: '14%', delay: 0.1, h: '24vh', opacity: 0.45 },
  { left: '28%', delay: 0.2, h: '32vh', opacity: 0.55 },
  { left: '40%', delay: 0.06, h: '28vh', opacity: 0.5 },
  { left: '48%', delay: 0.24, h: '38vh', opacity: 0.6 },
  { left: '55%', delay: 0.14, h: '34vh', opacity: 0.55 },
  { left: '66%', delay: 0.08, h: '26vh', opacity: 0.45 },
  { left: '80%', delay: 0.18, h: '30vh', opacity: 0.5 },
];

/** 大廳動畫 — 菱形著陸衝擊火花（12 顆，30° 間隔，亮色限定） */
const LOBBY_SPARKS: { x: number; y: number; size: number }[] = [
  { x: 150, y: 0, size: 3 },
  { x: 120, y: 68, size: 2.5 },
  { x: 62, y: 128, size: 2 },
  { x: 0, y: 145, size: 3 },
  { x: -68, y: 122, size: 2 },
  { x: -128, y: 60, size: 2.5 },
  { x: -155, y: 0, size: 3 },
  { x: -118, y: -70, size: 2 },
  { x: -60, y: -130, size: 2.5 },
  { x: 0, y: -150, size: 3 },
  { x: 72, y: -118, size: 2 },
  { x: 125, y: -65, size: 2.5 },
];

/** 大廳動畫 — 微粒位置（延遲已對齊墜落結束後） */
const LOBBY_MOTES: { top: string; left: string; delay: number }[] = [
  { top: '38%', left: '42%', delay: 1.3 },
  { top: '35%', left: '58%', delay: 1.4 },
  { top: '62%', left: '40%', delay: 1.35 },
  { top: '60%', left: '60%', delay: 1.5 },
  { top: '30%', left: '50%', delay: 1.55 },
  { top: '70%', left: '48%', delay: 1.6 },
  { top: '50%', left: '32%', delay: 1.45 },
  { top: '50%', left: '68%', delay: 1.65 },
];

type LobbyPhase = 'idle' | 'waiting' | 'playing' | 'done';

const useBrowserLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function isWithinViewportBand(
  value: number,
  vh: number,
  minRatio: number,
  maxRatio: number
) {
  return value >= vh * minRatio && value <= vh * maxRatio;
}

/**
 * 手機切區塊的淡出進度：目標區塊頂緣穿越 gate band 的比例（0 → 1）。
 *
 * 純粹是捲動位置的函數——沒有累積量、沒有方向鎖，所以手指往回滑
 * 進度就自己退回去，不必像桌面那套 wheel fade 一樣維護 direction／
 * target ref。慣性滑動一口氣衝過整個 band 時進度直接到 1，
 * 該轉場就轉場，不會卡住。
 */
export function mobileFadeProgress(topPx: number, vh: number): number {
  const start = MOBILE_FADE_START_VH * vh;
  const end = MOBILE_FADE_END_VH * vh;
  if (topPx >= start) return 0;
  if (topPx <= end) return 1;
  return (start - topPx) / (start - end);
}

/**
 * 手機往回捲的淡出進度：**當前**區塊頂緣下沉的比例（0 → 1）。
 *
 * 與往下那支互為鏡像，只是量的對象不同——往下看的是還沒到的下一區塊
 * 頂緣（由下往上逼近），往上看的是腳下這一區塊的頂緣（往下沉，沉多少
 * 就露出多少上一區塊）。
 *
 * 同樣是捲動位置的純函數：手指改變方向進度就自己退回去。
 * 頂緣還在視窗頂之上（負值）代表使用者仍在區塊內往上讀，尚未觸及邊界。
 */
export function mobileUpFadeProgress(currentTopPx: number, vh: number): number {
  const start = MOBILE_UP_FADE_START_VH * vh;
  const end = MOBILE_UP_FADE_END_VH * vh;
  if (currentTopPx <= start) return 0;
  if (currentTopPx >= end) return 1;
  return (currentTopPx - start) / (end - start);
}

function isSettledAtElement(
  element: HTMLElement,
  scrollTop: number,
  vh: number
) {
  return Math.abs(element.offsetTop - scrollTop) <= vh * 0.08;
}

interface RecentItem {
  id: string;
  area: string;
  title: string;
  slug: string;
  pageType: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export default function HomePage({
  isDev = false,
  homepageData: initialData,
}: {
  isDev?: boolean;
  homepageData?: HomepageData | null;
}) {
  const isMobile = useIsMobile();

  // 延遲到 mount 後才使用 homepageData，避免 SSR 呼叫 DOMParser (renderHtmlWithUep)
  // SSR 與初次 client render 都是 undefined → 用 fallback → hydration 一致
  const [homepageData, setHomepageData] = useState<HomepageData | undefined>(
    undefined
  );
  useEffect(() => {
    if (initialData) setHomepageData(initialData);
  }, [initialData]);

  // ── 合併 D1 資料與靜態 fallback ──

  // Hero 區塊
  const hero = homepageData?.hero;

  // Atlas 區塊
  const atlas = homepageData?.atlas;

  // Journey Transition（body 為 TipTap HTML，有值時直接渲染，沒有就用靜態 fallback）
  const journey = homepageData?.journey;
  const _mergedTransition = JOURNEY_TRANSITION;

  // Verse 區塊
  const verse = homepageData?.verse;
  const _mergedVerses = VERSES;

  // Zone 資料：用 D1 的 meta 覆蓋靜態 ZONES
  const mergedZones = ZONES.map((zone) => {
    const db = homepageData?.[`zone-${zone.id}` as keyof HomepageData] as
      | ZoneSectionContent
      | undefined;
    if (!db?.meta) return zone;
    return {
      ...zone,
      label: db.meta.label ?? zone.label,
      en: db.meta.en ?? zone.en,
      kicker: db.meta.kicker ?? zone.kicker,
      blurb: db.meta.blurb ?? zone.blurb,
      atmos: db.meta.atmos ?? zone.atmos,
      glyphs: db.meta.glyphs ?? zone.glyphs,
      uep: db.meta.uepShort ?? zone.uep,
      stats: db.meta.stats ?? zone.stats,
    };
  });

  // Journey narratives：靜態資料作為 fallback（有 body HTML 時優先使用 HTML）
  const mergedNarratives = ZONE_NARRATIVES;
  const [hover, setHover] = useState<string | null>(null);
  const [intro, setIntro] = useState<ZoneData | null>(null);
  const [portal, setPortal] = useState<ZoneData | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [lobbyPhase, setLobbyPhase] = useState<LobbyPhase>('idle');
  const [veilZone, setVeilZone] = useState<ZoneData | null>(null);
  const [sectionVeil, setSectionVeil] = useState<{
    id: 'plain' | 'threshold' | 'verse';
    label: string;
  } | null>(null);
  const [veilDirection, setVeilDirection] = useState<'down' | 'up'>('down');
  const [veilKey, setVeilKey] = useState(0);
  const previousSceneRef = useRef(-2);
  const zoneTransitionRef = useRef(false);
  const fadeAccumRef = useRef(0);
  const fadeDirectionRef = useRef<'down' | 'up' | null>(null);
  const fadeTargetRef = useRef(-2);
  const fadeOverlayRef = useRef<HTMLDivElement>(null);
  const fadingRef = useRef(false);
  const thresholdSettledRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  /** 記錄容器鎖定前的原始樣式，防止連續轉場互相覆蓋 */
  const containerStyleBackupRef = useRef<{
    scrollBehavior: string;
    scrollSnapType: string;
    overflowY: string;
    touchAction: string;
  } | null>(null);
  const alignTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alignRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alignFinalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Verse 內部自由滾動期間，記錄進入前的 snap type 以便離開時恢復 */
  const originalSnapTypeRef = useRef('');
  /** 轉場結束後的冷卻期，防止 subpixel scroll event 立刻再觸發轉場 */
  const transitionCooldownRef = useRef(false);
  // SSR-safe：初始值 false（匹配 server 端），hydrate 後讀取實際 theme
  const [isDark, setIsDark] = useState(false);

  // 進場淡入 + theme 偵測 + 大廳動畫
  useEffect(() => {
    setIsDark(document.documentElement.dataset.theme === 'dark');

    // 剛從 /login 完成 auth 回來：WelcomeCeremony 已作為特別入場儀式播出，
    // 主頁的 4.2s 大廳動畫該跳過——避免 Welcome 淡出後還看到頁面在跑動畫。
    // 由 DesignLayout inline script 種下 class（html 與 body 各種一份，早於此
    // effect 執行）；GlobalWelcomeHost 播完儀式才移除
    const welcomePending =
      document.documentElement.classList.contains('uep-welcome-pending') ||
      document.body.classList.contains('uep-welcome-pending');
    if (welcomePending) {
      // 移除 head 注入的防閃遮罩（本次流程不會播 lobby，遮罩留著會擋畫面）
      document.getElementById('lobby-block-style')?.remove();
      return;
    }

    // ── 啟用大廳動畫 ──
    // 刻意每次進站都播（不做 session 「看過就跳過」判定）：4.2s 是入場儀式的
    // 一部分，也剛好讓資源載完。唯一的例外是上方 welcomePending 那條。
    setLobbyPhase('playing');
  }, []);

  useBrowserLayoutEffect(() => {
    if (lobbyPhase !== 'playing') return;
    // 等 React 已掛上 lobby overlay 後，再移除 head 注入的防閃遮罩。
    document.getElementById('lobby-block-style')?.remove();
  }, [lobbyPhase]);

  // lobby 動畫期間隱藏浮動 UI（S7-C 驗收回饋）：lobby-overlay 的
  // z-index（400）低於浮島層帶（2000+），與 IntroOverlay/PortalTransition
  // 同樣走 zoneEntryLock（body class），動畫播畢釋放。
  useEffect(() => {
    if (lobbyPhase !== 'playing') return;
    return acquireZoneEntryLock();
  }, [lobbyPhase]);

  // 測量 TopBar 高度，設定 --topbar-h 供 section 高度計算
  useEffect(() => {
    const topbar = document.querySelector('.uep-topbar');
    const container = scrollContainerRef.current;
    if (topbar && container) {
      const h = topbar.getBoundingClientRect().height;
      container.style.setProperty('--topbar-h', `${h}px`);
    }
  }, []);

  // 最近更新
  const [recents, setRecents] = useState<RecentItem[]>([]);
  useEffect(() => {
    fetch(`${API_BASE}/api/content/recent?limit=5`)
      .then((r) => r.json())
      .then((json: { ok?: boolean; data?: unknown }) => {
        if (json.ok && Array.isArray(json.data)) setRecents(json.data);
      })
      .catch(() => {});
  }, []);

  // 檢查是否已登入（透過前端可讀的指示 cookie）
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useEffect(() => {
    setIsLoggedIn(document.cookie.includes('uep-admin-active=1'));
  }, []);

  // 隱藏入口：四角字符點擊序列
  // 境(1) 際(2) / 觀(3) 測(4) — 密碼 2214134
  const GLYPH_SEQ = [2, 2, 1, 4, 1, 3, 4];
  const [, setGlyphInput] = useState<number[]>([]);
  const [hoveredGlyph, setHoveredGlyph] = useState<number | null>(null);
  const glyphTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleGlyphClick = useCallback((index: number) => {
    const pos = index + 1; // 轉換成 1-based

    setGlyphInput((prev) => {
      const next = [...prev, pos];

      // 檢查是否符合目標前綴
      const matches = next.every((v, i) => v === GLYPH_SEQ[i]);
      if (!matches) {
        // 不符合 — 如果當前點擊是序列開頭，從頭開始
        return pos === GLYPH_SEQ[0] ? [pos] : [];
      }

      // 序列完成
      if (next.length === GLYPH_SEQ.length) {
        setTimeout(() => {
          window.location.href = '/admin/login';
        }, 0);
        return [];
      }

      return next;
    });

    // 5 秒無動作重置
    if (glyphTimer.current) clearTimeout(glyphTimer.current);
    glyphTimer.current = setTimeout(() => setGlyphInput([]), 5000);
  }, []);

  const handleEnterZone = useCallback(() => {
    if (!intro) return;
    setPortal(intro);
    setIntro(null);
    setTimeout(() => {
      window.location.href = `/${intro.slug}`;
    }, 1100);
  }, [intro]);

  const handlePortalDone = useCallback(() => {
    setPortal(null);
  }, []);

  // 大廳動畫結束
  const handleLobbyAnimEnd = useCallback((e: React.AnimationEvent) => {
    if (e.animationName !== 'lobby-shell') return;
    setLobbyPhase('done');
  }, []);

  // 安全閥：lobby 動畫 6 秒後強制結束（防止 CSS animationName 比對失敗導致白屏）
  useEffect(() => {
    if (lobbyPhase !== 'playing') return;
    const timer = setTimeout(() => {
      setLobbyPhase((prev) => (prev === 'playing' ? 'done' : prev));
    }, 6000);
    return () => clearTimeout(timer);
  }, [lobbyPhase]);

  // ── Journey：場景旅程 ──
  const transitionRef = useRef<HTMLElement>(null);
  const { triggered: transTriggered } = useScrollReveal(transitionRef, {
    threshold: 0.15,
  });
  const verseRef = useRef<HTMLElement>(null);
  const { triggered: verseTriggered } = useScrollReveal(verseRef, {
    threshold: 0.15,
  });
  const bridgeAtlasRef = useRef<HTMLDivElement>(null);
  const { triggered: bridgeAtlasTriggered } = useScrollReveal(bridgeAtlasRef, {
    threshold: 0.3,
  });
  const bridgeVerseRef = useRef<HTMLDivElement>(null);
  const { triggered: bridgeVerseTriggered } = useScrollReveal(bridgeVerseRef, {
    threshold: 0.3,
  });

  // 建構場景列表：5 zones（使用合併後的 D1 + 靜態資料）
  // bodyHtml 有值時，JourneyScene 會改用 renderHtmlWithUep 渲染
  const journeyScenes = mergedZones.map((zone) => {
    const zoneData = homepageData?.[`zone-${zone.id}` as keyof HomepageData] as
      | ZoneSectionContent
      | undefined;
    return {
      zone,
      narrative: mergedNarratives.find((n) => n.zoneId === zone.id)!,
      bodyHtml: zoneData?.body,
    };
  });

  // 用 ref 讓 scroll/wheel useEffect 能取得最新的 mergedZones（避免閉包陷阱）
  const mergedZonesRef = useRef(mergedZones);
  mergedZonesRef.current = mergedZones;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 追蹤目前可見的場景 index（-2=hero, -1=transition, 0~4=zones）
  const [activeScene, setActiveScene] = useState(-2);

  const clearZoneTransitionTimers = useCallback(() => {
    if (alignTimerRef.current) clearTimeout(alignTimerRef.current);
    if (alignRetryTimerRef.current) clearTimeout(alignRetryTimerRef.current);
    if (alignFinalTimerRef.current) clearTimeout(alignFinalTimerRef.current);
    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    alignTimerRef.current = null;
    alignRetryTimerRef.current = null;
    alignFinalTimerRef.current = null;
    releaseTimerRef.current = null;
    // 新轉場開始時清除冷卻期，避免殘留的 cooldown 擋住新轉場後的正常操作
    transitionCooldownRef.current = false;
  }, []);

  const startZoneTransition = useCallback(
    (
      targetIndex: number,
      nextZone: ZoneData,
      direction: 'down' | 'up' = 'down'
    ) => {
      const container = scrollContainerRef.current;
      const target =
        container?.querySelectorAll<HTMLElement>('[data-zone-id]')[targetIndex];
      if (!container || !target) return;

      clearZoneTransitionTimers();
      // 只在首次鎖定時備份原始樣式，連續轉場不覆蓋
      if (!containerStyleBackupRef.current) {
        containerStyleBackupRef.current = {
          scrollBehavior: container.style.scrollBehavior,
          scrollSnapType: container.style.scrollSnapType,
          overflowY: container.style.overflowY,
          touchAction: container.style.touchAction,
        };
      }
      const savedStyles = containerStyleBackupRef.current;
      zoneTransitionRef.current = true;
      container.classList.add('journey-scroll--locked');
      container.style.scrollBehavior = 'auto';
      container.style.scrollSnapType = 'none';
      container.style.overflowY = 'hidden';
      container.style.touchAction = 'none';

      // 手機預暗化：用 fade overlay 蓋住畫面，防止位置校正時看到跳動
      // 桌面版有 wheel-driven fade 提供預暗化，手機版沒有，所以需要手動補上
      if (isMobile && fadeOverlayRef.current) {
        fadeOverlayRef.current.style.setProperty('--fade-progress', '1');
        // veil 動畫 ~144ms 後完全不透明，此時可安全清除 overlay
        setTimeout(() => {
          fadeOverlayRef.current?.style.setProperty('--fade-progress', '0');
        }, 250);
      }

      setVeilZone(nextZone);
      setSectionVeil(null);
      setVeilDirection(direction);
      setVeilKey((v) => v + 1);

      const forceAlignToTarget = () => {
        const targetTop = target.offsetTop;
        container.scrollTo({ top: targetTop, behavior: 'auto' });
        container.scrollTop = targetTop;
        lastScrollTopRef.current = targetTop;
        thresholdSettledRef.current = false;
        setActiveScene(targetIndex);
        previousSceneRef.current = targetIndex;
      };

      alignTimerRef.current = setTimeout(() => {
        forceAlignToTarget();
        requestAnimationFrame(forceAlignToTarget);
        alignRetryTimerRef.current = setTimeout(forceAlignToTarget, 120);
        alignFinalTimerRef.current = setTimeout(forceAlignToTarget, 320);
      }, ZONE_VEIL_ALIGN_DELAY_MS);

      releaseTimerRef.current = setTimeout(() => {
        forceAlignToTarget();
        zoneTransitionRef.current = false;
        // 冷卻期：防止 snap 恢復時的 subpixel drift 觸發再次轉場
        // 50ms 足夠防 subpixel drift（1-2 frame），不影響使用者操作
        // CSS class 鎖住 touch-action 保護手機端
        transitionCooldownRef.current = true;
        container.classList.add('journey-scroll--cooldown');
        setTimeout(() => {
          transitionCooldownRef.current = false;
          container.classList.remove('journey-scroll--cooldown');
        }, 50);
        container.classList.remove('journey-scroll--locked');
        container.style.scrollBehavior = savedStyles.scrollBehavior;
        container.style.overflowY = savedStyles.overflowY;
        container.style.touchAction = savedStyles.touchAction;
        setVeilZone(null);

        // 離開 Verse 時恢復原始 snap；否則直接還原
        if (originalSnapTypeRef.current) {
          container.style.scrollSnapType = originalSnapTypeRef.current;
          originalSnapTypeRef.current = '';
        } else {
          container.style.scrollSnapType = savedStyles.scrollSnapType;
        }
        containerStyleBackupRef.current = null;
      }, ZONE_VEIL_DURATION_MS);
    },
    [clearZoneTransitionTimers, isMobile]
  );

  const resetFadeIntent = useCallback(() => {
    fadeAccumRef.current = 0;
    fadeDirectionRef.current = null;
    fadeTargetRef.current = -2;
    fadeOverlayRef.current?.style.setProperty('--fade-progress', '0');
  }, []);

  const alignToAtlas = useCallback(() => {
    const container = scrollContainerRef.current;
    const atlas = container?.querySelector<HTMLElement>('#atlas');
    if (!container || !atlas) return;

    const targetTop = atlas.offsetTop;
    thresholdSettledRef.current = false;
    container.scrollTo({ top: targetTop, behavior: 'auto' });
    container.scrollTop = targetTop;
    lastScrollTopRef.current = targetTop;
    previousSceneRef.current = ATLAS_SCENE_INDEX;
    setActiveScene(ATLAS_SCENE_INDEX);
  }, []);

  // Atlas→入口：無動畫直接對齊（暫時鎖定滾動防止慣性覆蓋）
  const alignToThreshold = useCallback(() => {
    const container = scrollContainerRef.current;
    const thresholdEl = container?.querySelector<HTMLElement>('#journey-start');
    if (!container || !thresholdEl) return;

    // 如果 zone/section 轉場正在進行，不干擾
    if (zoneTransitionRef.current) return;

    // 用閉包捕捉當前值，解鎖時不依賴 containerStyleBackupRef（避免競爭條件）
    const prevOverflowY = container.style.overflowY;
    const prevTouchAction = container.style.touchAction;

    container.style.overflowY = 'hidden';
    container.style.touchAction = 'none';

    const targetTop = thresholdEl.offsetTop;
    container.scrollTo({ top: targetTop, behavior: 'auto' });
    container.scrollTop = targetTop;
    lastScrollTopRef.current = targetTop;
    previousSceneRef.current = -1;
    thresholdSettledRef.current = true;
    setActiveScene(-1);

    requestAnimationFrame(() => {
      container.scrollTop = targetTop;
      setTimeout(() => {
        // 如果 zone/section 轉場已經接手，不要干擾
        if (zoneTransitionRef.current) return;
        // 用閉包值還原，不依賴 ref（避免被其他轉場清空導致永久鎖住）
        container.style.overflowY = prevOverflowY;
        container.style.touchAction = prevTouchAction;
      }, 120);
    });
  }, []);

  const startSectionTransition = useCallback(
    (
      target: HTMLElement,
      targetIndex: -1 | 5,
      variant: 'plain' | 'threshold' | 'verse',
      direction: 'down' | 'up',
      options?: {
        preserveFade?: boolean;
      }
    ) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      clearZoneTransitionTimers();
      if (!options?.preserveFade) {
        resetFadeIntent();
      }

      // 只在首次鎖定時備份原始樣式，連續轉場不覆蓋
      if (!containerStyleBackupRef.current) {
        containerStyleBackupRef.current = {
          scrollBehavior: container.style.scrollBehavior,
          scrollSnapType: container.style.scrollSnapType,
          overflowY: container.style.overflowY,
          touchAction: container.style.touchAction,
        };
      }
      const savedStyles = containerStyleBackupRef.current;

      zoneTransitionRef.current = true;
      container.classList.add('journey-scroll--locked');
      container.style.scrollBehavior = 'auto';
      container.style.scrollSnapType = 'none';
      container.style.overflowY = 'hidden';
      container.style.touchAction = 'none';

      // 手機預暗化：與 startZoneTransition 相同邏輯
      if (isMobile && fadeOverlayRef.current) {
        fadeOverlayRef.current.style.setProperty('--fade-progress', '1');
        setTimeout(() => {
          fadeOverlayRef.current?.style.setProperty('--fade-progress', '0');
        }, 250);
      }

      setVeilZone(null);
      setSectionVeil({
        id: variant,
        label:
          variant === 'threshold'
            ? '邊際世界遊歷'
            : variant === 'verse'
              ? '永恆的意義'
              : '',
      });
      setVeilDirection(direction);
      setVeilKey((v) => v + 1);

      const forceAlignToTarget = () => {
        const targetTop = target.offsetTop;
        container.scrollTo({ top: targetTop, behavior: 'auto' });
        container.scrollTop = targetTop;
        lastScrollTopRef.current = targetTop;
        previousSceneRef.current = targetIndex;
        thresholdSettledRef.current = targetIndex === -1;
        setActiveScene(targetIndex);
      };

      alignTimerRef.current = setTimeout(() => {
        forceAlignToTarget();
        requestAnimationFrame(forceAlignToTarget);
        alignRetryTimerRef.current = setTimeout(forceAlignToTarget, 120);
        alignFinalTimerRef.current = setTimeout(forceAlignToTarget, 320);
      }, ZONE_VEIL_ALIGN_DELAY_MS);

      releaseTimerRef.current = setTimeout(() => {
        forceAlignToTarget();
        zoneTransitionRef.current = false;
        // 冷卻期：防止 snap 恢復時的 subpixel drift 觸發再次轉場
        // 50ms 足夠防 subpixel drift（1-2 frame），不影響使用者操作
        // CSS class 鎖住 touch-action 保護手機端
        transitionCooldownRef.current = true;
        container.classList.add('journey-scroll--cooldown');
        setTimeout(() => {
          transitionCooldownRef.current = false;
          container.classList.remove('journey-scroll--cooldown');
        }, 50);
        container.classList.remove('journey-scroll--locked');
        container.style.scrollBehavior = savedStyles.scrollBehavior;
        container.style.overflowY = savedStyles.overflowY;
        container.style.touchAction = savedStyles.touchAction;
        setSectionVeil(null);

        // Verse 內容超過一屏，保持 snap 關閉以允許自由滾動
        if (targetIndex === 5) {
          originalSnapTypeRef.current = savedStyles.scrollSnapType;
          container.style.scrollSnapType = 'none';
        } else {
          container.style.scrollSnapType = savedStyles.scrollSnapType;
        }
        containerStyleBackupRef.current = null;
      }, ZONE_VEIL_DURATION_MS);
    },
    [clearZoneTransitionTimers, resetFadeIntent, isMobile]
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (zoneTransitionRef.current) return;
      if (transitionCooldownRef.current) return;

      const vh = window.innerHeight;
      const scrollTop = container.scrollTop;
      const direction = scrollTop >= lastScrollTopRef.current ? 'down' : 'up';
      lastScrollTopRef.current = scrollTop;
      /* 手機淡出只由 down 分支推進，往上滑不會再經過它——沒有這道歸零，
         使用者在淡出中途改變主意往回滑，畫面就永遠停在半黑 */
      if (isMobile && direction === 'up') {
        fadeOverlayRef.current?.style.setProperty('--fade-progress', '0');
      }
      const scenes = container.querySelectorAll<HTMLElement>('[data-zone-id]');
      const trans = container.querySelector<HTMLElement>('#journey-start');
      const atlas = container.querySelector<HTMLElement>('#atlas');
      if (trans && isSettledAtElement(trans, scrollTop, vh)) {
        thresholdSettledRef.current = true;
        if (previousSceneRef.current === ATLAS_SCENE_INDEX) {
          previousSceneRef.current = -1;
          setActiveScene(-1);
          return; // 從 Atlas 抵達入口，不允許同一 tick 穿透到 History
        }
      }

      // ── 位置矯正：Hero / Atlas 防脫節 ──
      // 當 scroll snap 把位置拉回但 previousSceneRef 沒跟上時修正
      if (!zoneTransitionRef.current && fadeAccumRef.current === 0 && atlas) {
        const cur = previousSceneRef.current;
        // 明顯在 Hero 範圍但 previousScene 卡在 Atlas
        if (scrollTop < atlas.offsetTop * 0.3 && cur === ATLAS_SCENE_INDEX) {
          previousSceneRef.current = -2;
          thresholdSettledRef.current = false;
          setActiveScene(-2);
          return;
        }
        // 明顯在 Atlas 範圍但 previousScene 卡在 Hero
        if (isSettledAtElement(atlas, scrollTop, vh) && cur === -2) {
          previousSceneRef.current = ATLAS_SCENE_INDEX;
          setActiveScene(ATLAS_SCENE_INDEX);
          return;
        }
      }

      if (direction === 'down') {
        const current = previousSceneRef.current;

        if (isMobile && current === -2 && trans && atlas) {
          const thresholdTop = trans.offsetTop - scrollTop;
          const atlasBottom = atlas.offsetTop + atlas.offsetHeight - scrollTop;
          const hasClearedAtlas = atlasBottom <= vh * 0.28;
          const shouldEnterThreshold = isWithinViewportBand(
            thresholdTop,
            vh,
            MOBILE_DOWN_GATE_MIN,
            MOBILE_DOWN_GATE_MAX
          );

          if (hasClearedAtlas && shouldEnterThreshold) {
            // Atlas→入口：不需要動畫，直接對齊
            alignToThreshold();
            return;
          }
        }

        if (isMobile) {
          /* 目標區塊頂緣穿越 band 的過程就是淡出過程，走到尾段才轉場。
             進度寫進與桌面 wheel fade 同一個 overlay 變數，所以
             startZoneTransition 裡那句「手機預暗化設成 1」變成無縫銜接，
             不再是啪一下全黑。
             回傳「該不該轉場」，順帶把進度落地——三條路徑共用。 */
          const advanceFade = (
            targetTop: number
          ): 'transition' | 'overshoot' | 'none' => {
            const progress = mobileFadeProgress(targetTop, vh);
            fadeOverlayRef.current?.style.setProperty(
              '--fade-progress',
              progress.toFixed(3)
            );
            /* 已經捲過整個觸發窗口：慣性滑動一幀可以跨掉 0.45vh，
               窗口被整個跳過。此時補放轉場只會在使用者早就看到下一區
               之後才蓋幕，比不做更突兀——改為靜默同步狀態，
               與桌面的 overshoot 處理同一個語意。
               沒有這條的話 previousSceneRef 永遠停在前一區，
               之後每個 gate 都對不上，整頁退化成普通長頁捲動。 */
            if (targetTop < MOBILE_DOWN_GATE_MIN * vh) return 'overshoot';
            return progress >= MOBILE_FADE_TRIGGER_PROGRESS
              ? 'transition'
              : 'none';
          };

          /** overshoot 的收尾：狀態跟上，不播動畫 */
          const syncOvershoot = (index: number) => {
            previousSceneRef.current = index;
            setActiveScene(index);
            fadeOverlayRef.current?.style.setProperty('--fade-progress', '0');
          };

          if (current === -1) {
            const firstScene = scenes[0];
            if (firstScene) {
              const verdict = advanceFade(firstScene.offsetTop - scrollTop);
              if (verdict === 'transition') {
                startZoneTransition(0, mergedZonesRef.current[0], 'down');
                return;
              }
              if (verdict === 'overshoot') {
                syncOvershoot(0);
                return;
              }
            }
          } else if (current >= 0 && current < ZONES.length - 1) {
            const nextIndex = current + 1;
            const nextScene = scenes[nextIndex];
            if (nextScene) {
              const verdict = advanceFade(nextScene.offsetTop - scrollTop);
              if (verdict === 'transition') {
                startZoneTransition(
                  nextIndex,
                  mergedZonesRef.current[nextIndex],
                  'down'
                );
                return;
              }
              if (verdict === 'overshoot') {
                syncOvershoot(nextIndex);
                return;
              }
            }
          } else if (current === ZONES.length - 1) {
            const verseEl =
              container.querySelector<HTMLElement>('#verse-section');
            if (verseEl) {
              const verdict = advanceFade(verseEl.offsetTop - scrollTop);
              if (verdict === 'transition') {
                startSectionTransition(verseEl, 5, 'plain', 'down');
                return;
              }
              if (verdict === 'overshoot') {
                syncOvershoot(5);
                return;
              }
            }
          }
        }

        if (!isMobile) {
          if (current === ATLAS_SCENE_INDEX) {
            return;
          }

          if (current === -1) {
            // 桌面入口→History 必須經由 wheel fade，scroll handler 只做 overshoot 同步
            if (!thresholdSettledRef.current) return;
            const firstScene = scenes[0];
            if (firstScene) {
              const firstTop = firstScene.offsetTop - scrollTop;
              if (firstTop < -vh * 0.18) {
                previousSceneRef.current = 0;
                setActiveScene(0);
              }
            }
          } else if (current >= 0 && current < ZONES.length - 1) {
            const currentScene = scenes[current];
            if (currentScene) {
              const boundaryBottom =
                currentScene.offsetTop + currentScene.offsetHeight - scrollTop;
              const nextIndex = current + 1;

              if (
                boundaryBottom <= vh * DESKTOP_DOWN_GATE_MAX &&
                boundaryBottom >= -vh * 0.18
              ) {
                startZoneTransition(
                  nextIndex,
                  mergedZonesRef.current[nextIndex],
                  'down'
                );
                return;
              }

              if (boundaryBottom < -vh * 0.18) {
                previousSceneRef.current = nextIndex;
                setActiveScene(nextIndex);
              }
            }
          } else if (current === ZONES.length - 1) {
            // Storage → Verse：桌面滾動保底（與 zone-to-zone 同模式）
            const currentScene = scenes[current];
            const verseEl =
              container.querySelector<HTMLElement>('#verse-section');
            if (currentScene && verseEl) {
              const boundaryBottom =
                currentScene.offsetTop + currentScene.offsetHeight - scrollTop;
              if (
                boundaryBottom <= vh * DESKTOP_DOWN_GATE_MAX &&
                boundaryBottom >= -vh * 0.18
              ) {
                startSectionTransition(verseEl, 5, 'plain', 'down');
                return;
              }
              if (boundaryBottom < -vh * 0.18) {
                previousSceneRef.current = 5;
                setActiveScene(5);
              }
            }
          }
        }

        if (
          current === -2 &&
          trans &&
          trans.offsetTop - scrollTop < vh * 0.84
        ) {
          setActiveScene(-1);
          return;
        }

        const nextIndex = current < 0 ? 0 : current + 1;
        const nextScene = scenes[nextIndex];
        if (nextScene && nextScene.offsetTop - scrollTop < vh * 0.84) {
          setActiveScene(nextIndex);
          return;
        }

        // 偵測進入 Verse 區塊
        const verseEl = container.querySelector<HTMLElement>('#verse-section');
        if (
          current === 4 &&
          verseEl &&
          verseEl.offsetTop - scrollTop < vh * 0.84
        ) {
          setActiveScene(5);
        }
        return;
      }

      const current = previousSceneRef.current;

      /* 往回捲的淡出——與往下那支 advanceFade 對稱。
         沒有這段的話往上是硬門檻（頂緣下沉超過 0.16vh 就直接轉場），
         使用者看到的是「啪一下」，而往下是漸暗，同一個手勢兩種質感。

         只有手機需要：桌面的往上轉場由 wheel fade 累積，這裡的 scroll
         handler 對桌面只是保底。 */
      const advanceUpFade = (
        currentTop: number
      ): 'transition' | 'overshoot' | 'none' => {
        if (!isMobile) {
          /* 桌面維持原本的硬門檻語意——它的漸變在 wheel handler 裡 */
          return currentTop > vh * DESKTOP_UP_SCROLL_THRESHOLD_VH
            ? 'transition'
            : 'none';
        }
        const progress = mobileUpFadeProgress(currentTop, vh);
        fadeOverlayRef.current?.style.setProperty(
          '--fade-progress',
          progress.toFixed(3)
        );
        /* 慣性一幀可以跨掉整個 band。此時上一區塊早就露出大半，
           補放轉場只會在使用者已經看到之後才蓋幕，比不做更突兀——
           與往下的 overshoot 同一個語意：靜默同步狀態即可。 */
        if (currentTop > vh * MOBILE_UP_GATE_MAX) return 'overshoot';
        return progress >= MOBILE_FADE_TRIGGER_PROGRESS ? 'transition' : 'none';
      };

      /** overshoot 的收尾：狀態跟上，不播動畫 */
      const syncUpOvershoot = (index: number) => {
        previousSceneRef.current = index;
        setActiveScene(index);
        fadeOverlayRef.current?.style.setProperty('--fade-progress', '0');
      };

      // 位置矯正：previousSceneRef 卡在 Storage(4) 但實際已滑到 Verse 附近
      if (current === ZONES.length - 1) {
        const verseEl = container.querySelector<HTMLElement>('#verse-section');
        if (verseEl) {
          const verseTop = verseEl.offsetTop - scrollTop;
          if (verseTop >= -vh * 0.1 && verseTop <= vh * 0.16) {
            previousSceneRef.current = 5;
            setActiveScene(5);
            return;
          }
        }
      }

      // Verse → Storage
      if (current === 5) {
        const verseEl = container.querySelector<HTMLElement>('#verse-section');
        const verseTopRaw = verseEl ? verseEl.offsetTop - scrollTop : 0;

        /* 手機的淡出區間從 0 起算，所以進場條件必須放寬到「頂緣一開始
           下沉」——照桌面那樣等到 > 0.16vh 才進來，那時進度算出來已經是 1，
           漸變等於沒有。 */
        if (
          verseEl &&
          verseTopRaw >
            vh *
              (isMobile
                ? MOBILE_UP_FADE_START_VH
                : DESKTOP_UP_SCROLL_THRESHOLD_VH)
        ) {
          const verseTop = verseTopRaw;

          if (isMobile) {
            /* verseTop 就是「當前區塊頂緣」——current === 5 代表人在 Verse。
               改走漸進淡出後不再需要「來不及就直接全黑」那種補救，
               進度本來就是位置的函數，跟得上任何速度。
               還沒走到觸發點時直接 return：不能落到下面那句無條件的
               `previousSceneRef = 4`，否則狀態會在轉場前就先跳走。 */
            const verdict = advanceUpFade(verseTop);
            if (verdict === 'transition') {
              startZoneTransition(4, mergedZonesRef.current[4], 'up');
            } else if (verdict === 'overshoot') {
              syncUpOvershoot(4);
            }
            return;
          }

          // 輔助：從 Verse 深處快速滾回時 fade 來不及累積，
          // 先強制全黑再播轉場，避免 boot overlay 閃現。
          const ensureFade = () => {
            if (fadeAccumRef.current < FADE_THRESHOLD * 0.5) {
              fadeOverlayRef.current?.style.setProperty('--fade-progress', '1');
              setTimeout(() => resetFadeIntent(), 300);
            }
          };

          // 桌面快速回拉可能直接跨過 up gate，補一層保底觸發。
          if (verseTop <= vh * DESKTOP_UP_GATE_MAX && verseTop >= -vh * 0.12) {
            ensureFade();
            startZoneTransition(4, mergedZonesRef.current[4], 'up');
            return;
          }

          if (verseTop > vh * DESKTOP_UP_GATE_MAX && verseTop <= vh * 0.82) {
            ensureFade();
            startZoneTransition(4, mergedZonesRef.current[4], 'up');
            return;
          }

          if (verseTop > vh * 0.82) {
            previousSceneRef.current = 4;
          }

          // 只要已判定離開 Verse，就同步到 Storage 狀態，避免下一次下滑仍卡在 scene=5。
          previousSceneRef.current = 4;
          setActiveScene(4);
        }
        return;
      }

      if (current >= 1) {
        const currentScene = scenes[current];
        if (currentScene) {
          const targetIndex = current - 1;
          const verdict = advanceUpFade(currentScene.offsetTop - scrollTop);
          if (verdict === 'transition') {
            // mobile / 桌面都觸發轉場，鎖住容器以攔截中鍵自動滾動等快速捲動
            startZoneTransition(
              targetIndex,
              mergedZonesRef.current[targetIndex],
              'up'
            );
          } else if (verdict === 'overshoot') {
            syncUpOvershoot(targetIndex);
          }
        }
        return;
      }

      if (current === 0) {
        const currentScene = scenes[0];
        if (currentScene) {
          const verdict = advanceUpFade(currentScene.offsetTop - scrollTop);
          if (verdict === 'transition') {
            const thresholdEl =
              container.querySelector<HTMLElement>('#journey-start');
            if (thresholdEl) {
              startSectionTransition(thresholdEl, -1, 'plain', 'up');
            }
          } else if (verdict === 'overshoot') {
            syncUpOvershoot(-1);
          }
        }
        return;
      }

      if (current === -1 && trans && trans.offsetTop - scrollTop > vh * 0.16) {
        // 如果 Atlas 在可視範圍內，先到 Atlas 而非直接跳 Hero
        if (atlas && isSettledAtElement(atlas, scrollTop, vh)) {
          previousSceneRef.current = ATLAS_SCENE_INDEX;
          setActiveScene(ATLAS_SCENE_INDEX);
        } else {
          setActiveScene(-2);
        }
        return;
      }

      // Atlas→Hero：scroll snap 把位置拉回 hero 時更新狀態
      if (
        current === ATLAS_SCENE_INDEX &&
        atlas &&
        atlas.offsetTop - scrollTop > vh * 0.16
      ) {
        previousSceneRef.current = -2;
        thresholdSettledRef.current = false;
        setActiveScene(-2);
        return;
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    // 安全閥：每 600ms 檢查一次，防止 overflowY 被永久鎖住
    // 如果不在轉場中但容器仍被鎖定，強制解鎖
    const safetyInterval = setInterval(() => {
      if (
        !zoneTransitionRef.current &&
        !fadingRef.current &&
        container.style.overflowY === 'hidden'
      ) {
        container.style.overflowY = 'auto';
        container.style.touchAction = '';
        containerStyleBackupRef.current = null;
      }
    }, 600);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearInterval(safetyInterval);
    };
  }, [isMobile, alignToThreshold, startSectionTransition, startZoneTransition]);

  // ── Wheel-driven fade：捲動時漸入黑畫面，到閾值後觸發轉場 ──
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: globalThis.WheelEvent) => {
      const wheelTarget = e.target;
      const readingScroller =
        wheelTarget instanceof Element
          ? wheelTarget.closest<HTMLElement>('[data-reading-scroll="true"]')
          : null;

      if (readingScroller) {
        const canScroll =
          readingScroller.scrollHeight > readingScroller.clientHeight + 1;

        if (canScroll) {
          const atTop = readingScroller.scrollTop <= 0;
          const atBottom =
            readingScroller.scrollTop + readingScroller.clientHeight >=
            readingScroller.scrollHeight - 1;
          const scrollingUp = e.deltaY < 0;
          const scrollingDown = e.deltaY > 0;

          // 內容可滾動且未到邊界 → 讓 reading scroller 自行處理
          if (!(scrollingUp && atTop) && !(scrollingDown && atBottom)) {
            resetFadeIntent();
            return;
          }
        }
        // 不可滾動 or 已到邊界 → 防止 reading scroller 與外層同時滾動，
        // 然後繼續走外層的 fade 邏輯
        e.preventDefault();
      }

      // 不在轉場中、不在 fading 中，且目前在 zone scene 內
      if (zoneTransitionRef.current) {
        e.preventDefault();
        return;
      }
      if (transitionCooldownRef.current) {
        e.preventDefault();
        return;
      }
      const current = previousSceneRef.current;

      const delta = Math.abs(e.deltaY);
      const direction = e.deltaY > 0 ? 'down' : 'up';

      // 判斷是否在 zone 邊界
      let targetIndex = -2;
      let sectionTarget: HTMLElement | null = null;
      const scenes = container.querySelectorAll<HTMLElement>('[data-zone-id]');
      const thresholdEl =
        container.querySelector<HTMLElement>('#journey-start');
      const atlasEl = container.querySelector<HTMLElement>('#atlas');
      const vh = window.innerHeight;
      const thresholdSettled =
        thresholdEl !== null &&
        isSettledAtElement(thresholdEl, container.scrollTop, vh);

      if (thresholdSettled) {
        thresholdSettledRef.current = true;
        if (current === ATLAS_SCENE_INDEX) {
          previousSceneRef.current = -1;
          setActiveScene(-1);
        }
      }

      if (direction === 'down' && current === -2 && atlasEl) {
        const atlasTop = atlasEl.offsetTop - container.scrollTop;
        const projectedAtlasTop = atlasTop - e.deltaY;

        if (
          atlasTop <= vh * DESKTOP_DOWN_GATE_MAX ||
          projectedAtlasTop <= vh * DESKTOP_DOWN_GATE_MAX
        ) {
          e.preventDefault();
          resetFadeIntent();
          alignToAtlas();
          return;
        }
      }

      // Verse 內部自由滾動（內容超過一屏）
      if (current === 5) {
        const verseEl = container.querySelector<HTMLElement>('#verse-section');
        if (verseEl) {
          const verseTop = verseEl.offsetTop;
          const maxScroll = verseTop + verseEl.offsetHeight - vh;

          if (direction === 'down' && container.scrollTop < maxScroll - 2) {
            // 還沒到 Verse 底部，手動推進滾動
            e.preventDefault();
            container.style.scrollSnapType = 'none';
            container.scrollTop = Math.min(
              maxScroll,
              container.scrollTop + e.deltaY
            );
            lastScrollTopRef.current = container.scrollTop;
            resetFadeIntent();
            return;
          }

          if (direction === 'up' && container.scrollTop > verseTop + 2) {
            // 在 Verse 內部向上滾動（還沒到頂部）
            e.preventDefault();
            container.style.scrollSnapType = 'none';
            container.scrollTop = Math.max(
              verseTop,
              container.scrollTop + e.deltaY
            );
            lastScrollTopRef.current = container.scrollTop;
            resetFadeIntent();
            return;
          }
          // 已到 Verse 頂部或底部，走正常邊界判斷（up 走 Verse→Storage fade）
        }
      }

      if (direction === 'down') {
        // Atlas→入口：不需要 fade / 遮罩動畫，直接對齊到入口
        if (current === ATLAS_SCENE_INDEX && thresholdEl && atlasEl) {
          const vh = window.innerHeight;
          const atlasBottom =
            atlasEl.offsetTop + atlasEl.offsetHeight - container.scrollTop;
          const projectedAtlasBottom = atlasBottom - e.deltaY;

          if (atlasBottom <= vh * 0.32 || projectedAtlasBottom <= vh * 0.32) {
            e.preventDefault();
            resetFadeIntent();
            alignToThreshold();
            return;
          }
        } else if (
          current === -1 &&
          !thresholdSettledRef.current &&
          !thresholdSettled &&
          thresholdEl
        ) {
          targetIndex = -1;
          sectionTarget = thresholdEl;
        }
        // 從 transition section 進入第一個 zone (History)
        else if (current === -1) {
          if (!thresholdSettledRef.current) {
            resetFadeIntent();
            return;
          }
          const firstScene = scenes[0];
          if (firstScene) {
            const dist = firstScene.offsetTop - container.scrollTop;
            if (
              isWithinViewportBand(
                dist,
                window.innerHeight,
                DESKTOP_DOWN_GATE_MIN,
                DESKTOP_DOWN_GATE_MAX
              )
            ) {
              targetIndex = 0;
            }
          }
        }
        // 從目前 zone 進入下一個 zone
        else if (current >= 0 && current < ZONES.length - 1) {
          const currentScene = scenes[current];
          if (currentScene) {
            const bottom =
              currentScene.offsetTop +
              currentScene.offsetHeight -
              container.scrollTop;
            if (
              isWithinViewportBand(
                bottom,
                window.innerHeight,
                DESKTOP_DOWN_GATE_MIN,
                DESKTOP_DOWN_GATE_MAX
              )
            ) {
              targetIndex = current + 1;
            }
          }
        } else if (current === ZONES.length - 1) {
          // Storage → Verse：用 Storage 底邊偵測，避免 bridge 偏移讓 Verse top 落在 gate band 外
          const currentScene = scenes[current];
          const verseEl =
            container.querySelector<HTMLElement>('#verse-section');
          if (currentScene && verseEl) {
            const bottom =
              currentScene.offsetTop +
              currentScene.offsetHeight -
              container.scrollTop;
            if (
              isWithinViewportBand(
                bottom,
                window.innerHeight,
                DESKTOP_DOWN_GATE_MIN,
                DESKTOP_DOWN_GATE_MAX
              )
            ) {
              targetIndex = 5;
              sectionTarget = verseEl;
            }
          }
        }
      } else if (direction === 'up') {
        if (current === 5) {
          // Verse → Storage：觸發 Storage boot 動畫
          const verseEl =
            container.querySelector<HTMLElement>('#verse-section');
          if (verseEl) {
            const top = verseEl.offsetTop - container.scrollTop;
            if (
              isWithinViewportBand(
                top,
                window.innerHeight,
                DESKTOP_UP_GATE_MIN,
                DESKTOP_UP_GATE_MAX
              )
            ) {
              targetIndex = 4;
            }
          }
        } else if (current >= 1) {
          const currentScene = scenes[current];
          if (currentScene) {
            const top = currentScene.offsetTop - container.scrollTop;
            if (
              isWithinViewportBand(
                top,
                window.innerHeight,
                DESKTOP_UP_GATE_MIN,
                DESKTOP_UP_GATE_MAX
              )
            ) {
              targetIndex = current - 1;
            }
          }
        } else if (current === 0) {
          const currentScene = scenes[0];
          if (currentScene && thresholdEl) {
            const top = currentScene.offsetTop - container.scrollTop;
            if (
              isWithinViewportBand(
                top,
                window.innerHeight,
                DESKTOP_UP_GATE_MIN,
                DESKTOP_UP_GATE_MAX
              )
            ) {
              targetIndex = -1;
              sectionTarget = thresholdEl;
            }
          }
        } else if (current === -1) {
          // Threshold→Atlas：無動畫直接對齊回 Atlas
          e.preventDefault();
          resetFadeIntent();
          alignToAtlas();
          return;
        } else if (current === ATLAS_SCENE_INDEX) {
          // Atlas→Hero：無動畫直接對齊回 Hero
          e.preventDefault();
          resetFadeIntent();
          container.scrollTo({ top: 0, behavior: 'auto' });
          container.scrollTop = 0;
          lastScrollTopRef.current = 0;
          previousSceneRef.current = -2;
          thresholdSettledRef.current = false;
          setActiveScene(-2);
          return;
        }
      }

      if (targetIndex === -2) {
        // 不在邊界，讓正常滾動繼續
        resetFadeIntent();
        return;
      }

      e.preventDefault();

      if (
        fadeDirectionRef.current &&
        (fadeDirectionRef.current !== direction ||
          fadeTargetRef.current !== targetIndex)
      ) {
        fadeAccumRef.current = Math.max(0, fadeAccumRef.current - delta);
        if (fadeAccumRef.current === 0) {
          fadeDirectionRef.current = null;
          fadeTargetRef.current = -2;
        }
        fadeOverlayRef.current?.style.setProperty(
          '--fade-progress',
          String(fadeAccumRef.current / FADE_THRESHOLD)
        );
        return;
      }

      fadeDirectionRef.current = direction;
      fadeTargetRef.current = targetIndex;

      // 攔截滾動，累積 fade
      fadeAccumRef.current = Math.min(
        FADE_THRESHOLD,
        fadeAccumRef.current + delta
      );
      const progress = fadeAccumRef.current / FADE_THRESHOLD;

      if (fadeOverlayRef.current) {
        fadeOverlayRef.current.style.setProperty(
          '--fade-progress',
          String(progress)
        );
      }

      // 達到閾值 → 觸發轉場
      if (progress >= 1 && !fadingRef.current) {
        fadingRef.current = true;
        if (sectionTarget && targetIndex === -1) {
          startSectionTransition(
            sectionTarget,
            -1,
            direction === 'down' ? 'threshold' : 'plain',
            direction,
            {
              preserveFade: true,
            }
          );
          setTimeout(() => {
            resetFadeIntent();
            fadingRef.current = false;
          }, 300);
          return;
        }

        if (sectionTarget && targetIndex === 5) {
          startSectionTransition(sectionTarget, 5, 'plain', 'down', {
            preserveFade: true,
          });
          setTimeout(() => {
            resetFadeIntent();
            fadingRef.current = false;
          }, 300);
          return;
        }

        const nextZone = mergedZonesRef.current[targetIndex];
        if (nextZone) {
          startZoneTransition(
            targetIndex,
            nextZone,
            direction === 'down' ? 'down' : 'up'
          );
          // 延遲重置 fade overlay（等 boot 動畫蓋住後）
          setTimeout(() => {
            resetFadeIntent();
            fadingRef.current = false;
          }, 300);
        } else {
          // nextZone 不存在（資料未載入或索引超界）：立即重置，避免 fadingRef 永久鎖死
          resetFadeIntent();
          fadingRef.current = false;
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [
    alignToAtlas,
    alignToThreshold,
    resetFadeIntent,
    startSectionTransition,
    startZoneTransition,
  ]);

  // activeScene 可被 scroll reveal 提前更新；previousSceneRef 只記錄已落位的空間。
  // 轉場 / fade 累積期間不同步，避免覆蓋正確的落位狀態。
  useEffect(() => {
    if (zoneTransitionRef.current || fadeAccumRef.current > 0) return;
    if (activeScene < 0) {
      previousSceneRef.current = activeScene;
      if (activeScene !== -1) {
        thresholdSettledRef.current = false;
      } else {
        // activeScene 被設為 -1（Threshold）時，需要驗證是否真的落位
        // 避免「以為在 Threshold 但 settled 是 false」的永久卡死
        const container = scrollContainerRef.current;
        const thresholdEl =
          container?.querySelector<HTMLElement>('#journey-start');
        if (container && thresholdEl) {
          thresholdSettledRef.current = isSettledAtElement(
            thresholdEl,
            container.scrollTop,
            window.innerHeight
          );
        }
      }
    }
    if (activeScene === 5) {
      previousSceneRef.current = 5;
    }
  }, [activeScene]);

  useEffect(() => {
    return () => {
      clearZoneTransitionTimers();
      scrollContainerRef.current?.classList.remove('journey-scroll--locked');
    };
  }, [clearZoneTransitionTimers]);

  const handleJourneyNav = useCallback(
    (index: number) => {
      const container = scrollContainerRef.current;
      if (!container) return;
      if (index === -1) {
        const target = container.querySelector<HTMLElement>('#journey-start');
        if (!target) return;
        const direction = previousSceneRef.current > -1 ? 'up' : 'down';
        startSectionTransition(target, -1, 'threshold', direction);
      } else if (index === 5) {
        const target = container.querySelector<HTMLElement>('#verse-section');
        if (!target) return;
        const direction = previousSceneRef.current > 5 ? 'up' : 'down';
        startSectionTransition(target, 5, 'plain', direction);
      } else {
        const zone = mergedZonesRef.current[index];
        if (zone) {
          const direction = index >= previousSceneRef.current ? 'down' : 'up';
          startZoneTransition(index, zone, direction);
        }
      }
    },
    [startSectionTransition, startZoneTransition]
  );

  const handleJourneyEnter = useCallback((zone: ZoneData) => {
    setIntro(zone);
  }, []);

  const renderGlobalVeil = () => {
    if (!veilZone && !sectionVeil) return null;
    const zid = veilZone?.id ?? sectionVeil?.id;
    if (!zid) return null;

    return (
      <div
        key={veilKey}
        className={`home-global-veil home-global-veil--${zid} home-global-veil--${veilDirection}`}
        aria-hidden
      >
        {sectionVeil && sectionVeil.id !== 'plain' && (
          <>
            <div className="hv-threshold-ring hv-threshold-ring--1" />
            <div className="hv-threshold-ring hv-threshold-ring--2" />
            <div className="hv-threshold-line" />
            <div className="hv-threshold-label">{sectionVeil.label}</div>
          </>
        )}

        {/* ── History: 墨暈擴散 ── */}
        {zid === 'history' && (
          <>
            <div className="hv-ink hv-ink--1" />
            <div className="hv-ink hv-ink--2" />
            <div className="hv-ink hv-ink--3" />
            <div className="hv-ink hv-ink--4" />
            <div className="hv-drip hv-drip--1" />
            <div className="hv-drip hv-drip--2" />
            <div className="hv-stroke" />
          </>
        )}

        {/* ── Echoes: 漣漪擴散 ── */}
        {zid === 'echoes' && (
          <>
            <div className="hv-pulse" />
            <div className="hv-wave hv-wave--1" />
            <div className="hv-wave hv-wave--2" />
            <div className="hv-wave hv-wave--3" />
          </>
        )}

        {/* ── Visuals: 幻影閃現 ── */}
        {zid === 'visuals' && (
          <>
            <div className="hv-flash hv-flash--l" />
            <div className="hv-flash hv-flash--r" />
            <div className="hv-flash hv-flash--l2" />
            <div className="hv-flash hv-flash--r2" />
            <div className="hv-grain" />
          </>
        )}

        {/* ── Concepts: CRT 開機 ── */}
        {zid === 'concepts' && (
          <>
            <div className="hv-scanlines" />
            <div className="hv-sweep" />
            <div className="hv-terminal">
              <div className="hv-term-line">
                {'> LOADING CONCEPTS_MODULE...'}
              </div>
              <div className="hv-term-line">{'> ESSENCE_FRAMEWORK [OK]'}</div>
              <div className="hv-term-line">
                {'> READY'}
                <span className="hv-cursor" />
              </div>
            </div>
          </>
        )}

        {/* ── Storage: 箱子掉落 ── */}
        {zid === 'storage' && (
          <>
            <div className="hv-floor" />
            <div className="hv-boxes">
              <div className="hv-box hv-box--1" />
              <div className="hv-box hv-box--2" />
              <div className="hv-box hv-box--3" />
              <div className="hv-box hv-box--4" />
              <div className="hv-box hv-box--5" />
              <div className="hv-box hv-box--6" />
              <div className="hv-box hv-box--7" />
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        overflow: 'hidden',
      }}
    >
      {/* 大廳進入動畫 — 虛無初識 */}
      {lobbyPhase === 'playing' && (
        <div
          className="lobby-overlay lobby-overlay--playing"
          aria-hidden
          onAnimationEnd={handleLobbyAnimEnd}
        >
          <>
            {/* Phase 1 — 墜落速度線 */}
            {LOBBY_STREAKS.map((s, i) => (
              <div
                key={`s${i}`}
                className="lobby-streak"
                style={
                  {
                    left: s.left,
                    height: s.h,
                    '--streak-delay': `${s.delay}s`,
                    '--streak-opacity': s.opacity,
                  } as React.CSSProperties
                }
              />
            ))}
            {/* 亮色限定 — 上升速度線（暗色 CSS 隱藏） */}
            {LOBBY_RISES.map((r, i) => (
              <div
                key={`r${i}`}
                className="lobby-rise"
                style={
                  {
                    left: r.left,
                    height: r.h,
                    '--rise-delay': `${r.delay}s`,
                    '--rise-opacity': r.opacity,
                  } as React.CSSProperties
                }
              />
            ))}
            {/* Phase 2 — 著陸定位 */}
            <div className="lobby-diamond" />
            {/* 衝擊火花 — 菱形著陸瞬間爆射 */}
            {LOBBY_SPARKS.map((sp, i) => (
              <div
                key={`sp${i}`}
                className="lobby-spark"
                style={
                  {
                    width: sp.size,
                    height: sp.size,
                    '--spark-x': `${sp.x}px`,
                    '--spark-y': `${sp.y}px`,
                  } as React.CSSProperties
                }
              />
            ))}
            <div className="lobby-ray lobby-ray--n" />
            <div className="lobby-ray lobby-ray--s" />
            <div className="lobby-ray lobby-ray--e" />
            <div className="lobby-ray lobby-ray--w" />
            <div className="lobby-ring" />
            {/* Phase 2c — 邊際世界 衝擊文字 */}
            <div className="lobby-title">
              {['邊', '際', '世', '界'].map((char, i) => (
                <span
                  key={char}
                  className="lobby-char"
                  style={
                    {
                      '--char-delay': `${1.6 + i * 0.2}s`,
                    } as React.CSSProperties
                  }
                >
                  {char}
                </span>
              ))}
            </div>
            {/* Phase 3 — 微粒 */}
            {LOBBY_MOTES.map((m, i) => (
              <div
                key={i}
                className="lobby-mote"
                style={
                  {
                    top: m.top,
                    left: m.left,
                    '--mote-delay': `${m.delay}s`,
                  } as React.CSSProperties
                }
              />
            ))}
          </>
        </div>
      )}

      <TopBar onOpenMap={() => setShowMap(true)} />

      {/* Scroll-driven 暗幕：wheel 累積驅動漸暗 */}
      <div ref={fadeOverlayRef} className="home-fade-overlay" aria-hidden />

      {renderGlobalVeil()}

      {/* 右側場景導航 */}
      <JourneyNav
        zones={mergedZones}
        activeIndex={activeScene}
        onNavigate={handleJourneyNav}
      />

      {/* 手機專用「回到導覽」：右側導航欄在 760px 以下隱藏，於是往下逛完
          五個 zone 之後沒有任何回入口的捷徑，只能一路往上捲——而往上捲會
          逐一觸發每個 zone 的 up gate 與轉場。
          走的是與導航欄入口鈕同一條 handleJourneyNav(-1)，因此那套
          threshold 轉場動畫（ring/line/label）原封不動沿用。
          只在已經進入 zone 區塊之後出現：Hero／Atlas／入口本身不需要。 */}
      {isMobile && activeScene >= 0 && (
        <button
          type="button"
          className="journey-back-fab"
          onClick={() => handleJourneyNav(-1)}
          aria-label="回到導覽入口"
          title="回到導覽入口"
        >
          <span className="journey-back-fab__glyph" aria-hidden="true">
            ◇
          </span>
          <span className="journey-back-fab__label">導覽</span>
        </button>
      )}

      <div
        ref={scrollContainerRef}
        className="journey-scroll"
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          position: 'relative',
        }}
      >
        {/* ── HERO ── */}
        <section className="home-hero snap-section">
          {/* dust particles */}
          <div
            className="dust-field"
            style={{ color: 'var(--uep-gold)', opacity: 0.4 }}
          >
            {[...Array(18)].map((_, i) => (
              <i
                key={i}
                style={
                  {
                    left: `${(i * 47) % 100}%`,
                    top: `${(i * 29) % 100}%`,
                    animationDuration: `${14 + (i % 6)}s`,
                    animationDelay: `${(i * 0.4) % 8}s`,
                    '--drift-y': '-30px',
                    '--drift-opacity': '0.4',
                  } as React.CSSProperties
                }
              />
            ))}
          </div>

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--uep-gold)',
                letterSpacing: '0.32em',
                textTransform: 'uppercase' as const,
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span
                style={{ width: 32, height: 1, background: 'var(--uep-gold)' }}
              />
              {hero?.kicker ?? 'U.E.P · Imaginary Space'}
            </div>

            <h1
              className="home-hero-h1"
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 500,
                lineHeight: 1.0,
                color: 'var(--ink-title)',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              {hero?.titleMain ?? '世界的'}
              <span style={{ fontStyle: 'italic', fontWeight: 400 }}>
                {hero?.titleAccent ?? '邊際'}
              </span>
              <br />
              <span
                style={{
                  fontSize: 36,
                  fontWeight: 400,
                  fontStyle: 'italic',
                  color: 'var(--uep-gold)',
                  letterSpacing: '0.04em',
                  display: 'inline-block',
                  marginTop: 12,
                }}
              >
                {hero?.subtitleEn ?? 'edge · world · observed'}
              </span>
            </h1>

            {/* Hero 描述 + UEP 對話：有 body HTML 時用 renderHtmlWithUep，否則顯示靜態 fallback */}
            {hero?.body ? (
              <div
                className="home-hero-body"
                style={{
                  fontFamily: 'var(--font-serif-tc)',
                  fontSize: 16,
                  lineHeight: 2,
                  color: 'var(--ink-soft)',
                  maxWidth: 440,
                  marginTop: 28,
                }}
              >
                {renderHtmlWithUep(hero.body, 'hero-body', 'home-prose')}
              </div>
            ) : (
              <>
                <p
                  style={{
                    fontFamily: 'var(--font-serif-tc)',
                    fontSize: 16,
                    lineHeight: 2,
                    color: 'var(--ink-soft)',
                    maxWidth: 440,
                    marginTop: 28,
                    fontWeight: 400,
                  }}
                >
                  你掉到了一個空白的空間，
                  <br />
                  周圍甚麼都沒有 ——
                  <br />
                  一名有著金色頭髮的少女從虛無當中顯現。
                </p>
                <div style={{ marginTop: 28, maxWidth: 460 }}>
                  <UepDialogue
                    side="left"
                    effects={['shimmer', 'halo']}
                    text="你好啊! ╰(*°▽°*)╯ 我的名字叫U.E.P，跟我來，我來跟你介紹一下這裡!"
                  />
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                className="btn-outline btn-outline--gold"
                onClick={() => setShowMap(true)}
              >
                {hero?.buttons?.openMap ?? '✦ 開啟大地圖'}
              </button>
              <a
                href="#journey-start"
                className="btn-outline"
                style={{ textDecoration: 'none' }}
              >
                {hero?.buttons?.startJourney ?? '↓ 開始遊歷'}
              </a>
              {(isDev || isLoggedIn) && (
                <a
                  href="/admin"
                  className="btn-outline"
                  style={{ textDecoration: 'none', opacity: 0.7 }}
                >
                  {hero?.buttons?.admin ?? '⚙ 後台管理'}
                </a>
              )}
            </div>
          </div>

          {/* portrait with outline rings */}
          <div
            className="home-hero-right"
            style={{
              position: 'relative',
              display: 'grid',
              placeItems: 'center',
              minHeight: 460,
            }}
          >
            <div
              style={{
                position: 'absolute',
                width: 380,
                height: 380,
                borderRadius: '50%',
                border: '1px solid var(--uep-gold)',
                opacity: 0.35,
              }}
            />
            <div
              style={{
                position: 'absolute',
                width: 420,
                height: 420,
                borderRadius: '50%',
                border: '1px dashed var(--uep-gold)',
                opacity: 0.18,
                animation: 'slow-rotate 90s linear infinite',
              }}
            />
            <div
              style={{
                position: 'absolute',
                width: '100%',
                height: 1,
                background:
                  'linear-gradient(90deg, transparent, var(--hairline), transparent)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                width: 1,
                height: '100%',
                background:
                  'linear-gradient(180deg, transparent, var(--hairline), transparent)',
              }}
            />

            {/* LCP 主視覺圖：使用 WebP 格式（680×962 @ 2x），fetchpriority 優先載入。
                React 18 不認得 camelCase fetchPriority（React 19 才支援），用小寫 + spread 繞過型別檢查 */}
            <img
              src="/uep/Big-UEP.webp"
              alt="U.E.P"
              className="home-hero-portrait"
              width={340}
              height={481}
              {...{ fetchpriority: 'high' }}
              style={{
                width: 340,
                height: 'auto',
                position: 'relative',
                zIndex: 1,
                filter: 'drop-shadow(0 0 32px rgba(213,182,24,0.2))',
              }}
              draggable={false}
            />

            {['境', '際', '觀', '測'].map((g, i) => (
              <div
                key={i}
                onMouseEnter={() => setHoveredGlyph(i)}
                onMouseLeave={() => setHoveredGlyph(null)}
                onClick={() => handleGlyphClick(i)}
                style={{
                  position: 'absolute',
                  ...[
                    { top: 30, left: 30 },
                    { top: 30, right: 30 },
                    { bottom: 30, left: 30 },
                    { bottom: 30, right: 30 },
                  ][i],
                  fontFamily: 'var(--font-display)',
                  fontSize: 22,
                  color: 'var(--uep-gold)',
                  opacity: hoveredGlyph === i ? 0.85 : 0.45,
                  transition: 'opacity 0.3s ease',
                  cursor: 'default',
                  userSelect: 'none' as const,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {g}
              </div>
            ))}
          </div>
        </section>

        {/* ── ATLAS（世界軸心 Hub） ── */}
        <section
          id="atlas"
          className="home-atlas snap-section"
          style={{
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            className="dust-field"
            style={{ color: 'var(--uep-gold)', opacity: 0.5 }}
          >
            {[...Array(40)].map((_, i) => (
              <i
                key={i}
                style={
                  {
                    left: `${(i * 43) % 100}%`,
                    top: `${(i * 23) % 100}%`,
                    animationDuration: `${12 + (i % 8)}s`,
                    animationDelay: `${(i * 0.3) % 10}s`,
                    '--drift-y': '-50px',
                    '--drift-opacity': '0.5',
                  } as React.CSSProperties
                }
              />
            ))}
          </div>

          <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.32em',
                textTransform: 'uppercase' as const,
                color: 'var(--uep-gold)',
                marginBottom: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span
                style={{ width: 28, height: 1, background: 'var(--uep-gold)' }}
              />
              {atlas?.kicker ?? 'the atlas'}
              <span
                style={{ width: 28, height: 1, background: 'var(--uep-gold)' }}
              />
            </div>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: isMobile ? 40 : 44,
                fontWeight: 500,
                margin: '0 0 6px',
                letterSpacing: '-0.02em',
                color: 'var(--ink-title)',
              }}
            >
              {atlas?.title ?? '邊際世界'}
            </h2>
            <div
              style={{
                fontFamily: 'var(--font-serif-tc)',
                fontSize: 13.5,
                color: 'var(--ink-mute)',
                marginBottom: isMobile ? 12 : 8,
                fontStyle: 'italic',
              }}
            >
              {atlas?.hint ?? '地圖即導航 · 拖曳旋轉 · 上下傾斜 · 點擊區塊進入'}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              position: 'relative',
              minHeight: isMobile ? 300 : 340,
            }}
          >
            <PieMap3D
              zones={mergedZones}
              size={isMobile ? 280 : 420}
              hoveredId={hover}
              onHover={setHover}
              baseTone="light"
              onPickIntro={(z) => setIntro(z)}
            />
          </div>

          {/* legend */}
          <div className="home-legend-grid">
            {mergedZones.map((z, idx) => (
              <div
                key={z.id}
                onMouseEnter={() => setHover(z.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setIntro(z)}
                style={{
                  padding: isMobile ? '12px 10px' : '10px 12px',
                  borderRight: idx < 4 ? '1px solid var(--hairline)' : 'none',
                  cursor: 'pointer',
                  background: hover === z.id ? 'var(--bg-soft)' : 'transparent',
                  transition: 'background .25s var(--ease)',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: zoneTextColor(z.main, isDark),
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase' as const,
                  }}
                >
                  {String(idx + 1).padStart(2, '0')} · {z.en}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: isMobile ? 15 : 15.5,
                    fontWeight: 600,
                    color: 'var(--ink-title)',
                    marginTop: 3,
                  }}
                >
                  {z.label}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-serif-tc)',
                    fontSize: isMobile ? 12 : 11.5,
                    color: 'var(--ink-mute)',
                    marginTop: 2,
                    lineHeight: 1.45,
                  }}
                >
                  {z.atmos}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── BRIDGE: Atlas → Guide ── */}
        <div
          ref={bridgeAtlasRef}
          className={`section-bridge ${bridgeAtlasTriggered ? 'is-visible' : ''}`}
          aria-hidden
        >
          <div className="section-bridge__dot" />
          <div className="section-bridge__line" />
          <div className="section-bridge__dot" />
        </div>

        {/* ── JOURNEY TRANSITION ── */}
        <section
          id="journey-start"
          ref={transitionRef}
          className={`journey-transition ${transTriggered ? 'is-visible' : ''}`}
        >
          <div className="journey-transition__content">
            <div className="journey-transition__kicker reveal-up">
              {journey?.kicker ?? '— 邊際世界遊歷 —'}
            </div>
            <h2
              className="journey-transition__title reveal-up"
              style={{ '--delay': '80ms' } as React.CSSProperties}
            >
              {journey?.title ?? '跟我來吧'}
            </h2>
            <div
              className="journey-transition__divider reveal-scale"
              style={{ '--delay': '160ms' } as React.CSSProperties}
            />
            {/* Journey 旁白 + UEP 台詞：有 body HTML 時用 renderHtmlWithUep，否則顯示靜態 fallback */}
            {journey?.body ? (
              <div className="journey-transition__body">
                {renderHtmlWithUep(
                  journey.body,
                  'journey-body',
                  'journey-prose'
                )}
              </div>
            ) : (
              <>
                {JOURNEY_TRANSITION.narration.map((para, i) => (
                  <p
                    key={i}
                    className="journey-transition__narration reveal-up"
                    style={
                      {
                        '--delay': `${200 + i * 120}ms`,
                      } as React.CSSProperties
                    }
                  >
                    {para}
                  </p>
                ))}
                {JOURNEY_TRANSITION.uepLines.map((line, i) => (
                  <div
                    key={`u-${i}`}
                    className="reveal-up"
                    style={
                      {
                        '--delay': `${500 + i * 150}ms`,
                        marginTop: 12,
                      } as React.CSSProperties
                    }
                  >
                    <UepDialogue
                      side="left"
                      text={line}
                      effects={['shimmer', 'halo']}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        {/* ── ZONE SCENES ── */}
        {journeyScenes.map((item, i) => (
          <JourneyScene
            key={item.zone.id}
            zone={item.zone}
            narrative={item.narrative}
            bodyHtml={item.bodyHtml}
            index={i}
            total={journeyScenes.length}
            onEnterZone={() => handleJourneyEnter(item.zone)}
            isMobile={isMobile}
          />
        ))}

        {/* ── BRIDGE: Storage → Verse ── */}
        <div
          ref={bridgeVerseRef}
          className={`section-bridge ${bridgeVerseTriggered ? 'is-visible' : ''}`}
          aria-hidden
        >
          <div className="section-bridge__dot" />
          <div className="section-bridge__line" />
          <div className="section-bridge__dot" />
        </div>

        {/* ── ETERNAL VERSE ── */}
        <section
          id="verse-section"
          ref={verseRef}
          className={`home-verse snap-section ${verseTriggered ? 'verse-revealed' : 'verse-hidden'}`}
          style={{ position: 'relative' }}
        >
          <div
            style={{ maxWidth: 720, margin: '0 auto', position: 'relative' }}
          >
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.32em',
                  textTransform: 'uppercase' as const,
                  color: 'var(--uep-gold)',
                }}
              >
                {verse?.kicker ?? '· The Eternal Verse ·'}
              </div>
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 36,
                  fontWeight: 500,
                  color: 'var(--ink-title)',
                  margin: '14px 0 6px',
                  letterSpacing: '-0.01em',
                }}
              >
                {verse?.title ?? '永恆的意義'}
              </h2>
              <hr
                style={{
                  border: 0,
                  height: 1,
                  maxWidth: 280,
                  margin: '24px auto 36px',
                  background:
                    'linear-gradient(90deg, transparent, var(--uep-gold), transparent)',
                  opacity: 0.55,
                }}
              />
            </div>

            {/* 詩句：有 body HTML 時按詩節分割、根據可見度渲染，否則顯示靜態 fallback */}
            {verse?.body ? (
              (() => {
                const stanzas = parseVerseStanzas(verse.body);
                const vis = verse.stanzaVisibility ?? stanzas.map(() => true);
                const visibleStanzas = stanzas.filter((_, i) => vis[i] ?? true);
                // 檢查最後一個可見詩節之後是否還有被隱藏的內容
                const lastVisIdx = vis.reduce<number>(
                  (acc, v, i) => (v && i < stanzas.length ? i : acc),
                  -1
                );
                const hasTorn =
                  lastVisIdx >= 0 && lastVisIdx < stanzas.length - 1;
                const visibleHtml = visibleStanzas.join('\n<hr>\n');

                return (
                  <>
                    <div className="home-verse-text home-verse-body">
                      {renderHtmlWithUep(
                        visibleHtml,
                        'verse-body',
                        'verse-prose'
                      )}
                    </div>
                    {hasTorn && (
                      <div className="verse-torn" aria-hidden>
                        <div className="verse-torn__fade" />
                        <div className="verse-torn__crack">
                          <svg
                            viewBox="0 0 400 12"
                            preserveAspectRatio="none"
                            className="verse-torn__svg"
                          >
                            <path
                              d="M0,6 L18,4 L32,8 L55,3 L72,7 L98,2 L115,9 L140,4 L158,7 L180,2 L205,8 L228,3 L250,7 L275,4 L298,9 L320,3 L342,6 L365,2 L385,8 L400,5"
                              fill="none"
                              stroke="var(--uep-gold)"
                              strokeWidth="1"
                              opacity="0.45"
                            />
                          </svg>
                        </div>
                        <div className="verse-torn__fragments">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <span
                              key={i}
                              className="verse-torn__shard"
                              style={{ animationDelay: `${i * 0.6}s` }}
                            />
                          ))}
                        </div>
                        <div className="verse-torn__hint">⋯</div>
                      </div>
                    )}
                  </>
                );
              })()
            ) : (
              <div className="home-verse-text">
                {VERSES.map((v, i) =>
                  v === '—' ? (
                    <hr key={i} />
                  ) : (
                    <div
                      key={i}
                      style={
                        /輪迴|創世|毀滅|聚合|反饋|置換|虛無/.test(v)
                          ? {
                              fontWeight: 600,
                              color: 'var(--uep-gold)',
                              fontStyle: 'italic',
                            }
                          : undefined
                      }
                    >
                      {v}
                    </div>
                  )
                )}
              </div>
            )}

            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--ink-mute)',
                textAlign: 'center',
                marginTop: 32,
                letterSpacing: '0.22em',
                textTransform: 'uppercase' as const,
              }}
            >
              {verse?.inscription ?? '—— inscribed on the wall ——'}
            </div>
          </div>

          {/* ── RECENTS（併入 Verse 區塊） ── */}
          <div
            className="home-recents"
            style={{
              maxWidth: 1400,
              margin: '0 auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 26,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--uep-gold)',
                    letterSpacing: '0.24em',
                    textTransform: 'uppercase' as const,
                    marginBottom: 4,
                  }}
                >
                  · Recent ·
                </div>
                <h3
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 28,
                    fontWeight: 600,
                    color: 'var(--ink-title)',
                    margin: 0,
                  }}
                >
                  最近的觀測
                </h3>
              </div>
            </div>
            <div className="home-recents-grid">
              {recents.length === 0 && (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    padding: '24px 18px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--ink-mute)',
                    letterSpacing: '0.12em',
                    textAlign: 'center',
                  }}
                >
                  — loading —
                </div>
              )}
              {recents.map((r, i) => {
                const z = mergedZones.find((z) => z.id === r.area);
                // echoes 歌曲用 ?song= 參數，其餘用 ?page=
                const paramName =
                  r.area === 'echoes' && r.pageType === 'song'
                    ? 'song'
                    : 'page';
                const dateStr = r.updatedAt
                  ? new Date(r.updatedAt).toLocaleDateString('zh-TW', {
                      month: '2-digit',
                      day: '2-digit',
                    })
                  : '';
                return (
                  <a
                    key={r.id}
                    href={`/${r.area}?${paramName}=${r.slug}`}
                    className={`home-recent-card${i < recents.length - 1 ? ' home-recent-card--bordered' : ''}`}
                  >
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: zoneTextColor(z?.main ?? '', isDark),
                        letterSpacing: '0.16em',
                        textTransform: 'uppercase' as const,
                      }}
                    >
                      · {z?.en}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-serif-tc)',
                        fontSize: 14,
                        color: 'var(--ink-title)',
                        lineHeight: 1.4,
                        fontWeight: 500,
                      }}
                    >
                      {r.title}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--ink-mute)',
                        marginTop: 'auto',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {dateStr}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* minimap */}
      <Minimap
        zones={mergedZones}
        currentId={hover}
        onExpand={() => setShowMap(true)}
        onPickZone={(zid) =>
          setIntro(mergedZones.find((z) => z.id === zid) || null)
        }
        position="bottom-right"
      />

      {/* modals */}
      {showMap && (
        /* lazy 元件必須有 Suspense 邊界；chunk 只有 1.3KB，
           載入期間不需要任何佔位視覺 */
        <Suspense fallback={null}>
          <BigMapModal
            zones={mergedZones}
            tone="dark"
            onClose={() => setShowMap(false)}
            onPick={(z) => {
              setShowMap(false);
              setIntro(z);
            }}
          />
        </Suspense>
      )}

      <IntroOverlay
        zone={intro}
        onClose={() => setIntro(null)}
        onEnter={handleEnterZone}
      />
      <PortalTransition zone={portal} onDone={handlePortalDone} />
    </div>
  );
}
