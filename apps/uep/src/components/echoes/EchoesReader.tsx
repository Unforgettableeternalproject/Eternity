/* eslint-disable @typescript-eslint/no-unused-vars */
import React, {
  createContext,
  useCallback,
  useContext,
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
// 音訊系統 (AudioProvider)
// ──────────────────────────────────────────────────────────────────
interface AudioState {
  currentSongId: string | null;
  isPlaying: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  play: (songId: string, url: string) => void;
  pause: () => void;
  toggle: (songId: string, url: string) => void;
  seek: (fraction: number) => void;
}

const AudioCtx = createContext<AudioState>({
  currentSongId: null,
  isPlaying: false,
  progress: 0,
  currentTime: 0,
  duration: 0,
  play: () => {},
  pause: () => {},
  toggle: () => {},
  seek: () => {},
});

function AudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const [currentSongId, setCurrentSongId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    audioRef.current = new Audio();
    audioRef.current.preload = 'metadata';

    const audio = audioRef.current;
    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      setProgress(1);
    });
    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration || 0);
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      audio.pause();
      audio.src = '';
    };
  }, []);

  const updateProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const dur = audio.duration || 0;
    setCurrentTime(audio.currentTime);
    setProgress(dur > 0 ? audio.currentTime / dur : 0);
    if (!audio.paused) {
      rafRef.current = requestAnimationFrame(updateProgress);
    }
  }, []);

  const play = useCallback(
    (songId: string, url: string) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (currentSongId !== songId) {
        audio.src = url;
        audio.load();
        setCurrentSongId(songId);
        setProgress(0);
        setCurrentTime(0);
      }

      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          rafRef.current = requestAnimationFrame(updateProgress);
        })
        .catch(() => {
          // 自動播放被阻擋時靜默處理
        });
    },
    [currentSongId, updateProgress]
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(
    (songId: string, url: string) => {
      if (currentSongId === songId && isPlaying) {
        pause();
      } else {
        play(songId, url);
      }
    },
    [currentSongId, isPlaying, pause, play]
  );

  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    audio.currentTime = fraction * audio.duration;
    setCurrentTime(audio.currentTime);
    setProgress(fraction);
  }, []);

  const value = useMemo(
    () => ({
      currentSongId,
      isPlaying,
      progress,
      currentTime,
      duration,
      play,
      pause,
      toggle,
      seek,
    }),
    [
      currentSongId,
      isPlaying,
      progress,
      currentTime,
      duration,
      play,
      pause,
      toggle,
      seek,
    ]
  );

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}

const useAudio = () => useContext(AudioCtx);

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

  // L3: glitch
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
      <span
        style={{
          position: 'absolute',
          inset: 0,
          color: 'rgba(220,40,80,0.7)',
          transform: `translate(${(tick % 3) - 1}px, ${(tick % 2) - 1}px)`,
          mixBlendMode: 'multiply',
        }}
      >
        {scramble(text, tick + 7)}
      </span>
      <span
        style={{
          position: 'absolute',
          inset: 0,
          color: 'rgba(40,120,200,0.7)',
          transform: `translate(${-((tick % 3) - 1)}px, ${(tick % 2) - 1}px)`,
          mixBlendMode: 'multiply',
        }}
      >
        {scramble(text, tick + 13)}
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

/** 輕量 glitch 文字 — 用於列表項目的 L3 遮蔽 */
function GlitchText({ text }: { text: string }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 120);
    return () => clearInterval(t);
  }, []);

  return (
    <span className="echoes-glitch-inline">
      <span className="echoes-glitch-r">{scramble(text, tick + 5)}</span>
      <span className="echoes-glitch-b">{scramble(text, tick + 11)}</span>
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
      <div
        className="echoes-vinyl"
        data-playing={isPlaying}
        style={{
          background: coverUrl
            ? `url(${coverUrl}) center/cover no-repeat`
            : `radial-gradient(circle at 50% 50%, ${color} 0%, ${color} 11%, var(--bg-card) 13%, var(--bg-card) 100%)`,
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
        {!coverUrl && <span className="echoes-vinyl-hole" />}
        {coverUrl && <div className="echoes-vinyl-cover-overlay" />}
      </div>
      {isLocked && (
        <div className="echoes-vinyl-lock">
          <span>🔒 SEALED</span>
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
  audioUrl,
  metaDuration,
  color,
  locked = false,
  onLockedClick,
}: {
  songId: string;
  audioUrl: string | null;
  metaDuration?: number;
  color: string;
  locked?: boolean;
  onLockedClick?: () => void;
}) {
  const a = useAudio();
  const isMe = a.currentSongId === songId;
  const playing = isMe && a.isPlaying;
  const cur = isMe ? a.currentTime : 0;
  const prog = isMe ? a.progress : 0;
  const dur = isMe && a.duration > 0 ? a.duration : metaDuration || 0;
  const disabled = locked || !audioUrl;

  const handlePlay = () => {
    if (locked) {
      onLockedClick?.();
      return;
    }
    if (!audioUrl) return;
    a.toggle(songId, audioUrl);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isMe) return;
    a.seek(parseFloat(e.target.value));
  };

  return (
    <div
      className="echoes-player"
      style={{
        borderColor: isMe ? color : 'var(--line)',
        background: isMe ? `${color}10` : 'var(--bg-card)',
        filter: locked ? 'grayscale(0.6)' : 'none',
        opacity: locked ? 0.5 : 1,
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
        {playing ? '❚❚' : '▶'}
      </button>

      <div className="echoes-player-bar">
        <div className="echoes-player-track">
          <div
            className="echoes-player-fill"
            style={{ width: `${prog * 100}%`, background: color }}
          />
          <div
            className="echoes-player-thumb"
            style={{
              left: `${prog * 100}%`,
              background: color,
              boxShadow: `0 0 6px ${color}`,
              opacity: isMe ? 1 : 0,
            }}
          />
        </div>
        <input
          type="range"
          className="echoes-player-seek"
          min={0}
          max={1}
          step={0.001}
          value={prog}
          onChange={handleSeek}
          disabled={!isMe}
        />
        <div className="echoes-player-times">
          <span>{fmtTime(cur)}</span>
          <span>{dur > 0 ? fmtTime(dur) : '--:--'}</span>
        </div>
      </div>

      <span
        className="echoes-player-status"
        style={{ color: isMe ? color : 'var(--ink-mute)' }}
      >
        {locked ? '🔒 LOCKED' : playing ? 'NOW PLAYING' : 'STANDBY'}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 工具函式（遞迴遍歷，支援任意深度巢狀）
// ──────────────────────────────────────────────────────────────────

/** 遞迴收集節點下所有 song */
function collectSongs(node: PageTreeNode): PageTreeNode[] {
  const songs: PageTreeNode[] = [];
  for (const child of node.children || []) {
    if (child.pageType === 'song') songs.push(child);
    else songs.push(...collectSongs(child));
  }
  return songs;
}

/** 遞迴計算節點下所有 song 數量 */
function countSongs(node: PageTreeNode): number {
  let count = 0;
  for (const child of node.children || []) {
    if (child.pageType === 'song') count++;
    else count += countSongs(child);
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
  songId: string
): PageTreeNode[] {
  // 從 songId 往上找到 parent subcategory
  function findParentAndCollect(node: PageTreeNode): PageTreeNode[] | null {
    for (const child of node.children || []) {
      if (child.id === songId) {
        // 找到了，收集同層的所有 songs
        return collectSongs(node);
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
function countSongsInCluster(tree: PageTreeNode[], clusterId: string): number {
  const cluster = findClusterNode(tree, clusterId);
  return cluster ? countSongs(cluster) : 0;
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
// 主元件: EchoesReader
// ──────────────────────────────────────────────────────────────────
export default function EchoesReader() {
  const echoesZone = ZONES.find((z) => z.id === 'echoes') || ZONES[0];

  // === 共用 UI 狀態 ===
  const [theme, setTheme] = useState('dark');
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

  // === 初始化 ===
  useEffect(() => {
    const storedTheme =
      localStorage.getItem('uep-theme') ||
      document.documentElement.getAttribute('data-theme') ||
      'dark';
    setTheme(storedTheme);
    document.documentElement.setAttribute('data-theme', storedTheme);

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
  const [contentReady, setContentReady] = useState(false);

  // === 載入 landing 頁面內容 ===
  useEffect(() => {
    if (!pageLevelNodes.length) return;
    void fetchLandingPages(pageLevelNodes);
  }, [pageLevelNodes]);

  // 載入首頁區塊資料
  useEffect(() => {
    const timeout = setTimeout(() => setContentReady(true), 2000);
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
        clearTimeout(timeout);
        setContentReady(true);
      });
  }, []);

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

  // === URL 初始導航 ===
  useEffect(() => {
    if (!tree.length) return;
    const params = new URLSearchParams(window.location.search);
    const songParam = params.get('song');
    const pageParam = params.get('page');
    const clusterParam = params.get('cluster');

    if (songParam) {
      void navigateToSong(songParam, false);
    } else if (pageParam) {
      void navigateToContent(pageParam, false);
    } else if (clusterParam) {
      navigateToCluster(clusterParam, false);
    }
  }, [tree]);

  // === popstate 處理 ===
  useEffect(() => {
    function onPopState() {
      const params = new URLSearchParams(window.location.search);
      const songParam = params.get('song');
      const pageParam = params.get('page');
      const clusterParam = params.get('cluster');

      if (songParam) {
        void navigateToSong(songParam, false);
      } else if (pageParam) {
        void navigateToContent(pageParam, false);
      } else if (clusterParam) {
        navigateToCluster(clusterParam, false);
      } else {
        setView('landing');
        setActiveClusterId(null);
        setActiveSongId(null);
        setActiveContentId(null);
        setCurrentSongPage(null);
        setCurrentContentPage(null);
      }
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [tree]);

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
    setView('landing');
    setActiveClusterId(null);
    setActiveSongId(null);
    setCurrentSongPage(null);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    if (pushState) {
      const url = new URL(window.location.href);
      url.searchParams.delete('cluster');
      url.searchParams.delete('song');
      window.history.pushState({}, '', url);
    }
  }

  function navigateToCluster(clusterId: string, pushState = true) {
    setView('cluster');
    setActiveClusterId(clusterId);
    setActiveSongId(null);
    setActiveContentId(null);
    setCurrentSongPage(null);
    setCurrentContentPage(null);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    if (pushState) {
      const url = new URL(window.location.href);
      url.searchParams.set('cluster', clusterId);
      url.searchParams.delete('song');
      url.searchParams.delete('page');
      window.history.pushState({ cluster: clusterId }, '', url);
    }
  }

  /** 導航到非 song 的內容頁面（subcategory 等），比照 History 的閱讀視圖 */
  async function navigateToContent(pageId: string, pushState = true) {
    setView('content');
    setActiveContentId(pageId);
    setActiveSongId(null);
    setCurrentSongPage(null);
    // 推導所屬 cluster
    const clusterId = findClusterForNode(tree, pageId);
    if (clusterId) {
      setActiveClusterId(clusterId);
    }
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
    }
    if (pushState) {
      const url = new URL(window.location.href);
      url.searchParams.set('page', pageId);
      url.searchParams.delete('song');
      if (clusterId) url.searchParams.set('cluster', clusterId);
      window.history.pushState({ page: pageId }, '', url);
    }
  }

  async function navigateToSong(songId: string, pushState = true) {
    setView('song');
    setActiveSongId(songId);
    // 從 song ID 推導所屬集群
    const clusterId = findClusterForNode(tree, songId);
    if (clusterId) {
      setActiveClusterId(clusterId);
    }
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    await fetchSong(songId);
    if (pushState) {
      const url = new URL(window.location.href);
      url.searchParams.set('song', songId);
      if (clusterId) url.searchParams.set('cluster', clusterId);
      window.history.pushState({ song: songId }, '', url);
    }
  }

  // === UI 函式 ===
  function enterZoneFromMap(zoneId: string) {
    const target = ZONES.find((z) => z.id === zoneId);
    if (!target) return;
    setShowMap(false);
    if (target.id === 'echoes') return;
    setPortalZone(target);
    window.setTimeout(() => {
      window.location.href = `/${target.slug}`;
    }, 1100);
  }

  function showZoneIntro(zone: (typeof ZONES)[number]) {
    setShowMap(false);
    setIntroZone(zone);
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
    return getSongsInParentSubcat(tree, activeSongId);
  }, [tree, activeSongId]);

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
              switch (block.type) {
                case 'zone-header': {
                  const d = block.data as ZoneHeaderData;
                  return (
                    <div key={block.id}>
                      <div className="echoes-kicker">Echoes / 空白廣場</div>
                      <h2 className="echoes-landing-title">{d.title}</h2>
                      {d.subtitle && (
                        <p
                          style={{
                            fontFamily: 'var(--font-serif-tc)',
                            fontSize: 16,
                            color: 'var(--ink-soft)',
                            fontStyle: 'italic',
                            lineHeight: 1.9,
                            maxWidth: 620,
                            marginTop: 22,
                          }}
                        >
                          {d.subtitle}
                        </p>
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
                        const songCount = countSongsInCluster(tree, cluster.id);
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
                    <div
                      key={block.id}
                      className="echoes-prose echoes-landing-prose"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  );
                }
                default:
                  return null;
              }
            })
          ) : (
            /* ── Fallback：舊版固定佈局 ── */
            <>
              <div className="echoes-kicker">Echoes / 空白廣場</div>
              <h2 className="echoes-landing-title">
                {plazaPage?.title || plazaNode?.title || '空白廣場'}
              </h2>
              {(treeLoading || landingLoading) && !plazaPage && (
                <div className="echoes-state">正在讀取空白廣場...</div>
              )}
              {landingParts.before && (
                <div
                  className="echoes-prose echoes-landing-prose"
                  dangerouslySetInnerHTML={{ __html: landingParts.before }}
                />
              )}
              <div className="echoes-cluster-grid">
                {CLUSTERS.map((cluster) => {
                  const songCount = countSongsInCluster(tree, cluster.id);
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
                <div
                  className="echoes-prose echoes-landing-prose"
                  dangerouslySetInnerHTML={{ __html: landingParts.after }}
                />
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
                  <div
                    className="echoes-prose echoes-photo-prose"
                    dangerouslySetInnerHTML={{
                      __html: photoPage.content
                        .map((b) => b.content || '')
                        .join('\n'),
                    }}
                  />
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
      </section>
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Cluster 視圖
  // ────────────────────────────────────────────────────────────────
  function renderCluster() {
    const cluster = getClusterDef(activeClusterId || '');
    if (!cluster) return <div className="echoes-state">找不到此集群</div>;

    // 從 tree 中取得實際的 subcategory 節點（hidden 完全隱藏）
    const clusterNode = findClusterNode(tree, cluster.id);
    const subcatNodes = (clusterNode?.children || []).filter(
      (n) =>
        n.pageType !== 'song' &&
        n.pageType !== 'page' &&
        n.metadata?.hidden !== true
    );
    const totalSongs = clusterNode ? countSongs(clusterNode) : 0;

    return (
      <section className="echoes-cluster-page">
        <div className="echoes-cluster-inner">
          {/* 麵包屑 */}
          <div className="echoes-breadcrumb" style={{ color: cluster.color }}>
            <button type="button" onClick={() => navigateToLanding()}>
              回音蒐藏間
            </button>
            <span>/</span>
            <span>{cluster.labelEn}</span>
          </div>

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
              const songCount = countSongs(subcatNode);
              const isHidden = subcatNode.metadata?.hidden === true;
              const songs = collectSongs(subcatNode);
              return (
                <button
                  key={subcatNode.id}
                  type="button"
                  className="echoes-subcat-card"
                  style={{
                    borderLeftColor: isHidden ? 'var(--line)' : cluster.color,
                    opacity: isHidden ? 0.5 : 1,
                    fontStyle: isHidden ? 'italic' : 'normal',
                    cursor: isHidden ? 'not-allowed' : 'pointer',
                  }}
                  onClick={() => {
                    if (isHidden) return;
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
                    {isHidden ? '— sealed —' : `${songCount} echoes`}
                  </span>
                  <span
                    className="echoes-subcat-arrow"
                    style={{
                      color: isHidden ? 'var(--ink-mute)' : cluster.color,
                    }}
                  >
                    {isHidden ? '🔒' : '→'}
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
        <div className="echoes-state echoes-state-large">正在讀取頁面...</div>
      );
    }
    if (!currentContentPage) return null;

    const cluster = activeClusterId ? getClusterDef(activeClusterId) : null;
    const color = cluster?.color || ECHOES_ZONE.main;
    const contentHtml = currentContentPage.content
      .map((b) => b.content || '')
      .join('\n');

    // 找出此節點下的子節點（hidden 完全隱藏）
    const contentNode = flatPages.find((p) => p.id === currentContentPage.id);
    const childNodes = (contentNode?.children || []).filter(
      (c) => c.metadata?.hidden !== true
    );
    const childSubcats = childNodes.filter(
      (c) => c.pageType !== 'song' && c.pageType !== 'page'
    );
    const directSongs = childNodes.filter((c) => c.pageType === 'song');

    return (
      <section className="echoes-content-page">
        <div className="echoes-content-inner">
          {/* 麵包屑導航 */}
          <div className="echoes-breadcrumb" style={{ color }}>
            <button type="button" onClick={() => navigateToLanding()}>
              回音蒐藏間
            </button>
            {cluster && (
              <>
                <span>/</span>
                <button
                  type="button"
                  onClick={() => navigateToCluster(cluster.id)}
                >
                  {cluster.label}
                </button>
              </>
            )}
            <span>/</span>
            <span>{currentContentPage.title}</span>
          </div>

          <header className="echoes-content-head">
            <div className="echoes-kicker">
              {currentContentPage.pageType.toUpperCase()} /{' '}
              {currentContentPage.slug.split('/').pop()}
            </div>
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
            <div
              className="echoes-prose"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
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
                    {countSongs(child)} echoes
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
                const spoiler = (meta?.spoilerLevel as number) || 0;
                const subtitle = (meta?.subtitle as string) || '';
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
                        filter: spoiler === 1 ? 'blur(5px)' : undefined,
                        userSelect: spoiler >= 1 ? 'none' : undefined,
                      }}
                    >
                      <div className="echoes-playlist-title">
                        {spoiler === 3 ? (
                          <GlitchText text={song.title} />
                        ) : spoiler === 2 ? (
                          '████████'
                        ) : (
                          song.title
                        )}
                      </div>
                      {subtitle && (
                        <div className="echoes-playlist-sub">
                          {spoiler === 3 ? (
                            <GlitchText text={subtitle} />
                          ) : spoiler === 2 ? (
                            '████'
                          ) : (
                            subtitle
                          )}
                        </div>
                      )}
                    </div>
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
        <div className="echoes-state echoes-state-large">正在讀取曲目...</div>
      );
    }
    if (songError) {
      return (
        <div className="echoes-state echoes-state-error echoes-state-large">
          <span>曲目讀取失敗：{songError}</span>
          {activeSongId && (
            <button
              type="button"
              onClick={() => void navigateToSong(activeSongId)}
            >
              重試
            </button>
          )}
        </div>
      );
    }
    if (!currentSongPage || !songData) return null;

    const cluster = activeSongCluster;
    const color = cluster?.color || ECHOES_ZONE.main;

    // 從 tree 找到歌曲的 parent (subcategory) 節點
    const parentNode = flatPages.find((p) => {
      return (p.children || []).some((c) => c.id === currentSongPage.id);
    });
    const spoiler = songData.spoilerLevel || 0;
    const isUnlocked = spoiler === 0 || isSongUnlocked(currentSongPage.id);
    const locked = spoiler > 0 && !isUnlocked;
    const audioUrl = buildAudioUrl(songData.audioFile);

    const isPlaying =
      audio.currentSongId === currentSongPage.id && audio.isPlaying;

    const handlePlayAttempt = () => {
      if (locked) {
        requestUnlock(currentSongPage.id, spoiler, songData.gate, () => {
          if (audioUrl) audio.play(currentSongPage.id, audioUrl);
        });
      } else if (audioUrl) {
        audio.toggle(currentSongPage.id, audioUrl);
      }
    };

    // 組合 metadata 顯示資訊（不含 album）
    const meta = songData.audioMeta;
    const metaItems = [meta?.artist, meta?.year, meta?.genre].filter(Boolean);

    // 賞析內容
    const appreciationParagraphs = isUnlocked
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
          {/* 麵包屑（每層可點擊返回）*/}
          <div className="echoes-breadcrumb" style={{ color }}>
            <button type="button" onClick={() => navigateToLanding()}>
              回音蒐藏間
            </button>
            {cluster && (
              <>
                <span>/</span>
                <button
                  type="button"
                  onClick={() => navigateToCluster(cluster.id)}
                >
                  {cluster.label}
                </button>
              </>
            )}
            {parentNode && (
              <>
                <span>/</span>
                <button
                  type="button"
                  onClick={() => void navigateToContent(parentNode.id)}
                >
                  {parentNode.title}
                </button>
              </>
            )}
          </div>

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
                style={{ color: isUnlocked ? 'var(--ink-mute)' : 'crimson' }}
              >
                {isUnlocked ? '✓ unlocked' : `⚠ spoiler · L${spoiler}`}
              </span>
            )}
            {meta?.format && (
              <span style={{ color: 'var(--ink-mute)' }}>
                {[
                  locked ? '???' : meta.format.toUpperCase(),
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
              isLocked={locked}
              color={color}
              coverImage={songData.coverImage}
            />

            <div className="echoes-song-info">
              <h2 className="echoes-song-title">
                <SpoilerTitle
                  text={currentSongPage.title}
                  level={spoiler}
                  unlocked={isUnlocked}
                  size={42}
                />
              </h2>
              {/* 英文曲名（從 audioMeta.title 取得）*/}
              {meta?.title && (
                <div className="echoes-song-en-title">
                  <SpoilerTitle
                    text={meta.title}
                    level={spoiler}
                    unlocked={isUnlocked}
                    size={16}
                  />
                </div>
              )}
              <div
                className="echoes-song-subtitle"
                style={{
                  color: isUnlocked ? color : 'var(--ink-mute)',
                  filter:
                    !isUnlocked && spoiler === 1 ? 'blur(5px)' : undefined,
                  userSelect: !isUnlocked && spoiler >= 1 ? 'none' : undefined,
                }}
              >
                —「
                {isUnlocked || spoiler === 0
                  ? songData.subtitle
                  : spoiler >= 2
                    ? '████████'
                    : songData.subtitle}
                」
              </div>

              {/* 曲目 Metadata（artist / year / genre）*/}
              {metaItems.length > 0 && (
                <div className="echoes-song-audio-meta">
                  {meta?.artist && <span>{meta.artist}</span>}
                  {meta?.year && <span>{meta.year}</span>}
                  {meta?.genre && <span>{meta.genre}</span>}
                </div>
              )}

              <div onClick={locked ? handlePlayAttempt : undefined}>
                <EchoesAudioPlayer
                  songId={currentSongPage.id}
                  audioUrl={locked ? null : audioUrl}
                  metaDuration={songData.audioMeta?.duration}
                  color={color}
                  locked={locked}
                  onLockedClick={handlePlayAttempt}
                />
              </div>
            </div>
          </div>

          {/* 賞析 */}
          <div className="echoes-appreciation">
            <div className="echoes-appreciation-label" style={{ color }}>
              · 賞析 ·
            </div>
            <div className="echoes-appreciation-body">
              {hasAppreciation ? (
                appreciationParagraphs.map((p, i) => (
                  <p
                    key={i}
                    style={{ fontStyle: !isUnlocked ? 'italic' : 'normal' }}
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
                  {isUnlocked
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
          <div className="echoes-page-nav">
            <button
              type="button"
              disabled={!prevSong}
              onClick={() => prevSong && void navigateToSong(prevSong.id)}
            >
              <span>← PREV</span>
              <strong>
                {prevSong ? (
                  <SpoilerTitle
                    text={prevSong.title}
                    level={(prevSong.metadata?.spoilerLevel as number) || 0}
                    unlocked={
                      ((prevSong.metadata?.spoilerLevel as number) || 0) ===
                        0 || isSongUnlocked(prevSong.id)
                    }
                    size={14}
                  />
                ) : (
                  '沒有上一首'
                )}
              </strong>
            </button>
            <button
              type="button"
              disabled={!nextSong}
              onClick={() => nextSong && void navigateToSong(nextSong.id)}
            >
              <span style={{ color }}>NEXT →</span>
              <strong>
                {nextSong ? (
                  <SpoilerTitle
                    text={nextSong.title}
                    level={(nextSong.metadata?.spoilerLevel as number) || 0}
                    unlocked={
                      ((nextSong.metadata?.spoilerLevel as number) || 0) ===
                        0 || isSongUnlocked(nextSong.id)
                    }
                    size={14}
                  />
                ) : (
                  '沒有下一首'
                )}
              </strong>
            </button>
          </div>

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
    <AudioProvider>
      <div className="echoes-reader">
        <style>{echoesReaderCss}</style>

        {/* 入場霧化 — 等待首頁資料載入後再解除 */}
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            pointerEvents: 'none',
            ...(contentReady
              ? { animation: 'zone-arrival 0.8s var(--ease-out) forwards' }
              : {
                  backdropFilter: 'blur(18px)',
                  background: 'rgba(10,10,14,0.5)',
                }),
          }}
        />
        <style>{`
          @keyframes zone-arrival {
            0%   { backdrop-filter: blur(18px); background: rgba(10,10,14,0.5); }
            60%  { backdrop-filter: blur(4px); background: rgba(10,10,14,0.12); }
            100% { backdrop-filter: blur(0px); background: transparent; }
          }
        `}</style>

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

        <div className="echoes-main">
          <ZoneAtmosphere zone={echoesZone} intensity="subtle" />

          {/* 氛圍裝飾環 */}
          <div className="echoes-atmosphere" aria-hidden="true">
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

          <div className="echoes-content" ref={scrollRef}>
            {view === 'landing' && renderLanding()}
            {view === 'cluster' && renderCluster()}
            {view === 'content' && renderContent()}
            {view === 'song' && renderSong()}
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

        <Minimap
          zones={ZONES}
          currentId="echoes"
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
              setHomePortal(true);
              setTimeout(() => {
                window.location.href = '/';
              }, 1100);
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
    </AudioProvider>
  );
}

// ──────────────────────────────────────────────────────────────────
// CSS
// ──────────────────────────────────────────────────────────────────
const echoesReaderCss = `
  .echoes-reader {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--ink);
    overflow: hidden;
  }

  .echoes-kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-mute);
  }

  .echoes-main {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
    overflow: hidden;
  }

  /* === 氛圍 === */
  .echoes-atmosphere {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .echoes-atmosphere::before,
  .echoes-atmosphere::after {
    content: "";
    position: absolute;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, ${ECHOES_ZONE.main} 22%, transparent);
  }

  .echoes-atmosphere::before {
    width: 80vw;
    height: 80vw;
    left: -35vw;
    top: -42vw;
  }

  .echoes-atmosphere::after {
    width: 62vw;
    height: 62vw;
    right: -30vw;
    bottom: -36vw;
    border-style: dashed;
  }

  .echoes-atmosphere span {
    position: absolute;
    font-size: 18px;
    color: ${ECHOES_ZONE.main};
    opacity: 0;
    animation: echoes-drift linear infinite;
  }

  @keyframes echoes-drift {
    0% { opacity: 0; transform: translate3d(0, 0, 0); }
    12% { opacity: 0.15; }
    88% { opacity: 0.15; }
    100% { opacity: 0; transform: translate3d(8px, -70px, 0); }
  }

  /* === 內容區 === */
  .echoes-content {
    flex: 1;
    min-width: 0;
    overflow: auto;
    position: relative;
    z-index: 1;
  }

  /* === Landing === */
  .echoes-landing {
    min-height: 100%;
    padding: 48px 56px 72px;
    position: relative;
  }

  .echoes-landing-inner {
    max-width: 920px;
    margin: 0 auto;
    position: relative;
    z-index: 1;
  }

  .echoes-landing-title {
    margin: 10px 0 0;
    font-family: var(--font-display);
    font-size: 58px;
    font-weight: 500;
    line-height: 1.05;
    color: var(--ink-title);
  }

  .echoes-landing-blurb {
    max-width: 620px;
    margin: 16px 0 0;
    font-family: var(--font-serif-tc);
    font-size: 16px;
    line-height: 1.9;
    color: var(--ink-soft);
    font-style: italic;
  }

  .echoes-prose {
    font-family: var(--font-serif-tc);
    font-size: 17px;
    line-height: 2.08;
    color: var(--ink);
  }

  .echoes-prose p {
    margin: 0 0 1.3em;
  }

  .echoes-prose h1,
  .echoes-prose h2,
  .echoes-prose h3 {
    color: var(--ink-title);
    line-height: 1.35;
  }

  .echoes-prose h1 {
    font-family: var(--font-display);
    font-size: 34px;
    margin: 2.2em 0 .75em;
  }

  .echoes-prose h2 {
    font-family: var(--font-display);
    font-size: 28px;
    margin: 2em 0 .7em;
    scroll-margin-top: 24px;
  }

  .echoes-prose h3 {
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #355c7d;
    margin: 2em 0 .65em;
    scroll-margin-top: 24px;
  }

  .echoes-prose blockquote {
    margin: 28px 0;
    padding: 4px 0 4px 18px;
    border-left: 3px solid #355c7d;
    color: #355c7d;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 19px;
    line-height: 1.65;
  }

  .echoes-prose a {
    color: #6c5b7b;
    text-decoration-color: color-mix(in srgb, #6c5b7b 52%, transparent);
  }

  .echoes-prose hr {
    border: 0;
    height: 1px;
    margin: 38px 0;
    background: linear-gradient(90deg, transparent, #355c7d, transparent);
    opacity: .55;
  }

  .echoes-prose img {
    max-width: 100%;
    height: auto;
    margin: 24px auto;
  }

  .echoes-prose pre {
    overflow: auto;
    padding: 16px;
    background: var(--bg-sunken);
    border: 1px solid var(--line);
  }

  .echoes-prose code {
    font-family: var(--font-mono);
    font-size: .9em;
  }

  .echoes-prose table {
    width: 100%;
    border-collapse: collapse;
    margin: 24px 0;
    font-size: 14px;
  }

  .echoes-prose th,
  .echoes-prose td {
    border-bottom: 1px solid var(--line);
    padding: 9px 10px;
    text-align: left;
  }

  .echoes-prose th {
    color: #355c7d;
    background: var(--echoes-tint);
  }

  .echoes-prose .hint {
    border: 1px solid var(--line);
    background: var(--bg-card);
    padding: 14px 16px;
    margin: 20px 0;
  }

  .echoes-landing-prose h1 {
    display: none;
  }

  .echoes-landing-prose {
    max-width: 680px;
    margin-top: 28px;
  }

  .echoes-landing-uep {
    margin-top: 28px;
  }

  .echoes-photo-section {
    margin-top: 54px;
    padding: 28px 30px;
    max-width: 720px;
    background: linear-gradient(180deg, #C8D6E5 0%, #A4B4C8 100%);
    color: #1a2030;
    box-shadow: 0 10px 28px rgba(0,0,0,.18);
    transform: rotate(-0.4deg);
    position: relative;
  }

  .echoes-photo-section::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    width: 0;
    height: 0;
    border-top: 30px solid #8B9BB0;
    border-left: 30px solid transparent;
  }

  .echoes-photo-section .echoes-kicker,
  .echoes-photo-section h3,
  .echoes-photo-section .echoes-prose,
  .echoes-photo-section .echoes-prose p {
    color: #1a2030;
  }

  .echoes-photo-section h3 {
    margin: 8px 0 18px;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 600;
  }

  .echoes-photo-prose {
    font-size: 15px;
    line-height: 1.9;
  }

  .echoes-cluster-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 22px;
    margin-top: 44px;
  }

  .echoes-cluster-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 38px 18px 24px;
    border: 1px solid var(--hairline);
    border-top: 2px solid var(--cluster-color);
    background: transparent;
    cursor: pointer;
    min-height: 240px;
    transition: background .3s;
    text-align: center;
  }

  .echoes-cluster-card:hover {
    background: color-mix(in srgb, var(--cluster-color) 5%, transparent);
  }

  /* 粒子環容器 */
  .echoes-orb-field {
    position: relative;
    width: 110px;
    height: 110px;
    flex-shrink: 0;
  }

  /* 環繞粒子 */
  .echoes-orb-particle {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    animation: orb-pulse 3s ease-in-out infinite;
  }

  /* 中心球 */
  .echoes-orb-center {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 26px;
    height: 26px;
    border-radius: 50%;
  }

  @keyframes orb-pulse {
    0%, 100% { transform: scale(1); opacity: 0.5; }
    50% { transform: scale(1.3); opacity: 0.95; }
  }

  .echoes-cluster-text {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .echoes-cluster-name {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 600;
  }

  .echoes-cluster-desc {
    font-family: var(--font-serif-tc);
    font-size: 12px;
    color: var(--ink-soft);
    line-height: 1.5;
  }

  .echoes-cluster-meta {
    margin-top: auto;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-mute);
  }

  .echoes-particles {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .echoes-particles span {
    position: absolute;
    font-size: 16px;
    color: ${ECHOES_ZONE.tint};
    opacity: 0;
    animation: echoes-drift linear infinite;
  }

  /* === Cluster 視圖 === */
  .echoes-cluster-page {
    min-height: 100%;
    padding: 40px 56px 80px;
  }

  .echoes-cluster-inner {
    max-width: 720px;
    margin: 0 auto;
  }

  .echoes-breadcrumb {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .echoes-breadcrumb button {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    cursor: pointer;
    padding: 0;
  }

  .echoes-breadcrumb button:hover {
    text-decoration: underline;
  }

  .echoes-cluster-head {
    display: flex;
    align-items: baseline;
    gap: 16px;
    margin-top: 10px;
  }

  .echoes-cluster-head-icon {
    font-size: 38px;
    font-family: var(--font-display);
    line-height: 1;
  }

  .echoes-cluster-head h2 {
    font-family: var(--font-display);
    font-size: 44px;
    font-weight: 600;
    color: var(--ink-title);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .echoes-cluster-subtitle {
    font-family: var(--font-serif-tc);
    font-size: 13px;
    color: var(--ink-mute);
    margin-top: 6px;
  }

  .echoes-gradient-divider {
    margin: 24px 0;
    height: 1px;
    opacity: 0.4;
  }

  .echoes-narrative {
    font-family: var(--font-serif-tc);
    font-size: 17px;
    line-height: 2;
    color: var(--ink);
    margin: 0 0 1em;
  }

  .echoes-drop-cap {
    font-family: var(--font-display);
    font-size: 56px;
    font-weight: 600;
    float: left;
    line-height: 0.85;
    padding-top: 6px;
    padding-right: 8px;
  }

  .echoes-uep-inline {
    margin: 24px 0;
  }

  .echoes-instruction {
    font-family: var(--font-serif-tc);
    font-size: 16px;
    line-height: 2;
    color: var(--ink-soft);
    margin: 0 0 12px;
  }

  .echoes-subcat-list {
    margin-top: 22px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .echoes-subcat-card {
    display: grid;
    grid-template-columns: 30px 1fr 80px 24px;
    gap: 14px;
    align-items: center;
    padding: 16px 18px;
    border: 1px solid var(--line);
    border-left: 3px solid;
    background: var(--bg-card);
    text-decoration: none;
    color: inherit;
    transition: background .2s;
    width: 100%;
    text-align: left;
  }

  .echoes-subcat-card:hover {
    background: var(--bg-soft);
  }

  .echoes-subcat-num {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.12em;
  }

  .echoes-subcat-name {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 600;
    color: var(--ink-title);
  }

  .echoes-subcat-hint {
    font-family: var(--font-serif-tc);
    font-size: 12px;
    color: var(--ink-mute);
    margin-top: 2px;
    font-style: italic;
  }

  .echoes-subcat-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--ink-mute);
    letter-spacing: 0.16em;
    text-align: right;
  }

  .echoes-subcat-arrow {
    font-size: 16px;
    text-align: center;
  }

  .echoes-extra-groups {
    margin-top: 50px;
  }

  .echoes-extra-grid {
    margin-top: 16px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .echoes-extra-item {
    padding: 12px 16px;
    border: 1px dashed var(--line);
    font-family: var(--font-serif-tc);
    font-size: 13.5px;
    color: var(--ink-soft);
    font-style: italic;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* === Content 視圖 (subcategory/cluster 閱讀) === */
  .echoes-content-page {
    min-height: 100%;
    padding: 40px 56px 80px;
  }

  .echoes-content-inner {
    max-width: 820px;
    margin: 0 auto;
  }

  .echoes-content-head {
    padding-bottom: 28px;
    margin-bottom: 28px;
    border-bottom: 1px solid var(--line);
  }

  .echoes-content-title {
    margin: 10px 0 0;
    font-family: var(--font-display);
    font-size: 42px;
    font-weight: 600;
    line-height: 1.1;
  }

  .echoes-content-desc {
    margin: 12px 0 0;
    font-family: var(--font-serif-tc);
    font-size: 16px;
    line-height: 1.9;
    color: var(--ink-soft);
    font-style: italic;
  }

  .echoes-child-list {
    margin-top: 32px;
  }

  /* === 歌曲清單（播放列表樣式）=== */
  .echoes-playlist {
    margin-top: 28px;
  }

  .echoes-playlist-header {
    padding-bottom: 12px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--line);
  }

  .echoes-playlist-item {
    display: grid;
    grid-template-columns: 32px 1fr auto 24px;
    gap: 12px;
    align-items: center;
    width: 100%;
    padding: 14px 16px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background .15s;
  }

  .echoes-playlist-item:hover {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .echoes-playlist-num {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-mute);
    letter-spacing: 0.08em;
  }

  .echoes-playlist-item:hover .echoes-playlist-num {
    color: var(--accent);
  }

  .echoes-playlist-info {
    min-width: 0;
  }

  .echoes-playlist-title {
    font-family: var(--font-serif-tc);
    font-size: 15px;
    color: var(--ink-title);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .echoes-playlist-sub {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--ink-mute);
    letter-spacing: 0.12em;
    margin-top: 2px;
  }

  /* Inline glitch 文字（列表用） */
  .echoes-glitch-inline {
    position: relative;
    display: inline-block;
    user-select: none;
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
  }
  .echoes-glitch-inline .echoes-glitch-r,
  .echoes-glitch-inline .echoes-glitch-b {
    position: absolute;
    inset: 0;
    mix-blend-mode: multiply;
    pointer-events: none;
    overflow: hidden;
    white-space: nowrap;
  }
  .echoes-glitch-inline .echoes-glitch-r {
    color: rgba(220, 40, 80, 0.6);
    animation: echoes-glitch-shift-r 0.3s steps(2) infinite;
  }
  .echoes-glitch-inline .echoes-glitch-b {
    color: rgba(40, 120, 200, 0.6);
    animation: echoes-glitch-shift-b 0.3s steps(2) infinite;
  }
  .echoes-glitch-inline .echoes-glitch-main {
    position: relative;
  }

  @keyframes echoes-glitch-shift-r {
    0%   { transform: translate(1px, -1px); }
    50%  { transform: translate(-1px, 1px); }
    100% { transform: translate(1px, -1px); }
  }
  @keyframes echoes-glitch-shift-b {
    0%   { transform: translate(-1px, 1px); }
    50%  { transform: translate(1px, -1px); }
    100% { transform: translate(-1px, 1px); }
  }

  /* === Song 視圖 === */
  .echoes-song-page {
    min-height: 100%;
    padding: 40px 56px 80px;
  }

  .echoes-song-inner {
    max-width: 720px;
    margin: 0 auto;
  }

  .echoes-song-meta-line {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 18px;
    margin-bottom: 14px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    flex-wrap: wrap;
  }

  .echoes-song-category {
    padding: 3px 9px;
    border: 1px solid;
  }

  .echoes-song-hero {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 36px;
    align-items: flex-start;
  }

  .echoes-song-info {
    padding-top: 4px;
  }

  .echoes-song-title {
    margin: 0 0 10px;
    line-height: 1.1;
  }

  .echoes-song-en-title {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 400;
    color: var(--ink-soft);
    letter-spacing: 0.02em;
    margin-bottom: 6px;
  }

  .echoes-song-subtitle {
    font-family: var(--font-serif-tc);
    font-size: 17px;
    font-style: italic;
    margin-bottom: 10px;
  }

  .echoes-song-audio-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin-bottom: 18px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--ink-mute);
  }

  .echoes-song-audio-meta span {
    display: inline-flex;
    align-items: center;
  }

  .echoes-song-audio-meta span + span::before {
    content: "·";
    margin-right: 14px;
    color: var(--line);
  }

  /* === 唱片 === */
  .echoes-vinyl-wrap {
    position: relative;
    width: 240px;
    height: 240px;
    flex-shrink: 0;
  }

  .echoes-vinyl {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1px solid var(--line);
    box-shadow: 0 12px 28px rgba(20,12,4,0.06);
    animation: vinyl-spin 16s linear infinite;
    animation-play-state: paused;
  }

  .echoes-vinyl[data-playing="true"] {
    animation-play-state: running;
  }

  .echoes-vinyl-ring {
    position: absolute;
    border-radius: 50%;
    border: 1px solid var(--line);
  }

  .echoes-vinyl-hole {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--bg);
    border: 1px solid var(--line);
  }

  .echoes-vinyl-cover-overlay {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: radial-gradient(
      circle at 50% 50%,
      transparent 8%,
      rgba(0,0,0,0.08) 10%,
      transparent 12%,
      transparent 100%
    );
    pointer-events: none;
  }

  .echoes-vinyl-lock {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(255,253,247,0.8);
    border-radius: 50%;
    backdrop-filter: blur(4px);
  }

  [data-theme="dark"] .echoes-vinyl-lock {
    background: rgba(20,20,30,0.8);
  }

  .echoes-vinyl-lock span {
    font-family: var(--font-mono);
    font-size: 11px;
    color: crimson;
    letter-spacing: 0.24em;
    text-transform: uppercase;
  }

  @keyframes vinyl-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* === 播放器 === */
  .echoes-player {
    display: grid;
    grid-template-columns: 40px 1fr 90px;
    gap: 14px;
    align-items: center;
    padding: 13px 16px;
    border: 1px solid;
    transition: border-color .2s, background .2s;
  }

  .echoes-player-btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1.5px solid;
    display: grid;
    place-items: center;
    font-size: 12px;
    transition: background .2s, color .2s;
  }

  .echoes-player-bar {
    position: relative;
  }

  .echoes-player-track {
    height: 3px;
    background: var(--line);
    position: relative;
  }

  .echoes-player-fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    transition: width .15s linear;
  }

  .echoes-player-thumb {
    position: absolute;
    top: 50%;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    transition: left .15s linear;
  }

  .echoes-player-seek {
    position: absolute;
    inset: -6px 0;
    width: 100%;
    opacity: 0;
    cursor: pointer;
    margin: 0;
  }

  .echoes-player-times {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--ink-mute);
    display: flex;
    justify-content: space-between;
  }

  .echoes-player-status {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-align: right;
  }

  /* === 賞析 === */
  .echoes-appreciation {
    margin-top: 40px;
    padding-top: 26px;
    border-top: 1px solid var(--line);
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 24px;
  }

  .echoes-appreciation-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
  }

  .echoes-appreciation-body {
    font-family: var(--font-serif-tc);
    font-size: 16px;
    line-height: 2.05;
    color: var(--ink);
  }

  .echoes-appreciation-body p {
    margin: 0 0 14px;
  }

  /* === Prev/Next === */
  .echoes-page-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 50px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }

  .echoes-page-nav button {
    min-width: 0;
    flex: 1;
    padding: 14px 16px;
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: 10px;
    text-decoration: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .echoes-page-nav button:last-child {
    text-align: right;
  }

  .echoes-page-nav button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .echoes-page-nav span {
    display: block;
    margin-bottom: 5px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-mute);
  }

  .echoes-page-nav strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-serif-tc);
    font-size: 14px;
    color: var(--ink-title);
  }

  /* === 返回按鈕 === */
  .echoes-back-bar {
    margin-top: 40px;
    padding-top: 24px;
    border-top: 1px solid var(--line);
    text-align: center;
  }

  .echoes-back-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 28px;
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
    font-family: var(--font-serif-tc);
    font-size: 14px;
    cursor: pointer;
    transition: background .2s, color .2s;
  }

  .echoes-back-btn:hover {
    background: var(--accent);
    color: #fff;
  }

  /* === Spoiler Dialog === */
  .echoes-spoiler-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0,0,0,0.5);
    display: grid;
    place-items: center;
    backdrop-filter: blur(4px);
  }

  .echoes-spoiler-dialog {
    max-width: 440px;
    width: 90%;
    background: var(--bg);
    border: 1px solid crimson;
    padding: 0;
  }

  .echoes-spoiler-dialog-header {
    padding: 16px 18px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: crimson;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    border-bottom: 1px solid color-mix(in srgb, crimson 30%, transparent);
  }

  .echoes-spoiler-dialog-body {
    padding: 18px;
    font-family: var(--font-serif-tc);
    font-size: 14px;
    line-height: 1.7;
    color: var(--ink-soft);
  }

  .echoes-spoiler-dialog-actions {
    padding: 0 18px 18px;
    display: flex;
    gap: 10px;
  }

  .echoes-btn-danger {
    padding: 7px 16px;
    border: 1px solid crimson;
    background: crimson;
    color: #fff;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .echoes-btn-ghost {
    padding: 7px 16px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink-soft);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
  }

  /* === 狀態提示 === */
  .echoes-state {
    display: block;
    padding: 18px;
    color: var(--ink-mute);
    font-family: var(--font-serif-tc);
    font-size: 13px;
    line-height: 1.6;
  }

  .echoes-state-error {
    color: #b86060;
  }

  .echoes-state button {
    display: block;
    margin-top: 10px;
    border: 1px solid var(--line-strong);
    background: var(--bg-card);
    color: var(--ink);
    padding: 6px 10px;
    cursor: pointer;
  }

  .echoes-state-large {
    min-height: 260px;
    display: grid;
    place-items: center;
    text-align: center;
  }

  /* === 響應式 === */
  @media (max-width: 760px) {
    .echoes-landing,
    .echoes-cluster-page,
    .echoes-song-page {
      padding: 32px 20px 56px;
    }

    .echoes-landing-title {
      font-size: 42px;
    }

    .echoes-cluster-head h2 {
      font-size: 32px;
    }

    .echoes-cluster-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .echoes-song-hero {
      grid-template-columns: 1fr;
      gap: 24px;
    }

    .echoes-vinyl-wrap {
      width: 180px;
      height: 180px;
      margin: 0 auto;
    }

    .echoes-appreciation {
      grid-template-columns: 1fr;
    }

    .echoes-appreciation-label {
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
    }

    .echoes-page-nav {
      grid-template-columns: 1fr;
    }

    .echoes-extra-grid {
      grid-template-columns: 1fr;
    }
  }
`;
