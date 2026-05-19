import React, { useState, useCallback, useRef, useEffect } from 'react';

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
import BigMapModal from '../ui/BigMapModal';
import IntroOverlay from '../ui/IntroOverlay';
import Minimap from '../ui/Minimap';
import PortalTransition from '../ui/PortalTransition';
import TopBar from '../ui/TopBar';
import UepDialogue from '../ui/UepDialogue';
import renderHtmlWithUep from '../ui/renderHtmlWithUep';

import JourneyNav from './JourneyNav';
import JourneyScene from './JourneyScene';
import './HomePage.css';

const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';
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

function isWithinViewportBand(
  value: number,
  vh: number,
  minRatio: number,
  maxRatio: number
) {
  return value >= vh * minRatio && value <= vh * maxRatio;
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
  // TODO: 恢復 session 檢查時需復原 ready state
  // const [ready, setReady] = useState(false);
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
  // SSR-safe：初始值 false（匹配 server 端），hydrate 後讀取實際 theme
  const [isDark, setIsDark] = useState(false);

  // 進場淡入 + theme 偵測 + 大廳動畫
  useEffect(() => {
    setIsDark(document.documentElement.dataset.theme === 'dark');

    // TODO: 測試結束後恢復 session 檢查（取消下方註解）
    // let seen = false;
    // try { seen = sessionStorage.getItem('uep-lobby-seen') === '1'; } catch {}
    // if (seen) {
    //   const t = setTimeout(() => setReady(true), 80);
    //   return () => clearTimeout(t);
    // }

    // ── 啟用大廳動畫（直接播放，4.2s 足夠讓資源載完） ──
    setLobbyPhase('playing');
    // lobby overlay 已在本次 commit 掛載（z:250），移除 head 注入的遮罩樣式
    document.getElementById('lobby-block-style')?.remove();
  }, []);

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
    try {
      sessionStorage.setItem('uep-lobby-seen', '1');
    } catch {
      /* ignore */
    }
  }, []);

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

      const vh = window.innerHeight;
      const scrollTop = container.scrollTop;
      const direction = scrollTop >= lastScrollTopRef.current ? 'down' : 'up';
      lastScrollTopRef.current = scrollTop;
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
          if (current === -1) {
            const firstScene = scenes[0];
            if (
              firstScene &&
              isWithinViewportBand(
                firstScene.offsetTop - scrollTop,
                vh,
                MOBILE_DOWN_GATE_MIN,
                MOBILE_DOWN_GATE_MAX
              )
            ) {
              startZoneTransition(0, mergedZonesRef.current[0], 'down');
              return;
            }
          } else if (current >= 0 && current < ZONES.length - 1) {
            const nextIndex = current + 1;
            const nextScene = scenes[nextIndex];
            if (
              nextScene &&
              isWithinViewportBand(
                nextScene.offsetTop - scrollTop,
                vh,
                MOBILE_DOWN_GATE_MIN,
                MOBILE_DOWN_GATE_MAX
              )
            ) {
              startZoneTransition(
                nextIndex,
                mergedZonesRef.current[nextIndex],
                'down'
              );
              return;
            }
          } else if (current === ZONES.length - 1) {
            const verseEl =
              container.querySelector<HTMLElement>('#verse-section');
            if (
              verseEl &&
              isWithinViewportBand(
                verseEl.offsetTop - scrollTop,
                vh,
                MOBILE_DOWN_GATE_MIN,
                MOBILE_DOWN_GATE_MAX
              )
            ) {
              startSectionTransition(verseEl, 5, 'plain', 'down');
              return;
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
        if (verseEl && verseEl.offsetTop - scrollTop > vh * 0.16) {
          const verseTop = verseEl.offsetTop - scrollTop;

          // 輔助：從 Verse 深處快速滾回時 fade 來不及累積，
          // 先強制全黑再播轉場，避免 boot overlay 閃現。
          const ensureFade = () => {
            if (fadeAccumRef.current < FADE_THRESHOLD * 0.5) {
              fadeOverlayRef.current?.style.setProperty('--fade-progress', '1');
              setTimeout(() => resetFadeIntent(), 300);
            }
          };

          if (isMobile) {
            if (
              isWithinViewportBand(
                verseTop,
                vh,
                MOBILE_UP_GATE_MIN,
                MOBILE_UP_GATE_MAX
              )
            ) {
              ensureFade();
              startZoneTransition(4, mergedZonesRef.current[4], 'up');
              return;
            }
            // mobile 越過 gate band 的保底
            if (verseTop > vh * MOBILE_UP_GATE_MAX && verseTop <= vh * 0.82) {
              ensureFade();
              startZoneTransition(4, mergedZonesRef.current[4], 'up');
              return;
            }
          }

          if (!isMobile) {
            // 桌面快速回拉可能直接跨過 up gate，補一層保底觸發。
            if (
              verseTop <= vh * DESKTOP_UP_GATE_MAX &&
              verseTop >= -vh * 0.12
            ) {
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
          }

          // 只要已判定離開 Verse，就同步到 Storage 狀態，避免下一次下滑仍卡在 scene=5。
          previousSceneRef.current = 4;
          setActiveScene(4);
        }
        return;
      }

      if (current >= 1) {
        const currentScene = scenes[current];
        if (currentScene && currentScene.offsetTop - scrollTop > vh * 0.16) {
          // mobile / 桌面都觸發轉場，鎖住容器以攔截中鍵自動滾動等快速捲動
          const targetIndex = current - 1;
          startZoneTransition(
            targetIndex,
            mergedZonesRef.current[targetIndex],
            'up'
          );
        }
        return;
      }

      if (current === 0) {
        const currentScene = scenes[0];
        if (currentScene && currentScene.offsetTop - scrollTop > vh * 0.16) {
          const thresholdEl =
            container.querySelector<HTMLElement>('#journey-start');
          if (thresholdEl) {
            startSectionTransition(thresholdEl, -1, 'plain', 'up');
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

        if (!canScroll) {
          e.preventDefault();
        } else {
          const atTop = readingScroller.scrollTop <= 0;
          const atBottom =
            readingScroller.scrollTop + readingScroller.clientHeight >=
            readingScroller.scrollHeight - 1;
          const scrollingUp = e.deltaY < 0;
          const scrollingDown = e.deltaY > 0;

          if ((scrollingUp && atTop) || (scrollingDown && atBottom)) {
            e.preventDefault();
          }
        }

        resetFadeIntent();
        return;
      }

      // 不在轉場中、不在 fading 中，且目前在 zone scene 內
      if (zoneTransitionRef.current) return;
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

            <img
              src="/uep/Big UEP.png"
              alt="U.E.P"
              className="home-hero-portrait"
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
                const dateStr = r.updatedAt
                  ? new Date(r.updatedAt).toLocaleDateString('zh-TW', {
                      month: '2-digit',
                      day: '2-digit',
                    })
                  : '';
                return (
                  <a
                    key={r.id}
                    href={`/${r.area}?page=${r.slug}`}
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
        <BigMapModal
          zones={mergedZones}
          tone="dark"
          onClose={() => setShowMap(false)}
          onPick={(z) => {
            setShowMap(false);
            setIntro(z);
          }}
        />
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
