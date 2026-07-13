/* eslint-disable @typescript-eslint/no-unused-vars */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ZONES } from '../../data/zones';
import { ReaderShell } from '../zone/ReaderShell';
import UepDialogue from '../ui/UepDialogue';
import renderHtmlWithUep from '../ui/renderHtmlWithUep';
import ZoneAtmosphere from '../ui/ZoneAtmosphere';
import EchoesRipple from './EchoesRipple';
import { ZoneBreadcrumb } from '../zone/ZoneBreadcrumb';
import { ZonePrevNext } from '../zone/ZonePrevNext';
import { ZoneStateDisplay } from '../zone/ZoneStateDisplay';
import { useScrollMemory } from '../zone/useScrollMemory';
import { useZoneBootReady } from '../zone/useZoneBootReady';
import { useZoneRouter, pushUrl, clearUrl } from '../zone/useZoneRouter';
import { isHidden, isLocked, getSpoilerLevel } from '../zone/contentVisibility';
import { AudioProvider, getAudioStore, useAudio } from '../../audio';
import { IslandUnlockObject, shouldMountIsland } from '../../islands';
import { useReaderAuth } from '../../auth';
import { useProgress } from '../../progress';
import type { ProgressState } from '../../progress';
import { isSongQueueEligible, isSongUnlockedInZone } from './echoesVisibility';
import './EchoesReader.css';
import { parseEchoesData, type EchoesData } from '../editor/EchoesEditorBody';
import type {
  HomepageBlock,
  ZoneHeaderData,
  UepDialogueItem,
  OrbCluster,
} from '../editor/homepage/types';
import { fromContentBlock } from '../editor/homepage/types';

// ──────────────────────────────────────────────────────────────────
// 型別定義
// ──────────────────────────────────────────────────────────────────
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
  content: {
    id: string;
    type: string;
    content: string;
    attrs?: Record<string, unknown>;
  }[];
  metadata: Record<string, unknown>;
  parentId: string | null;
  depth: number;
  pageType: PageType;
  status: PageStatus;
  updatedAt: string;
}

interface ClusterDef {
  id: string;
  color: string;
  icon: string;
  label: string;
  labelEn: string;
  intro: string;
  uepNote: string;
  subcategories: SubcategoryDef[];
  extraGroups?: string[];
}

interface SubcategoryDef {
  slug: string;
  label: string;
  locked: boolean;
  hint?: string;
  accent?: boolean;
}

// ──────────────────────────────────────────────────────────────────
// 常數
// ──────────────────────────────────────────────────────────────────
const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

const ECHOES_ZONE = { main: '#355C7D', soft: '#6C5B7B', tint: '#F8B195' };

const CLUSTERS: ClusterDef[] = [
  {
    id: 'areas',
    color: '#5B7FB3',
    icon: '▣',
    label: '場景回聲',
    labelEn: 'AREAS · ECHOES OF PLACES',
    intro:
      '藍色的球狀物看上去很歡迎你的到訪，往左右兩側靠齊，讓出了一條路來給你走。',
    uepNote:
      '你不需要去一一嘗試每一個回聲，這個裝置會幫你把它們都整理好喔! o((>ω< ))o',
    subcategories: [
      { slug: 'main', label: '十二分區: 主要區域', locked: false },
      { slug: 'sub', label: '十二分區: 次要區域', locked: false },
      { slug: 'other', label: '十二分區: 其他區域', locked: false },
      {
        slug: 'unk1',
        label: '尼@#?$!@#大陸: ?@?#!',
        locked: true,
        hint: '墨水太過稀薄',
      },
      { slug: 'unk2', label: '*無法解讀的文字*', locked: true },
    ],
  },
  {
    id: 'characters',
    color: '#B86060',
    icon: '◎',
    label: '人物回聲',
    labelEn: 'CHARACTERS · ECHOES OF SOULS',
    intro: '你對於這些紅色版本的回聲很感興趣，每一顆都有它們獨特的氣味。',
    uepNote:
      '這些人其中一定有所謂的主角之類的身分存在，相較於其他的個體而言其影響力更加的廣泛。',
    subcategories: [
      { slug: 'core', label: '核心人物', locked: false, accent: true },
      { slug: 'sub', label: '外圍人物', locked: false },
      { slug: 'other', label: '其他人物', locked: false },
    ],
  },
  {
    id: 'stories',
    color: '#5B9C7A',
    icon: '✦',
    label: '情節回聲',
    labelEn: 'STORIES · ECHOES OF MOMENTS',
    intro:
      '這個區塊的回聲們各個都具有著自己的性格，幾乎每一個回聲個體都對你表現出了一定的敬意。',
    uepNote:
      '這些聲音都只代表著一段時間的記憶 —— 一段短暫、平凡，卻又不可或缺的記憶。',
    subcategories: [
      { slug: 'u', label: '未被記載的傳說 (U)', locked: false },
      { slug: 'e', label: '永*@*?*元 (E)', locked: true },
      { slug: 'p', label: '*無法解讀的文字* (P)', locked: true },
    ],
    extraGroups: [
      '一個類似星座的組合',
      '一個散發彩虹色的組合',
      '一個看上去像是一道鎖的組合',
      '一個閃著橘色與紫色光的組合',
      '一個寫著「1」的組合',
      '一個什麼都沒有的組合',
    ],
  },
  {
    id: 'special',
    color: '#8E6CB6',
    icon: '✺',
    label: '特別回聲',
    labelEn: 'SPECIAL · UNCATEGORIZED ECHOES',
    intro:
      '你朝著四周觀望，能注意到在角落的各處散發著紫色的光芒。意圖接近卻無果，就像是在避開著你似的。',
    uepNote:
      '在白光之中，紫色回聲們向你拉近了距離。這可能就是這種類型的回聲之特殊之處?',
    subcategories: [
      { slug: 'events', label: '特殊事件', locked: false },
      { slug: 'holidays', label: '特殊節日', locked: false },
      { slug: 'unlisted', label: '未被列表', locked: false },
    ],
  },
];

const NOISE_CHARS = '▓░▒█▞▚▙▟▜▛◣◢◤◥░▒▓█@#%&*';
const MUSIC_NOTES = ['♪', '♫', '♩', '♬', '♮', '♭'];

// ──────────────────────────────────────────────────────────────────
// 音訊系統 — S8 起移至 src/audio/（module singleton，跨頁面持久化）。
// AudioProvider/useAudio 介面不變，見 audio/audioContext.tsx。
// ──────────────────────────────────────────────────────────────────

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────────────────────────
// SpoilerTitle — 4 級遮蔽系統
// ──────────────────────────────────────────────────────────────────
function scramble(text: string, seed: number) {
  return [...text]
    .map((c, i) =>
      /\s/.test(c) ? c : NOISE_CHARS[(i + seed) % NOISE_CHARS.length]
    )
    .join('');
}

function SpoilerTitle({
  text,
  level = 0,
  unlocked = false,
  size = 28,
}: {
  text: string;
  level: number;
  unlocked: boolean;
  size?: number;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (level !== 3 || unlocked) return;
    const t = setInterval(() => setTick((x) => x + 1), 110);
    return () => clearInterval(t);
  }, [level, unlocked]);

  if (unlocked || level === 0) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: size,
          fontWeight: 600,
          color: 'var(--ink-title)',
        }}
      >
        {text}
      </span>
    );
  }

  if (level === 1) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: size,
          fontWeight: 600,
          color: 'var(--ink-title)',
          filter: 'blur(6px)',
          userSelect: 'none',
        }}
      >
        {text}
      </span>
    );
  }

  if (level === 2) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: size,
          fontWeight: 600,
          color: 'var(--ink-title)',
          letterSpacing: '0.05em',
          userSelect: 'none',
        }}
      >
        {[...text].map((c) => (/\s/.test(c) ? c : '█')).join('')}
      </span>
    );
  }

  // L3: glitch（單色，無紅藍色差）
  const scrambled = scramble(text, tick);
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        userSelect: 'none',
        fontFamily: 'var(--font-mono)',
        fontSize: size * 0.92,
        fontWeight: 700,
        letterSpacing: '0.05em',
        color: 'var(--ink-title)',
      }}
    >
      {/* 單色殘影層 — 用灰階取代原先的紅/藍色差 */}
      <span
        style={{
          position: 'absolute',
          inset: 0,
          color: 'rgba(200,200,200,0.35)',
          transform: `translate(${(tick % 3) - 1}px, ${(tick % 2) - 1}px)`,
        }}
      >
        {scramble(text, tick + 7)}
      </span>
      <span style={{ position: 'relative' }}>{scrambled}</span>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'repeating-linear-gradient(180deg, transparent 0 2px, rgba(0,0,0,0.18) 2px 3px)',
          pointerEvents: 'none',
        }}
      />
    </span>
  );
}

/** 在文字中隨機穿插雜訊字元 */
function injectNoise(text: string, density = 0.25, seed = 0): string {
  const chars = [...text];
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    result.push(chars[i]);
    if (
      !/\s/.test(chars[i]) &&
      ((i + seed) * 7 + 3) % Math.round(1 / density) === 0
    ) {
      result.push(NOISE_CHARS[(i + seed) % NOISE_CHARS.length]);
    }
  }
  return result.join('');
}

/** 輕量 glitch 文字 — 用於列表項目的 L3 遮蔽（單色，無紅藍色差）*/
function GlitchText({ text }: { text: string }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 120);
    return () => clearInterval(t);
  }, []);

  return (
    <span className="echoes-glitch-inline">
      <span className="echoes-glitch-ghost">{scramble(text, tick + 5)}</span>
      <span className="echoes-glitch-main">{scramble(text, tick)}</span>
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
// VinylDisc — 唱片圖形
// ──────────────────────────────────────────────────────────────────
function VinylDisc({
  isPlaying,
  isLocked,
  color,
  coverImage,
}: {
  isPlaying: boolean;
  isLocked: boolean;
  color: string;
  coverImage?: string | null;
}) {
  const coverUrl = coverImage
    ? `${API_BASE}/api/assets/${coverImage
        .split('/')
        .map((s) => encodeURIComponent(s))
        .join('/')}`
    : null;

  return (
    <div className="echoes-vinyl-wrap">
      {/* 外圈：旋轉碟片，背景為封面圖或溝槽 */}
      <div
        className="echoes-vinyl"
        style={{
          ...(coverUrl
            ? { backgroundImage: `url(${coverUrl})` }
            : {
                background: `radial-gradient(circle at 50% 50%, ${color} 0%, ${color} 11%, var(--vinyl-body, #e8e4de) 13%, var(--vinyl-edge, #d5d0c8) 100%)`,
              }),
          animationPlayState: isPlaying ? 'running' : 'paused',
        }}
      >
        {!coverUrl &&
          Array.from({ length: 10 }, (_, i) => (
            <span
              key={i}
              className="echoes-vinyl-ring"
              style={{ inset: `${10 + i * 4}%` }}
            />
          ))}
      </div>
      {/* 中心孔：固定不旋轉，疊在碟片上方 */}
      <div className="echoes-vinyl-center">
        <span className="echoes-vinyl-hole" />
      </div>
      {isLocked && (
        <div className="echoes-vinyl-lock">
          <span>SEALED</span>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// EchoesAudioPlayer
// ──────────────────────────────────────────────────────────────────
function EchoesAudioPlayer({
  songId,
  title,
  audioUrl,
  metaDuration,
  color,
  locked = false,
  onLockedClick,
  sealed = false,
  onAddToQueue,
}: {
  songId: string;
  title: string;
  audioUrl: string | null;
  metaDuration?: number;
  color: string;
  locked?: boolean;
  onLockedClick?: () => void;
  /** L3 封印：已確認 spoiler 警告但等級仍為 3——完全不可播放（S8 取代 30 秒 preview） */
  sealed?: boolean;
  /** 加入流浪回聲佇列（S8 B-4）：僅 spoiler 0 才傳入 */
  onAddToQueue?: () => void;
}) {
  const a = useAudio();
  const isMe = a.currentSongId === songId;
  const playing = isMe && a.isPlaying;
  const cur = isMe ? a.currentTime : 0;
  const prog = isMe ? a.progress : 0;
  const dur = isMe && a.duration > 0 ? a.duration : metaDuration || 0;
  const disabled = locked || sealed || !audioUrl;

  // 本地拖曳進度（避免 RAF 在拖曳期間覆蓋受控 input）
  const [seekProg, setSeekProg] = useState<number | null>(null);
  const isSeeking = seekProg !== null;
  const displayProg = isSeeking ? seekProg : prog;

  // 音量面板開關（雙狀態：mounted 控制 DOM 存在，open 控制動畫）
  const [volMounted, setVolMounted] = useState(false);
  const [volOpen, setVolOpen] = useState(false);
  const volRef = useRef<HTMLDivElement>(null);
  const volCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openVol = useCallback(() => {
    if (volCloseTimer.current) clearTimeout(volCloseTimer.current);
    setVolMounted(true);
    // 等一幀讓 DOM 掛載後再加 is-open，使 transition 觸發
    requestAnimationFrame(() => requestAnimationFrame(() => setVolOpen(true)));
  }, []);

  const closeVol = useCallback(() => {
    setVolOpen(false);
    volCloseTimer.current = setTimeout(() => setVolMounted(false), 240);
  }, []);

  // 元件卸載時清除計時器
  useEffect(() => {
    return () => {
      if (volCloseTimer.current) clearTimeout(volCloseTimer.current);
    };
  }, []);

  // 點擊外部關閉
  useEffect(() => {
    if (!volMounted) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (volRef.current && !volRef.current.contains(e.target as Node)) {
        closeVol();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [volMounted, closeVol]);

  const handlePlay = () => {
    if (locked) {
      onLockedClick?.();
      return;
    }
    // L3 封印：完全不可播放（S8 取代既有 30 秒 preview）
    if (sealed || !audioUrl) return;
    a.toggle(songId, audioUrl, title, color);
  };

  const handleSeekPointerDown = () => {
    if (isMe) a.beginSeek();
    setSeekProg(displayProg);
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSeekProg(parseFloat(e.target.value));
  };

  const commitSeek = (val: number) => {
    // 鎖定或無音源時不做任何操作，避免影響其他歌曲的播放
    if (disabled) {
      setSeekProg(null);
      return;
    }
    setSeekProg(null);
    // 一律呼叫 endSeek 重置 isSeekingRef，避免殘留阻塞 RAF 進度更新
    a.endSeek(val);
    if (!isMe && audioUrl && !locked) {
      // 歌曲尚未播放：先啟動再 seek
      a.play(songId, audioUrl, title, color);
      setTimeout(() => a.seek(val), 50);
    }
  };

  const handleSeekPointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    const val = seekProg ?? parseFloat((e.target as HTMLInputElement).value);
    commitSeek(val);
  };

  return (
    <div
      className="echoes-player"
      style={{
        borderColor: isMe ? color : 'var(--line)',
        background: isMe ? `${color}10` : 'var(--bg-card)',
        filter: locked || sealed ? 'grayscale(0.6)' : 'none',
        opacity: locked || sealed ? 0.5 : 1,
      }}
    >
      <button
        className="echoes-player-btn"
        disabled={disabled}
        onClick={handlePlay}
        style={{
          borderColor: color,
          background: playing ? color : 'transparent',
          color: playing ? '#fff' : color,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        type="button"
      >
        <span
          className={`echoes-player-icon ${
            playing ? 'echoes-player-icon-pause' : 'echoes-player-icon-play'
          }`}
          aria-hidden="true"
        />
      </button>

      <div className="echoes-player-bar">
        <div className="echoes-player-track">
          <div
            className={`echoes-player-fill${isSeeking ? ' is-seeking' : ''}`}
            style={{ width: `${displayProg * 100}%`, background: color }}
          />
          <div
            className={`echoes-player-thumb${isSeeking ? ' is-seeking' : ''}`}
            style={{
              left: `${displayProg * 100}%`,
              background: color,
              boxShadow: `0 0 6px ${color}`,
              opacity: isMe || isSeeking ? 1 : 0,
            }}
          />
        </div>
        <input
          type="range"
          className="echoes-player-seek"
          min={0}
          max={1}
          step={0.001}
          value={displayProg}
          onChange={handleSeekChange}
          onPointerDown={handleSeekPointerDown}
          onPointerUp={handleSeekPointerUp}
          disabled={disabled}
        />
        <div className="echoes-player-times">
          <span>{fmtTime(cur)}</span>
          <span>{dur > 0 ? fmtTime(dur) : '--:--'}</span>
        </div>
      </div>

      <div className="echoes-player-actions">
        {/* 加入流浪回聲佇列（S8 B-4：僅 spoiler 0 才出現） */}
        {onAddToQueue && (
          <button
            type="button"
            className="echoes-player-queue-btn"
            onClick={onAddToQueue}
            aria-label="加入流浪回聲佇列"
            title="加入流浪回聲佇列"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3.5 5.5h7M3.5 10h5M3.5 14.5h7M15 9v6M12 12h6" />
            </svg>
          </button>
        )}

        {/* 音量控制（可展開） */}
        <div className="echoes-player-vol" ref={volRef}>
          {volMounted && (
            <div
              className={`echoes-player-vol-popup${volOpen ? ' is-open' : ''}`}
            >
              <span className="echoes-player-vol-pct">
                {Math.round(a.volume * 100)}%
              </span>
              <input
                type="range"
                className="echoes-player-vol-slider"
                style={{ '--vol': a.volume } as React.CSSProperties}
                min={0}
                max={1}
                step={0.05}
                value={a.volume}
                onChange={(e) => a.setVolume(parseFloat(e.target.value))}
              />
            </div>
          )}
          <button
            type="button"
            className="echoes-player-vol-btn"
            onClick={() => (volMounted ? closeVol() : openVol())}
            aria-label={`音量 ${Math.round(a.volume * 100)}%`}
            title={`音量 ${Math.round(a.volume * 100)}%`}
          >
            <svg
              className="echoes-player-volume-icon"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                className="echoes-player-volume-body"
                d="M3.5 8h3l4-3.25v10.5L6.5 12h-3z"
              />
              {a.volume === 0 ? (
                <path
                  className="echoes-player-volume-wave"
                  d="m13.25 7.25 4.5 5.5m0-5.5-4.5 5.5"
                />
              ) : (
                <>
                  <path
                    className="echoes-player-volume-wave"
                    d="M13 7.25c1.2 1.45 1.2 4.05 0 5.5"
                  />
                  {a.volume >= 0.4 && (
                    <path
                      className="echoes-player-volume-wave"
                      d="M15.4 5.25c2.35 2.55 2.35 6.95 0 9.5"
                    />
                  )}
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      <span
        className="echoes-player-status"
        style={{
          color: sealed ? 'crimson' : isMe ? color : 'var(--ink-mute)',
        }}
      >
        {locked
          ? 'LOCKED'
          : sealed
            ? 'SEALED · 現在的你還無法聆聽這首回聲'
            : playing
              ? 'NOW PLAYING'
              : 'STANDBY'}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 工具函式（遞迴遍歷，支援任意深度巢狀）
// ──────────────────────────────────────────────────────────────────

/**
 * 遞迴收集節點下所有 song。
 * S8：未解鎖歌曲完全隱藏（解鎖凌駕於所有 spoiler 之上，同 Concepts
 * dossier 語意）；容器維持既有 hidden / 靜態鎖語意。
 */
function collectSongs(
  node: PageTreeNode,
  progress: ProgressState | null
): PageTreeNode[] {
  const songs: PageTreeNode[] = [];
  for (const child of node.children || []) {
    if (isHidden(child)) continue;
    if (child.pageType === 'song') {
      if (isSongUnlockedInZone(child, progress)) songs.push(child);
    } else {
      if (isLocked(child)) continue;
      songs.push(...collectSongs(child, progress));
    }
  }
  return songs;
}

/** 遞迴計算節點下所有可見（已解鎖）song 數量 */
function countSongs(
  node: PageTreeNode,
  progress: ProgressState | null
): number {
  let count = 0;
  for (const child of node.children || []) {
    if (isHidden(child)) continue;
    if (child.pageType === 'song') {
      if (isSongUnlockedInZone(child, progress)) count++;
    } else count += countSongs(child, progress);
  }
  return count;
}

/** 從 tree 中找到指定 cluster 節點 */
function findClusterNode(
  tree: PageTreeNode[],
  clusterId: string
): PageTreeNode | null {
  for (const root of tree) {
    for (const cluster of root.children || []) {
      // 用 slug 尾段比對（slug 可能是 "areas" 或含路徑 "areas"）
      const slugTail = cluster.slug.split('/').pop();
      if (slugTail === clusterId || cluster.slug === clusterId) return cluster;
    }
  }
  return null;
}

/** 從 nodeId 推導所屬 cluster 的 ID */
function findClusterForNode(
  tree: PageTreeNode[],
  nodeId: string
): string | null {
  for (const root of tree) {
    for (const cluster of root.children || []) {
      if (cluster.id === nodeId || nodeId.startsWith(cluster.id + '/')) {
        return cluster.slug.split('/').pop() || cluster.slug;
      }
    }
  }
  return null;
}

function getClusterDef(id: string): ClusterDef | undefined {
  return CLUSTERS.find((c) => c.id === id);
}

/** 從樹中取得指定節點 ID 所屬的最近 subcategory 的所有歌曲（用於 prev/next）*/
function getSongsInParentSubcat(
  tree: PageTreeNode[],
  songId: string,
  progress: ProgressState | null
): PageTreeNode[] {
  // 從 songId 往上找到 parent subcategory
  function findParentAndCollect(node: PageTreeNode): PageTreeNode[] | null {
    for (const child of node.children || []) {
      if (child.id === songId) {
        // 找到了，收集同層的所有 songs
        return collectSongs(node, progress);
      }
      const result = findParentAndCollect(child);
      if (result) return result;
    }
    return null;
  }

  for (const root of tree) {
    const result = findParentAndCollect(root);
    if (result) return result;
  }
  return [];
}

/** 從 tree 取得 cluster 下的歌曲總數 */
function countSongsInCluster(
  tree: PageTreeNode[],
  clusterId: string,
  progress: ProgressState | null
): number {
  const cluster = findClusterNode(tree, clusterId);
  return cluster ? countSongs(cluster, progress) : 0;
}

/** 渲染 landing HTML：把 card-grid 替換為集群卡片插入標記 */
function renderLandingHtml(blocks: Page['content']): string {
  if (!blocks?.length) return '';
  const html = blocks.map((b) => b.content || '').join('\n');
  // 將 card-grid（GitBook 匯入的導航卡片）替換為插入點
  return html.replace(
    /<div class="card-grid">[\s\S]*?<\/div>/,
    '<div data-echoes-cluster-slot="true"></div>'
  );
}

function splitLandingHtml(html: string) {
  const marker = '<div data-echoes-cluster-slot="true"></div>';
  const idx = html.indexOf(marker);
  if (idx < 0) return { before: html, after: '' };
  return {
    before: html.slice(0, idx),
    after: html.slice(idx + marker.length),
  };
}

function buildAudioUrl(audioFile: string | null): string | null {
  if (!audioFile) return null;
  // 音檔存在 content-api 的 assets 端點；檔名可能含空白或特殊字元需要 encode
  const encoded = audioFile
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${API_BASE}/api/assets/${encoded}`;
}

// ──────────────────────────────────────────────────────────────────
// 主元件內層（必須是 AudioProvider 的子元件才能用 useAudio）
// ──────────────────────────────────────────────────────────────────
function EchoesReaderInner() {
  const echoesZone = ZONES.find((z) => z.id === 'echoes') || ZONES[0];

  // === 進度狀態（S8：歌曲解鎖判定，未解鎖完全隱藏）===
  const progress = useProgress();
  // auth 純訂閱重渲染——shouldMountIsland 內含登入判定，而 auth 變化
  // 不保證觸發 progress notify（S7-C 已知陷阱，同 IslandHost 的處理）
  useReaderAuth();

  // === 內容狀態 ===
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [landingPages, setLandingPages] = useState<Record<string, Page>>({});
  const [landingLoading, setLandingLoading] = useState(false);

  // === 導航狀態 ===
  type View = 'landing' | 'cluster' | 'content' | 'song';
  const [view, setView] = useState<View>('landing');
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  const [activeSongId, setActiveSongId] = useState<string | null>(null);
  const [activeContentId, setActiveContentId] = useState<string | null>(null);
  const [currentSongPage, setCurrentSongPage] = useState<Page | null>(null);
  const [currentContentPage, setCurrentContentPage] = useState<Page | null>(
    null
  );
  const [songLoading, setSongLoading] = useState(false);
  const [songError, setSongError] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [transitionKey, setTransitionKey] = useState(0);

  // === Spoiler ===
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [spoilerWarning, setSpoilerWarning] = useState<{
    songId: string;
    level: number;
    gate: string;
    onConfirm: () => void;
  } | null>(null);

  // === UI ===
  const scrollRef = useRef<HTMLDivElement>(null);

  // === 滾動位置記憶 ===
  const { saveScroll, restoreScroll } = useScrollMemory(scrollRef, [
    view,
    activeClusterId,
    activeContentId,
    activeSongId,
  ]);

  /** 根據目前視圖狀態回傳唯一的捲軸記憶 key */
  function currentScrollKey(): string {
    if (view === 'song' && activeSongId) return `song:${activeSongId}`;
    if (view === 'content' && activeContentId)
      return `content:${activeContentId}`;
    if (view === 'cluster' && activeClusterId)
      return `cluster:${activeClusterId}`;
    return 'landing';
  }

  // === 初始化 ===
  useEffect(() => {
    void fetchTree();
  }, []);

  // === 從樹中提取 page 層級節點 (plaza, photo) ===
  const flatPages = useMemo(() => {
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

  const pageLevelNodes = useMemo(
    () => flatPages.filter((p) => p.pageType === 'page'),
    [flatPages]
  );

  const plazaNode = pageLevelNodes.find((p) => p.id === 'echoes/plaza') || null;
  const photoNode = pageLevelNodes.find((p) => p.id === 'echoes/photo') || null;
  const plazaPage = plazaNode ? landingPages[plazaNode.id] : null;
  const photoPage = photoNode ? landingPages[photoNode.id] : null;

  // 首頁區塊資料
  const [homepageBlocks, setHomepageBlocks] = useState<HomepageBlock[]>([]);
  // 使用統一的 boot ready hook 管理開機動畫解除時機
  const { contentReady, markContentReady, setNavPending } = useZoneBootReady();

  // === 載入 landing 頁面內容 ===
  useEffect(() => {
    if (!pageLevelNodes.length) return;
    void fetchLandingPages(pageLevelNodes);
  }, [pageLevelNodes]);

  // 載入首頁區塊資料；完成後交由 hook 計算最短顯示時間與安全超時
  useEffect(() => {
    fetch(`${API_BASE}/api/content/echoes/homepage`)
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
        // 通知 hook 首頁資料已就緒，由 hook 統一管理延遲與超時
        markContentReady();
      });
  }, [markContentReady]);

  const hpHeader = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'zone-header');
    return b ? (b.data as ZoneHeaderData) : null;
  }, [homepageBlocks]);

  const hpDialogues = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'uep-dialogue');
    return b ? (b.data as UepDialogueItem[]) : null;
  }, [homepageBlocks]);

  const hpClusters = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'orb-cluster-grid');
    return b ? (b.data as { clusters: OrbCluster[] }).clusters : null;
  }, [homepageBlocks]);

  const hpRichTexts = useMemo(() => {
    return homepageBlocks
      .filter((b) => b.type === 'rich-text')
      .map((b) => (b.data as { html: string }).html);
  }, [homepageBlocks]);

  async function fetchLandingPages(nodes: PageTreeNode[]) {
    setLandingLoading(true);
    try {
      const entries = await Promise.all(
        nodes.map(async (node) => {
          const res = await fetch(`${API_BASE}/api/content/${node.id}`);
          if (!res.ok) return [node.id, null] as const;
          const json = (await res.json()) as { ok: boolean; data: Page };
          return [node.id, json.ok ? json.data : null] as const;
        })
      );
      setLandingPages(
        Object.fromEntries(entries.filter(([, v]) => v !== null)) as Record<
          string,
          Page
        >
      );
    } catch (err) {
      console.error('Failed to load echoes landing pages:', err);
    } finally {
      setLandingLoading(false);
    }
  }

  // === URL 路由（useZoneRouter 統一管理 deep link 與 popstate）===
  useZoneRouter({
    routes: [
      {
        param: 'song',
        handler: (value) => {
          // 統一用 slug（不帶 area prefix），向後相容帶 prefix 的舊連結
          const fullId = value.startsWith('echoes/')
            ? value
            : `echoes/${value}`;
          void navigateToSong(fullId, false);
        },
      },
      {
        param: 'page',
        handler: (value) => {
          const fullId = value.startsWith('echoes/')
            ? value
            : `echoes/${value}`;
          void navigateToContent(fullId, false);
        },
      },
      {
        param: 'cluster',
        handler: (value) => {
          // cluster 用 CLUSTERS 常數的短 id（areas/characters/...），
          // 與 song/page 的完整頁 id 不同——不可補 echoes/ 前綴，
          // 反而要容錯剝掉舊連結可能帶的前綴
          navigateToCluster(value.replace(/^echoes\//, ''), false);
        },
      },
    ],
    onLanding: () => navigateToLanding(false),
    treeReady: tree.length > 0,
    setBootNavPending: setNavPending,
  });

  // === API 呼叫 ===
  async function fetchTree() {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const res = await fetch(`${API_BASE}/api/content/echoes/tree`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        data: PageTreeNode[];
        error?: string;
      };
      if (!json.ok) throw new Error(json.error || 'API returned ok=false');
      setTree(json.data || []);
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreeLoading(false);
    }
  }

  async function fetchSong(id: string) {
    setSongLoading(true);
    setSongError(null);
    try {
      const res = await fetch(`${API_BASE}/api/content/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        data: Page;
        error?: string;
      };
      if (!json.ok) throw new Error(json.error || 'API returned ok=false');
      setCurrentSongPage(json.data);
    } catch (err) {
      setSongError(err instanceof Error ? err.message : String(err));
    } finally {
      setSongLoading(false);
    }
  }

  // === 導航函式 ===
  function navigateToLanding(pushState = true) {
    saveScroll(currentScrollKey());
    setView('landing');
    setActiveClusterId(null);
    setActiveSongId(null);
    setCurrentSongPage(null);
    setTransitionKey((k) => k + 1);
    restoreScroll('landing');
    if (pushState) clearUrl();
  }

  function navigateToCluster(clusterId: string, pushState = true) {
    saveScroll(currentScrollKey());
    setView('cluster');
    setActiveClusterId(clusterId);
    setActiveSongId(null);
    setActiveContentId(null);
    setCurrentSongPage(null);
    setCurrentContentPage(null);
    setTransitionKey((k) => k + 1);
    restoreScroll(`cluster:${clusterId}`);
    if (pushState) pushUrl({ cluster: clusterId.replace(/^echoes\//, '') });
    setNavPending(false);
  }

  /** 導航到非 song 的內容頁面（subcategory 等），比照 History 的閱讀視圖 */
  async function navigateToContent(pageId: string, pushState = true) {
    saveScroll(currentScrollKey());
    setView('content');
    setActiveContentId(pageId);
    setActiveSongId(null);
    setCurrentSongPage(null);
    // 推導所屬 cluster
    const clusterId = findClusterForNode(tree, pageId);
    if (clusterId) {
      setActiveClusterId(clusterId);
    }
    restoreScroll(`content:${pageId}`);
    setContentLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/content/${pageId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { ok: boolean; data: Page };
      if (json.ok) setCurrentContentPage(json.data);
    } catch (err) {
      console.error('Failed to load content page:', err);
    } finally {
      setContentLoading(false);
      setTransitionKey((k) => k + 1);
      setNavPending(false);
    }
    if (pushState)
      pushUrl({
        page: pageId.replace(/^echoes\//, ''),
        ...(clusterId ? { cluster: clusterId.replace(/^echoes\//, '') } : {}),
      });
  }

  async function navigateToSong(songId: string, pushState = true) {
    saveScroll(currentScrollKey());
    setView('song');
    setActiveSongId(songId);
    // 從 song ID 推導所屬集群
    const clusterId = findClusterForNode(tree, songId);
    if (clusterId) {
      setActiveClusterId(clusterId);
    }
    restoreScroll(`song:${songId}`);
    await fetchSong(songId);
    setTransitionKey((k) => k + 1);
    setNavPending(false);
    if (pushState)
      pushUrl({
        song: songId.replace(/^echoes\//, ''),
        ...(clusterId ? { cluster: clusterId.replace(/^echoes\//, '') } : {}),
      });
  }

  function isSongUnlocked(songId: string) {
    return unlocked.has(songId);
  }

  function requestUnlock(
    songId: string,
    level: number,
    gate: string,
    onConfirm: () => void
  ) {
    setSpoilerWarning({ songId, level, gate, onConfirm });
  }

  function confirmUnlock() {
    if (!spoilerWarning) return;
    setUnlocked((prev) => new Set([...prev, spoilerWarning.songId]));
    spoilerWarning.onConfirm();
    setSpoilerWarning(null);
  }

  // === 從 song page 取得 EchoesData ===
  const songData: EchoesData | null = currentSongPage
    ? parseEchoesData(currentSongPage.metadata)
    : null;

  // === 取得當前歌曲的集群資訊 ===
  const activeSongCluster = activeClusterId
    ? getClusterDef(activeClusterId)
    : null;

  // === Audio hook（必須在元件頂層呼叫）===
  const audio = useAudio();

  // === Prev/Next 歌曲 (同一 parent subcategory) ===
  const subcatSongs = useMemo(() => {
    if (!activeSongId || !tree.length) return [];
    return getSongsInParentSubcat(tree, activeSongId, progress);
  }, [tree, activeSongId, progress]);

  const songIndex = activeSongId
    ? subcatSongs.findIndex((s) => s.id === activeSongId)
    : -1;
  const prevSong = songIndex > 0 ? subcatSongs[songIndex - 1] : null;
  const nextSong =
    songIndex >= 0 && songIndex < subcatSongs.length - 1
      ? subcatSongs[songIndex + 1]
      : null;

  // ────────────────────────────────────────────────────────────────
  // Landing 視圖
  // ────────────────────────────────────────────────────────────────
  function renderLanding() {
    const landingHtml = plazaPage ? renderLandingHtml(plazaPage.content) : '';
    const landingParts = splitLandingHtml(landingHtml);

    return (
      <section className="echoes-landing">
        <div className="echoes-landing-inner">
          {homepageBlocks.length > 0 ? (
            /* ── 資料驅動：按區塊順序渲染 ── */
            homepageBlocks.map((block) => {
              if (block.hidden) return null;
              switch (block.type) {
                case 'zone-header': {
                  const d = block.data as ZoneHeaderData;
                  return (
                    <div key={block.id}>
                      <div className="echoes-kicker">Volume II · ECHOES</div>
                      <h1 className="echoes-landing-title">{d.title}</h1>
                      {d.subtitle && (
                        <p className="echoes-landing-blurb">{d.subtitle}</p>
                      )}
                    </div>
                  );
                }
                case 'uep-dialogue': {
                  const items = block.data as UepDialogueItem[];
                  return (
                    <div key={block.id} className="echoes-landing-uep">
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
                case 'orb-cluster-grid': {
                  const clusters = (block.data as { clusters: OrbCluster[] })
                    .clusters;
                  return (
                    <div key={block.id} className="echoes-cluster-grid">
                      {CLUSTERS.map((cluster, idx) => {
                        const hp = clusters[idx];
                        const color = hp?.color || cluster.color;
                        const label = hp?.label || cluster.label;
                        const songCount = countSongsInCluster(
                          tree,
                          cluster.id,
                          progress
                        );
                        const orbCount = Math.max(songCount, 6);
                        // 內圈最多 40 個，超出的到外圈
                        const innerCount = Math.min(orbCount, 40);
                        const outerCount = Math.max(orbCount - 40, 0);
                        return (
                          <button
                            key={cluster.id}
                            type="button"
                            className="echoes-cluster-card"
                            style={{
                              ['--cluster-color' as string]: color,
                              borderTopColor: color,
                            }}
                            onClick={() => navigateToCluster(cluster.id)}
                          >
                            <div className="echoes-orb-field">
                              {/* 內圈 */}
                              {Array.from({ length: innerCount }, (_, k) => {
                                const angle = (k / innerCount) * Math.PI * 2;
                                const r = 36 + (k % 2) * 8;
                                return (
                                  <span
                                    key={k}
                                    className="echoes-orb-particle"
                                    style={{
                                      left: 55 + Math.cos(angle) * r - 5,
                                      top: 55 + Math.sin(angle) * r - 5,
                                      background: color,
                                      opacity: 0.4 + (k % 3) * 0.2,
                                      boxShadow: `0 0 8px ${color}`,
                                      animationDelay: `${k * 0.2}s`,
                                    }}
                                  />
                                );
                              })}
                              {/* 外圈（超過 40 時） */}
                              {Array.from({ length: outerCount }, (_, k) => {
                                const angle = (k / outerCount) * Math.PI * 2;
                                const r = 56 + (k % 2) * 8;
                                return (
                                  <span
                                    key={`o${k}`}
                                    className="echoes-orb-particle"
                                    style={{
                                      left: 55 + Math.cos(angle) * r - 4,
                                      top: 55 + Math.sin(angle) * r - 4,
                                      width: 8,
                                      height: 8,
                                      background: color,
                                      opacity: 0.25 + (k % 3) * 0.12,
                                      boxShadow: `0 0 6px ${color}`,
                                      animationDelay: `${k * 0.15}s`,
                                    }}
                                  />
                                );
                              })}
                              <span
                                className="echoes-orb-center"
                                style={{
                                  background: `radial-gradient(circle, ${color} 0%, ${color}80 60%, transparent 100%)`,
                                  boxShadow: `0 0 20px ${color}`,
                                }}
                              />
                            </div>
                            <div className="echoes-cluster-text">
                              <div
                                className="echoes-cluster-name"
                                style={{ color }}
                              >
                                「{label}」
                              </div>
                              <div className="echoes-cluster-desc">
                                {cluster.id === 'areas' &&
                                  '藍色的，記憶著場景與環境'}
                                {cluster.id === 'characters' &&
                                  '紅色的，封存著一個又一個的角色'}
                                {cluster.id === 'stories' &&
                                  '綠色的，紀錄著故事的轉折'}
                                {cluster.id === 'special' &&
                                  '紫色的，獨立於其他族群之外'}
                              </div>
                            </div>
                            <span className="echoes-cluster-meta">
                              {songCount > 0 ? `${songCount} echoes` : '—'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                }
                case 'rich-text': {
                  const html = (block.data as { html: string }).html;
                  return (
                    <React.Fragment key={block.id}>
                      {renderHtmlWithUep(
                        html,
                        block.id,
                        'echoes-prose echoes-landing-prose'
                      )}
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
              <div className="echoes-kicker">Volume II · ECHOES</div>
              <h2 className="echoes-landing-title">
                {plazaPage?.title || plazaNode?.title || '空白廣場'}
              </h2>
              {(treeLoading || landingLoading) && !plazaPage && (
                <ZoneStateDisplay
                  kind="loading"
                  message="正在讀取空白廣場..."
                />
              )}
              {treeError && (
                <ZoneStateDisplay
                  kind="error"
                  message={`目錄讀取失敗：${treeError}`}
                  onRetry={() => void fetchTree()}
                />
              )}
              {landingParts.before && (
                <>
                  {renderHtmlWithUep(
                    landingParts.before,
                    'landing-before',
                    'echoes-prose echoes-landing-prose'
                  )}
                </>
              )}
              <div className="echoes-cluster-grid">
                {CLUSTERS.map((cluster) => {
                  const songCount = countSongsInCluster(
                    tree,
                    cluster.id,
                    progress
                  );
                  const orbCount = Math.max(songCount, 6);
                  const innerCount = Math.min(orbCount, 40);
                  const outerCount = Math.max(orbCount - 40, 0);
                  return (
                    <button
                      key={cluster.id}
                      type="button"
                      className="echoes-cluster-card"
                      style={{
                        ['--cluster-color' as string]: cluster.color,
                        borderTopColor: cluster.color,
                      }}
                      onClick={() => navigateToCluster(cluster.id)}
                    >
                      <div className="echoes-orb-field">
                        {Array.from({ length: innerCount }, (_, k) => {
                          const angle = (k / innerCount) * Math.PI * 2;
                          const r = 36 + (k % 2) * 8;
                          return (
                            <span
                              key={k}
                              className="echoes-orb-particle"
                              style={{
                                left: 55 + Math.cos(angle) * r - 5,
                                top: 55 + Math.sin(angle) * r - 5,
                                background: cluster.color,
                                opacity: 0.4 + (k % 3) * 0.2,
                                boxShadow: `0 0 8px ${cluster.color}`,
                                animationDelay: `${k * 0.2}s`,
                              }}
                            />
                          );
                        })}
                        {/* 外圈（超過 40 時） */}
                        {Array.from({ length: outerCount }, (_, k) => {
                          const angle = (k / outerCount) * Math.PI * 2;
                          const r = 56 + (k % 2) * 8;
                          return (
                            <span
                              key={`o${k}`}
                              className="echoes-orb-particle"
                              style={{
                                left: 55 + Math.cos(angle) * r - 4,
                                top: 55 + Math.sin(angle) * r - 4,
                                width: 8,
                                height: 8,
                                background: cluster.color,
                                opacity: 0.25 + (k % 3) * 0.12,
                                boxShadow: `0 0 6px ${cluster.color}`,
                                animationDelay: `${k * 0.15}s`,
                              }}
                            />
                          );
                        })}
                        <span
                          className="echoes-orb-center"
                          style={{
                            background: `radial-gradient(circle, ${cluster.color} 0%, ${cluster.color}80 60%, transparent 100%)`,
                            boxShadow: `0 0 20px ${cluster.color}`,
                          }}
                        />
                      </div>
                      <div className="echoes-cluster-text">
                        <div
                          className="echoes-cluster-name"
                          style={{ color: cluster.color }}
                        >
                          「{cluster.label}」
                        </div>
                        <div className="echoes-cluster-desc">
                          {cluster.id === 'areas' && '藍色的，記憶著場景與環境'}
                          {cluster.id === 'characters' &&
                            '紅色的，封存著一個又一個的角色'}
                          {cluster.id === 'stories' &&
                            '綠色的，紀錄著故事的轉折'}
                          {cluster.id === 'special' &&
                            '紫色的，獨立於其他族群之外'}
                        </div>
                      </div>
                      <span className="echoes-cluster-meta">
                        {songCount > 0 ? `${songCount} echoes` : '—'}
                      </span>
                    </button>
                  );
                })}
              </div>
              {landingParts.after && (
                <>
                  {renderHtmlWithUep(
                    landingParts.after,
                    'landing-after',
                    'echoes-prose echoes-landing-prose'
                  )}
                </>
              )}
              <div className="echoes-landing-uep">
                <UepDialogue
                  text="歡迎來到充滿了世界之聲的蒐藏間，這裡聽到的全部都是實際存在的對話喔!"
                  effects={['shimmer', 'halo']}
                />
              </div>
              {photoPage && (
                <section className="echoes-photo-section">
                  <div className="echoes-kicker">Loose Note / Page</div>
                  <h3>{photoPage.title}</h3>
                  <>
                    {renderHtmlWithUep(
                      photoPage.content.map((b) => b.content || '').join('\n'),
                      'photo-page',
                      'echoes-prose echoes-photo-prose'
                    )}
                  </>
                </section>
              )}
            </>
          )}
        </div>

        {/* 浮動音符粒子 */}
        <div className="echoes-particles" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <span
              key={i}
              style={{
                left: `${(i * 53) % 100}%`,
                top: `${(i * 37) % 100}%`,
                animationDelay: `${(i * 0.5) % 10}s`,
                animationDuration: `${12 + (i % 6)}s`,
              }}
            >
              {MUSIC_NOTES[i % MUSIC_NOTES.length]}
            </span>
          ))}
        </div>

        {/* 浮島解鎖小物件（同 S7-C ConceptsReader 的修法）：echoes 的
            實際入口是 Reader 解析的動態 homepage，ZoneEntryPage 走不到，
            掛在那裡的小物件是孤兒。position:fixed，浮現條件（登入探索者
            + visited + 未解鎖）由元件自理。僅 landing 顯示（zone 首頁語意）。 */}
        <IslandUnlockObject zoneId="echoes" />
      </section>
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Cluster 視圖
  // ────────────────────────────────────────────────────────────────
  function renderCluster() {
    const cluster = getClusterDef(activeClusterId || '');
    if (!cluster)
      return <ZoneStateDisplay kind="not-found" message="找不到此集群" large />;

    // 從 tree 中取得實際的 subcategory 節點（hidden 完全隱藏）
    const clusterNode = findClusterNode(tree, cluster.id);
    const subcatNodes = (clusterNode?.children || []).filter(
      (n) => n.pageType !== 'song' && n.pageType !== 'page' && !isHidden(n)
    );
    const totalSongs = clusterNode ? countSongs(clusterNode, progress) : 0;

    return (
      <section className="echoes-cluster-page">
        <div className="echoes-cluster-inner">
          <ZoneBreadcrumb
            segments={[
              { label: '回音蒐藏間', onClick: () => navigateToLanding() },
              { label: cluster.labelEn },
            ]}
            color={cluster.color}
          />

          {/* 標題 */}
          <div className="echoes-cluster-head">
            <span
              className="echoes-cluster-head-icon"
              style={{ color: cluster.color }}
            >
              {cluster.icon}
            </span>
            <h2>{cluster.label}</h2>
          </div>
          <div className="echoes-cluster-subtitle">
            {subcatNodes.length} categories · {totalSongs} echoes
          </div>

          {/* 漸層分隔線 */}
          <div
            className="echoes-gradient-divider"
            style={{
              background: `linear-gradient(90deg, transparent, ${cluster.color}, transparent)`,
            }}
          />

          {/* 敘事段落 (drop-cap) */}
          <p className="echoes-narrative">
            <span className="echoes-drop-cap" style={{ color: cluster.color }}>
              {cluster.intro[0]}
            </span>
            {cluster.intro.slice(1)}
          </p>

          {/* UEP 對話 */}
          <div className="echoes-uep-inline">
            <UepDialogue text={cluster.uepNote} effects={['shimmer', 'halo']} />
          </div>

          <p className="echoes-instruction">
            還好有一些看上去像是範例的文字寫在字條的背面，你把它們一個個的列出來了：
          </p>

          {/* 子分類卡片列表 — 從 tree 讀取 */}
          <div className="echoes-subcat-list">
            {subcatNodes.map((subcatNode, i) => {
              const songCount = countSongs(subcatNode, progress);
              const subcatHidden = isHidden(subcatNode);
              const subcatLocked = isLocked(subcatNode);
              const inaccessible = subcatHidden || subcatLocked;
              const songs = collectSongs(subcatNode, progress);
              return (
                <button
                  key={subcatNode.id}
                  type="button"
                  className="echoes-subcat-card"
                  style={{
                    borderLeftColor: inaccessible
                      ? 'var(--line)'
                      : cluster.color,
                    opacity: inaccessible ? 0.5 : 1,
                    fontStyle: inaccessible ? 'italic' : 'normal',
                    cursor: inaccessible ? 'not-allowed' : 'pointer',
                  }}
                  onClick={() => {
                    if (inaccessible) return;
                    void navigateToContent(subcatNode.id);
                  }}
                >
                  <span
                    className="echoes-subcat-num"
                    style={{ color: cluster.color }}
                  >
                    {String(i + 1).padStart(2, '0')}.
                  </span>
                  <div className="echoes-subcat-info">
                    <div className="echoes-subcat-name">{subcatNode.title}</div>
                    {typeof subcatNode.metadata?.description === 'string' && (
                      <div className="echoes-subcat-hint">
                        ({subcatNode.metadata.description})
                      </div>
                    )}
                  </div>
                  <span className="echoes-subcat-count">
                    {subcatHidden
                      ? '— sealed —'
                      : subcatLocked
                        ? 'locked'
                        : `${songCount} echoes`}
                  </span>
                  <span
                    className="echoes-subcat-arrow"
                    style={{
                      color: inaccessible ? 'var(--ink-mute)' : cluster.color,
                    }}
                  >
                    {inaccessible ? 'LOCK' : '→'}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 反叛群組 (stories 專屬) */}
          {cluster.extraGroups && (
            <div className="echoes-extra-groups">
              <p className="echoes-instruction">
                在你完成剛才的分類之後，某一些群組的回聲似乎對此不太滿意。
                漸漸地，他們跑了出來，並自行組成了新的群組：
              </p>
              <div className="echoes-extra-grid">
                {cluster.extraGroups.map((g, i) => (
                  <div key={i} className="echoes-extra-item">
                    <span style={{ color: cluster.color }}>·</span>
                    {g}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 返回按鈕 */}
          <div className="echoes-back-bar">
            <button
              type="button"
              className="echoes-back-btn"
              style={{ ['--accent' as string]: cluster.color }}
              onClick={() => navigateToLanding()}
            >
              ← 返回「回音蒐藏間」
            </button>
          </div>
        </div>
      </section>
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Content 視圖（subcategory / cluster — 比照 History 的閱讀視圖）
  // ────────────────────────────────────────────────────────────────
  function renderContent() {
    if (contentLoading) {
      return (
        <ZoneStateDisplay kind="loading" message="正在讀取頁面..." large />
      );
    }
    if (!currentContentPage) return null;

    const cluster = activeClusterId ? getClusterDef(activeClusterId) : null;
    const color = cluster?.color || ECHOES_ZONE.main;
    const contentHtml = currentContentPage.content
      .map((b) => b.content || '')
      .join('\n');

    // 找出此節點下的子節點，分開過濾 subcat 和 song 的 hidden
    const contentNode = flatPages.find((p) => p.id === currentContentPage.id);
    const allChildren = contentNode?.children || [];
    const childSubcats = allChildren.filter(
      (c) => c.pageType !== 'song' && c.pageType !== 'page' && !isHidden(c)
    );
    // S8：未解鎖歌曲完全隱藏（不是 LOCK 佔位）
    const directSongs = allChildren.filter(
      (c) =>
        c.pageType === 'song' &&
        !isHidden(c) &&
        isSongUnlockedInZone(c, progress)
    );

    return (
      <section className="echoes-content-page">
        <div className="echoes-content-inner">
          <ZoneBreadcrumb
            segments={[
              { label: '回音蒐藏間', onClick: () => navigateToLanding() },
              ...(cluster
                ? [
                    {
                      label: cluster.label,
                      onClick: () => navigateToCluster(cluster.id),
                    },
                  ]
                : []),
              { label: currentContentPage.title },
            ]}
            color={color}
          />

          <header className="echoes-content-head">
            <h2 className="echoes-content-title" style={{ color }}>
              {currentContentPage.title}
            </h2>
            {typeof currentContentPage.metadata?.description === 'string' && (
              <p className="echoes-content-desc">
                {currentContentPage.metadata.description}
              </p>
            )}
          </header>

          {/* 頁面內容 (rich text) */}
          {contentHtml && (
            <>{renderHtmlWithUep(contentHtml, 'content', 'echoes-prose')}</>
          )}

          {/* 子分類列表 */}
          {childSubcats.length > 0 && (
            <div className="echoes-child-list">
              {childSubcats.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  className="echoes-subcat-card"
                  style={{ borderLeftColor: color }}
                  onClick={() => void navigateToContent(child.id)}
                >
                  <span className="echoes-subcat-num" style={{ color }}>
                    →
                  </span>
                  <div className="echoes-subcat-info">
                    <div className="echoes-subcat-name">{child.title}</div>
                  </div>
                  <span className="echoes-subcat-count">
                    {countSongs(child, progress)} echoes
                  </span>
                  <span className="echoes-subcat-arrow" style={{ color }}>
                    →
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* 歌曲清單（音樂播放列表樣式）*/}
          {directSongs.length > 0 && (
            <div className="echoes-playlist">
              <div className="echoes-playlist-header">
                <span className="echoes-kicker" style={{ color }}>
                  ♪ {directSongs.length} echoes
                </span>
              </div>
              {directSongs.map((song, i) => {
                const meta = song.metadata as Record<string, unknown>;
                const sp = getSpoilerLevel(song);
                const subtitle = (meta?.subtitle as string) || '';
                // 分級解鎖：解鎖後仍根據等級決定可見範圍
                const songHasUnlocked = sp === 0 || isSongUnlocked(song.id);
                const songCanSeeTitle = songHasUnlocked && sp <= 2;
                const songCanSeeSub = songHasUnlocked && sp <= 1;
                return (
                  <button
                    key={song.id}
                    type="button"
                    className="echoes-playlist-item"
                    style={{ ['--accent' as string]: color }}
                    onClick={() => void navigateToSong(song.id)}
                  >
                    <span className="echoes-playlist-num">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div
                      className="echoes-playlist-info"
                      style={{
                        filter:
                          !songCanSeeTitle && sp === 1
                            ? 'blur(5px)'
                            : undefined,
                        userSelect: !songCanSeeTitle ? 'none' : undefined,
                      }}
                    >
                      <div className="echoes-playlist-title">
                        {songCanSeeTitle ? (
                          song.title
                        ) : sp === 3 ? (
                          <GlitchText text={song.title} />
                        ) : sp === 2 ? (
                          '████████'
                        ) : (
                          song.title
                        )}
                      </div>
                      {subtitle && (
                        <div className="echoes-playlist-sub">
                          {songCanSeeSub ? (
                            subtitle
                          ) : sp === 3 ? (
                            <GlitchText text={subtitle} />
                          ) : sp === 2 ? (
                            '████'
                          ) : (
                            subtitle
                          )}
                        </div>
                      )}
                    </div>
                    {/* 狀態標籤 */}
                    {sp > 0 && !songHasUnlocked && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: '0.7em',
                          padding: '2px 7px',
                          borderRadius: 4,
                          fontWeight: 600,
                          letterSpacing: '0.04em',
                          color: sp === 3 ? 'crimson' : 'goldenrod',
                          border: `1px solid ${sp === 3 ? 'crimson' : 'goldenrod'}`,
                          opacity: 0.8,
                        }}
                      >
                        L{sp}
                      </span>
                    )}
                    <span className="echoes-subcat-arrow" style={{ color }}>
                      →
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 返回上一層 */}
          {cluster && (
            <div className="echoes-back-bar">
              <button
                type="button"
                className="echoes-back-btn"
                style={{ ['--accent' as string]: color }}
                onClick={() => navigateToCluster(cluster.id)}
              >
                ← 返回「{cluster.label}」
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Song 視圖
  // ────────────────────────────────────────────────────────────────
  function renderSong() {
    if (songLoading) {
      return (
        <ZoneStateDisplay kind="loading" message="正在讀取曲目..." large />
      );
    }
    if (songError) {
      return (
        <ZoneStateDisplay
          kind="error"
          message={`曲目讀取失敗：${songError}`}
          onRetry={
            activeSongId ? () => void navigateToSong(activeSongId) : undefined
          }
          large
        />
      );
    }
    if (!currentSongPage || !songData) return null;

    // S8：未解鎖歌曲的 deep link → not-found（同 Concepts 語意，不是鎖定佔位）
    const songNode = flatPages.find((p) => p.id === currentSongPage.id);
    if (
      tree.length > 0 &&
      (!songNode ||
        isHidden(songNode) ||
        !isSongUnlockedInZone(songNode, progress))
    ) {
      return (
        <ZoneStateDisplay kind="not-found" message="找不到這枚回聲" large />
      );
    }

    const cluster = activeSongCluster;
    const color = cluster?.color || ECHOES_ZONE.main;

    // 從 tree 找到歌曲的 parent (subcategory) 節點
    const parentNode = flatPages.find((p) => {
      return (p.children || []).some((c) => c.id === currentSongPage.id);
    });
    const spoiler = songData.spoilerLevel || 0;
    const hasUnlocked = spoiler === 0 || isSongUnlocked(currentSongPage.id);
    const locked = spoiler > 0 && !hasUnlocked;
    const audioUrl = buildAudioUrl(songData.audioFile);

    // 分級解鎖可見性
    // L1 解鎖：標題、副標題、metadata 可見，賞析標記為非完整版
    // L2 解鎖：僅標題可見，其餘隱藏
    // L3 解鎖：全部隱藏，完全不可播放（S8 取代既有 30 秒 preview）
    const canSeeTitle = hasUnlocked && spoiler <= 2;
    const canSeeSubtitle = hasUnlocked && spoiler <= 1;
    const canSeeMetadata = hasUnlocked && spoiler <= 1;
    const sealed = hasUnlocked && spoiler >= 3;
    const isPartialAppreciation = hasUnlocked && spoiler >= 1;

    const isPlaying =
      audio.currentSongId === currentSongPage.id && audio.isPlaying;

    const handlePlayAttempt = () => {
      if (locked) {
        requestUnlock(currentSongPage.id, spoiler, songData.gate, () => {
          // L3 確認警告後仍為封印態，不啟動播放
          if (spoiler < 3 && audioUrl) {
            audio.play(
              currentSongPage.id,
              audioUrl,
              currentSongPage.title,
              color
            );
          }
        });
      } else if (spoiler < 3 && audioUrl) {
        audio.toggle(
          currentSongPage.id,
          audioUrl,
          currentSongPage.title,
          color
        );
      }
    };

    // 組合 metadata 顯示資訊（不含 album）
    const meta = songData.audioMeta;
    const metaItems = [meta?.artist, meta?.year, meta?.genre].filter(Boolean);

    // 賞析內容：僅 L0 顯示完整賞析，L1/L2/L3 不論解鎖與否都顯示 appreciationLocked
    const appreciationParagraphs =
      spoiler === 0
        ? songData.appreciation.filter((p) => p.trim())
        : songData.appreciationLocked
          ? [
              spoiler === 3
                ? injectNoise(songData.appreciationLocked, 0.2)
                : songData.appreciationLocked,
            ]
          : [];
    const hasAppreciation = appreciationParagraphs.length > 0;

    return (
      <section className="echoes-song-page">
        <div className="echoes-song-inner">
          <ZoneBreadcrumb
            segments={[
              { label: '回音蒐藏間', onClick: () => navigateToLanding() },
              ...(cluster
                ? [
                    {
                      label: cluster.label,
                      onClick: () => navigateToCluster(cluster.id),
                    },
                  ]
                : []),
              ...(parentNode
                ? [
                    {
                      label: parentNode.title,
                      onClick: () => void navigateToContent(parentNode.id),
                    },
                  ]
                : []),
            ]}
            color={color}
          />

          {/* Meta 資訊行 */}
          <div className="echoes-song-meta-line">
            <span
              className="echoes-song-category"
              style={{ color, borderColor: `${color}50` }}
            >
              {parentNode?.title || '回聲'}
            </span>
            {spoiler > 0 && (
              <span
                style={{ color: hasUnlocked ? 'var(--ink-mute)' : 'crimson' }}
              >
                {!hasUnlocked
                  ? `⚠ spoiler · L${spoiler}`
                  : spoiler === 1
                    ? '✓ unlocked'
                    : spoiler === 2
                      ? '✓ partial · L2'
                      : '✓ sealed · L3'}
              </span>
            )}
            {meta?.format && (
              <span style={{ color: 'var(--ink-mute)' }}>
                {[
                  canSeeMetadata ? meta.format.toUpperCase() : '???',
                  meta.bitrate && `${meta.bitrate}kbps`,
                  meta.duration != null && fmtTime(meta.duration),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>

          {/* Hero: 唱片 + Meta */}
          <div className="echoes-song-hero">
            <VinylDisc
              isPlaying={isPlaying}
              isLocked={locked || sealed}
              color={color}
              coverImage={songData.coverImage}
            />

            <div className="echoes-song-info">
              <h2 className="echoes-song-title">
                <SpoilerTitle
                  text={currentSongPage.title}
                  level={spoiler}
                  unlocked={canSeeTitle}
                  size={42}
                />
              </h2>
              {/* 英文曲名（從 audioMeta.title 取得）*/}
              {meta?.title && (
                <div className="echoes-song-en-title">
                  <SpoilerTitle
                    text={meta.title}
                    level={spoiler}
                    unlocked={canSeeTitle}
                    size={16}
                  />
                </div>
              )}
              <div
                className="echoes-song-subtitle"
                style={{
                  color: canSeeSubtitle ? color : 'var(--ink-mute)',
                  filter:
                    !canSeeSubtitle && spoiler === 1 ? 'blur(5px)' : undefined,
                  userSelect: !canSeeSubtitle ? 'none' : undefined,
                }}
              >
                —「
                {canSeeSubtitle
                  ? songData.subtitle
                  : spoiler >= 2
                    ? '████████'
                    : songData.subtitle}
                」
              </div>

              {/* 曲目 Metadata（artist / year / genre）— L2/L3 解鎖後仍隱藏 */}
              {canSeeMetadata && metaItems.length > 0 && (
                <div className="echoes-song-audio-meta">
                  {meta?.artist && <span>{meta.artist}</span>}
                  {meta?.year && <span>{meta.year}</span>}
                  {meta?.genre && <span>{meta.genre}</span>}
                </div>
              )}

              <div onClick={locked ? handlePlayAttempt : undefined}>
                <EchoesAudioPlayer
                  songId={currentSongPage.id}
                  title={currentSongPage.title}
                  audioUrl={locked || sealed ? null : audioUrl}
                  metaDuration={songData.audioMeta?.duration}
                  color={color}
                  locked={locked}
                  onLockedClick={handlePlayAttempt}
                  sealed={sealed}
                  onAddToQueue={
                    // 臨時解鎖只允許當次聆聽；任何 spoiler 曲目都不可進佇列。
                    // 島未掛載（未解鎖/停用/非登入探索者）時也不提供入口。
                    isSongQueueEligible(spoiler, !locked) &&
                    audioUrl &&
                    shouldMountIsland(progress, 'echoes')
                      ? () => {
                          const store = getAudioStore();
                          const already = store
                            .getState()
                            .playlist.some(
                              (it) => it.songId === currentSongPage.id
                            );
                          if (already) {
                            window.__uepToastManager?.info(
                              '這枚回聲已經在佇列裡了。'
                            );
                            return;
                          }
                          store.enqueue({
                            songId: currentSongPage.id,
                            url: audioUrl,
                            title: currentSongPage.title,
                            accent: color,
                          });
                          window.__uepToastManager?.success(
                            '已加入流浪回聲佇列。'
                          );
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          </div>

          {/* 賞析 */}
          <div className="echoes-appreciation">
            <div className="echoes-appreciation-label" style={{ color }}>
              · 賞析 ·
              {isPartialAppreciation && (
                <span
                  style={{
                    fontSize: '0.85em',
                    opacity: 0.7,
                    marginLeft: 10,
                    fontWeight: 400,
                    letterSpacing: '0.03em',
                    color: 'var(--ink-mute)',
                  }}
                >
                  — 非完整賞析
                </span>
              )}
            </div>
            <div className="echoes-appreciation-body">
              {hasAppreciation ? (
                appreciationParagraphs.map((p, i) => (
                  <p
                    key={i}
                    style={{ fontStyle: spoiler >= 1 ? 'italic' : 'normal' }}
                  >
                    {p}
                  </p>
                ))
              ) : (
                <p
                  style={{
                    fontStyle: 'italic',
                    color: 'var(--ink-mute)',
                  }}
                >
                  {spoiler === 0
                    ? '此曲目暫無賞析內容。'
                    : spoiler === 3
                      ? injectNoise(
                          '*你感到不解，也許現在的你還沒有辦法給出什麼適當的敘述*',
                          0.3
                        )
                      : '*你感到不解，也許現在的你還沒有辦法給出什麼適當的敘述*'}
                </p>
              )}
            </div>
          </div>

          {/* Prev/Next */}
          <ZonePrevNext
            prev={
              prevSong
                ? {
                    title: (() => {
                      const pSp = getSpoilerLevel(prevSong);
                      const pUnlocked =
                        pSp === 0 || isSongUnlocked(prevSong.id);
                      return (
                        <SpoilerTitle
                          text={prevSong.title}
                          level={pSp}
                          unlocked={pUnlocked && pSp <= 2}
                          size={14}
                        />
                      );
                    })(),
                    onClick: () => void navigateToSong(prevSong.id),
                  }
                : null
            }
            next={
              nextSong
                ? {
                    title: (() => {
                      const nSp = getSpoilerLevel(nextSong);
                      const nUnlocked =
                        nSp === 0 || isSongUnlocked(nextSong.id);
                      return (
                        <SpoilerTitle
                          text={nextSong.title}
                          level={nSp}
                          unlocked={nUnlocked && nSp <= 2}
                          size={14}
                        />
                      );
                    })(),
                    onClick: () => void navigateToSong(nextSong.id),
                  }
                : null
            }
            prevLabel="← PREV"
            nextLabel="NEXT →"
            prevEmpty="沒有上一首"
            nextEmpty="沒有下一首"
            accentColor={color}
          />

          {/* 返回曲目清單 */}
          {parentNode && (
            <div className="echoes-back-bar">
              <button
                type="button"
                className="echoes-back-btn"
                style={{ ['--accent' as string]: color }}
                onClick={() => void navigateToContent(parentNode.id)}
              >
                ← 返回「{parentNode.title}」曲目清單
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────
  return (
    <ReaderShell zoneId="echoes" className="echoes-reader">
      {/* 入場動畫 — 漣漪擴散 */}
      <div
        aria-hidden="true"
        className={`echo-boot ${contentReady ? 'is-ready' : ''}`}
      >
        <div className="echo-boot-pulse" />
        <div className="echo-boot-wave" />
        <div className="echo-boot-wave" />
        <div className="echo-boot-wave" />
      </div>

      <div className="echoes-main">
        <ZoneAtmosphere zone={echoesZone} intensity="subtle" skipGlyphs />
        <EchoesRipple
          isPlaying={audio.isPlaying}
          color={
            activeClusterId ? getClusterDef(activeClusterId)?.color : undefined
          }
        />

        {/* 氛圍裝飾環 */}
        <div className="echoes-atmosphere" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => {
            const peak = 0.16 + ((i * 7 + 5) % 14) / 100;
            return (
              <span
                key={i}
                style={
                  {
                    left: `${(i * 53) % 100}%`,
                    top: `${(i * 37) % 100}%`,
                    animationDelay: `${(i * 0.8) % 12}s`,
                    animationDuration: `${20 + (i % 8)}s`,
                    '--peak': peak,
                  } as React.CSSProperties
                }
              >
                {MUSIC_NOTES[i % MUSIC_NOTES.length]}
              </span>
            );
          })}
        </div>

        <div className="echoes-content" ref={scrollRef}>
          <div key={transitionKey} className="echoes-page-transition">
            {view === 'landing' && renderLanding()}
            {view === 'cluster' && renderCluster()}
            {view === 'content' && renderContent()}
            {view === 'song' && renderSong()}
          </div>
        </div>
      </div>

      {/* Spoiler Warning Dialog */}
      {spoilerWarning && (
        <div className="echoes-spoiler-overlay">
          <div className="echoes-spoiler-dialog">
            <div className="echoes-spoiler-dialog-header">
              ⚠ SPOILER WARNING · LEVEL {spoilerWarning.level}
            </div>
            <div className="echoes-spoiler-dialog-body">
              這首歌曲屬於尚未解鎖的劇情段落。你需要先{' '}
              <strong>{spoilerWarning.gate || '讀過對應劇情'}</strong>{' '}
              才能無遮蔽地聆聽。
            </div>
            <div className="echoes-spoiler-dialog-actions">
              <button
                type="button"
                className="echoes-btn-danger"
                onClick={confirmUnlock}
              >
                我已知情，繼續
              </button>
              <button
                type="button"
                className="echoes-btn-ghost"
                onClick={() => setSpoilerWarning(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </ReaderShell>
  );
}

// ──────────────────────────────────────────────────────────────────
// 外層 export：AudioProvider 包住 EchoesReaderInner
// ──────────────────────────────────────────────────────────────────
export default function EchoesReader() {
  return (
    <AudioProvider>
      <EchoesReaderInner />
    </AudioProvider>
  );
}
