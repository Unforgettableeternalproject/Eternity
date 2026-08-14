/**
 * UEP 全域音訊系統 — 中央 Store（module singleton + window bridge）
 *
 * 跨 React island 共享模式沿用 progressStore / islandRuntime 的做法：
 * module-level state + `window.__uepAudio` bridge + subscribe/notify。
 * Audio 元素活在 module 層（不進 React tree）——React 元件 unmount
 * 不會殺掉播放；同 zone pushState 導航音樂天然不斷。
 *
 * 跨 zone 整頁重載：由 `uep.audio.v1` 讀回上次狀態，恢復為**暫停態**，
 * 等使用者手勢續播（autoplay policy 防禦）。
 *
 * 依賴方向（S8 設計定案）：本模組可 import progress / auth，
 * **禁止 import islands/islandRuntime**（避免循環依賴）——登出與進度
 * reset 的生命週期走 auth subscribe 與 PROGRESS_CHANGE_EVENT 解耦。
 */

import { getReaderAuth } from '../auth';
import { PROGRESS_CHANGE_EVENT, getProgressManager } from '../progress';
import type { ProgressChangeDetail } from '../progress';

import {
  AUDIO_PERSIST_THROTTLE_MS,
  AUDIO_STORAGE_KEY,
  DEFAULT_VOLUME,
  LEGACY_VOLUME_KEY,
  createInitialAudioState,
} from './audioTypes';
import type {
  AudioLoopMode,
  AudioPersisted,
  AudioQueueItem,
  AudioState,
} from './audioTypes';

type Listener = (state: AudioState) => void;

declare global {
  interface Window {
    __uepAudio?: typeof uepAudio;
  }
}

/* ── module-level 狀態 ── */
let audioEl: HTMLAudioElement | null = null;
/** 目前已載入 audio 元素的曲目 id（與 state.currentSongId 分開——
 * 重載恢復時 state 有曲目但元素尚未載入音源） */
let loadedSongId: string | null = null;
/** 待套用的續播時間（重載恢復 / 插播恢復用），套用一次即清 */
let pendingSeekTime: number | null = null;
let isSeeking = false;
let rafId = 0;
let lastPersistAt = 0;
/** 插播世代序號——判斷失敗回滾是否已被更新的插播取代（見 interrupt） */
let interruptGeneration = 0;
const listeners: Listener[] = [];
const MAX_HISTORY_ITEMS = 50;
let state: AudioState = bootstrapState();

/* ── 持久化 ── */

function clampVolume(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** 驗證並正規化持久化資料，形狀不對時整筆放棄 */
function normalizePersisted(raw: unknown): AudioPersisted | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Partial<AudioPersisted>;
  const loop: AudioLoopMode =
    o.loop === 'one' || o.loop === 'all' ? o.loop : 'none';
  const normalizeItems = (items: unknown): AudioQueueItem[] =>
    Array.isArray(items)
      ? items.filter(
          (it): it is AudioQueueItem =>
            typeof it === 'object' &&
            it !== null &&
            typeof (it as AudioQueueItem).songId === 'string' &&
            typeof (it as AudioQueueItem).url === 'string'
        )
      : [];
  const playlist = normalizeItems(o.playlist);
  const history = normalizeItems(o.history).slice(-MAX_HISTORY_ITEMS);
  return {
    currentSongId: typeof o.currentSongId === 'string' ? o.currentSongId : null,
    currentUrl: typeof o.currentUrl === 'string' ? o.currentUrl : null,
    currentTitle: typeof o.currentTitle === 'string' ? o.currentTitle : null,
    currentAccent: typeof o.currentAccent === 'string' ? o.currentAccent : null,
    currentTime:
      typeof o.currentTime === 'number' && Number.isFinite(o.currentTime)
        ? Math.max(0, o.currentTime)
        : 0,
    duration:
      typeof o.duration === 'number' && Number.isFinite(o.duration)
        ? Math.max(0, o.duration)
        : 0,
    playlist,
    history,
    volume: clampVolume(
      typeof o.volume === 'number' && Number.isFinite(o.volume)
        ? o.volume
        : DEFAULT_VOLUME
    ),
    loop,
    wasPlaying: o.wasPlaying === true,
  };
}

function readPersisted(): AudioPersisted | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return null;
    return normalizePersisted(JSON.parse(raw));
  } catch {
    return null;
  }
}

function toPersisted(s: AudioState): AudioPersisted {
  return {
    currentSongId: s.currentSongId,
    currentUrl: s.currentUrl,
    currentTitle: s.currentTitle,
    currentAccent: s.currentAccent,
    currentTime: s.currentTime,
    duration: s.duration,
    playlist: s.playlist,
    history: s.history,
    volume: s.volume,
    loop: s.loop,
    wasPlaying: s.isPlaying,
  };
}

/** 寫入持久化（靜默失敗——音訊是輔助功能，不阻斷閱讀） */
function persistSnapshot(s: AudioState): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      AUDIO_STORAGE_KEY,
      JSON.stringify(toPersisted(s))
    );
    lastPersistAt = Date.now();
  } catch {
    // localStorage 滿載或被禁用時靜默失敗
  }
}

function persistNow(): void {
  persistSnapshot(state);
}

/**
 * 初始化：同步讀回上次狀態（一律暫停態），並收編舊 `uep-player-volume`。
 * SSR 環境回傳純初始狀態，Audio 元素延遲到首次播放才建立。
 */
function bootstrapState(): AudioState {
  const base = createInitialAudioState();
  if (typeof window === 'undefined' || !window.localStorage) return base;

  // 舊版音量 key 遷移（讀完即刪；新格式存在時以新格式為準）
  let legacyVolume: number | null = null;
  try {
    const legacy = window.localStorage.getItem(LEGACY_VOLUME_KEY);
    if (legacy !== null) {
      const v = parseFloat(legacy);
      if (Number.isFinite(v)) legacyVolume = clampVolume(v);
      window.localStorage.removeItem(LEGACY_VOLUME_KEY);
    }
  } catch {
    // 靜默
  }

  const persisted = readPersisted();
  if (!persisted) {
    const next = { ...base, volume: legacyVolume ?? base.volume };
    if (legacyVolume !== null) persistSnapshot(next); // 遷移結果落地
    return next;
  }

  // 有上次狀態：恢復為暫停態，等使用者手勢續播
  if (persisted.currentSongId) pendingSeekTime = persisted.currentTime;
  return {
    ...base,
    currentSongId: persisted.currentSongId,
    currentUrl: persisted.currentUrl,
    currentTitle: persisted.currentTitle,
    currentAccent: persisted.currentAccent,
    currentTime: persisted.currentTime,
    duration: persisted.duration,
    progress:
      persisted.duration > 0
        ? Math.min(1, persisted.currentTime / persisted.duration)
        : 0,
    playlist: persisted.playlist,
    history: persisted.history ?? [],
    volume: persisted.volume,
    loop: persisted.loop,
  };
}

/* ── 狀態更新與通知 ── */

function notify(): void {
  listeners.forEach((fn) => fn(state));
}

function setState(patch: Partial<AudioState>): void {
  state = { ...state, ...patch };
  notify();
}

/* ── Audio 元素（惰性建立，SSR 防禦） ── */

function ensureAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (audioEl) return audioEl;
  audioEl = new Audio();
  audioEl.preload = 'metadata';
  audioEl.volume = state.volume;
  audioEl.addEventListener('ended', handleEnded);
  audioEl.addEventListener('loadedmetadata', () => {
    if (!audioEl) return;
    setState({ duration: audioEl.duration || 0 });
  });
  return audioEl;
}

/** RAF 驅動的進度更新；播放中順帶 throttle 持久化（~5s） */
function updateProgress(): void {
  const audio = audioEl;
  if (!audio) return;
  // 拖曳 seek 期間暫停更新，避免受控 input 被 RAF 覆蓋
  if (!isSeeking) {
    const dur = audio.duration || 0;
    setState({
      currentTime: audio.currentTime,
      progress: dur > 0 ? audio.currentTime / dur : 0,
      duration: dur,
    });
    if (Date.now() - lastPersistAt >= AUDIO_PERSIST_THROTTLE_MS) persistNow();
  }
  if (!audio.paused) {
    // 先取消前一個待執行的 RAF，確保同時只有一條鏈在跑
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(updateProgress);
  }
}

/** 等 metadata 就緒後定位到比例位置（playAtFraction 用，沿 endSeek retry 模式） */
function seekFractionWhenReady(
  audio: HTMLAudioElement,
  fraction: number
): void {
  const apply = (): boolean => {
    if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = fraction * audio.duration;
      setState({
        currentTime: audio.currentTime,
        duration: audio.duration,
        progress: fraction,
      });
      return true;
    }
    return false;
  };
  if (apply()) return;
  const retry = () => {
    apply();
    audio.removeEventListener('loadedmetadata', retry);
  };
  audio.addEventListener('loadedmetadata', retry);
}

/** 等 metadata 就緒後定位（重載/插播恢復用，沿 endSeek retry 模式） */
function seekWhenReady(audio: HTMLAudioElement, time: number): void {
  const apply = (): boolean => {
    if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Math.min(time, audio.duration);
      setState({
        currentTime: audio.currentTime,
        duration: audio.duration,
        progress: audio.currentTime / audio.duration,
      });
      return true;
    }
    return false;
  };
  if (apply()) return;
  const retry = () => {
    apply();
    audio.removeEventListener('loadedmetadata', retry);
  };
  audio.addEventListener('loadedmetadata', retry);
}

/** 將一般播放切換前的曲目加入歷史；Echo Spot 插播本身不列入。 */
function recordCurrentForHistory(nextSongId: string): void {
  if (state.currentSongId === nextSongId) return;

  const snapshot = state.interruptionSnapshot;
  const previous: AudioQueueItem | null =
    snapshot?.songId && snapshot.url
      ? {
          songId: snapshot.songId,
          url: snapshot.url,
          ...(snapshot.title ? { title: snapshot.title } : {}),
          ...(snapshot.accent ? { accent: snapshot.accent } : {}),
        }
      : state.currentSongId && state.currentUrl
        ? {
            songId: state.currentSongId,
            url: state.currentUrl,
            ...(state.currentTitle ? { title: state.currentTitle } : {}),
            ...(state.currentAccent ? { accent: state.currentAccent } : {}),
          }
        : null;

  // 使用者在插播期間主動選歌時，回溯來源是插播前的正常曲目；
  // Echo Spot 曲目本身不進歷史。
  if (snapshot) setState({ interruptionSnapshot: null });
  if (!previous || previous.songId === nextSongId) return;
  setState({ history: [...state.history, previous].slice(-MAX_HISTORY_ITEMS) });
}
/**
 * 載入曲目到 audio 元素（同曲不重載）。
 * 重載恢復場景：state.currentSongId 已有值但元素未載入——此時
 * pendingSeekTime 會在載入後套用（續播位置）。
 */
function loadSong(
  songId: string,
  url: string,
  title?: string,
  accent?: string
): HTMLAudioElement | null {
  const audio = ensureAudio();
  if (!audio) return null;
  if (loadedSongId === songId) {
    // 同曲已載入仍要消化 pendingSeekTime——插播從頭（interrupt 設 0）
    // 與同曲插播後恢復原位置（restoreFromInterruption 設快照時間）都靠這裡。
    if (pendingSeekTime !== null) {
      const seekTime = pendingSeekTime;
      pendingSeekTime = null;
      seekWhenReady(audio, seekTime);
    }
    return audio;
  }

  const resumeTime =
    state.currentSongId === songId && pendingSeekTime !== null
      ? pendingSeekTime
      : null;
  pendingSeekTime = null;

  audio.src = url;
  audio.load();
  loadedSongId = songId;

  setState({
    currentSongId: songId,
    currentUrl: url,
    currentTitle: title ?? (resumeTime !== null ? state.currentTitle : null),
    currentAccent: accent ?? (resumeTime !== null ? state.currentAccent : null),
    currentTime: resumeTime ?? 0,
    progress:
      resumeTime !== null && state.duration > 0
        ? Math.min(1, resumeTime / state.duration)
        : 0,
    ...(resumeTime === null ? { duration: 0 } : {}),
  });
  if (resumeTime !== null) seekWhenReady(audio, resumeTime);
  persistNow(); // 換曲立即落地
  return audio;
}

/**
 * loop='all' 換曲時要回到佇列尾的曲目。插播中「當前曲」是 Echo Spot
 * 插播曲，不得污染正常佇列——回填來源改用快照裡使用者自己的曲目
 * （與 recordCurrentForHistory 的歷史來源同語意）。
 */
function loopRequeueItem(): AudioQueueItem | null {
  if (state.loop !== 'all') return null;
  const snapshot = state.interruptionSnapshot;
  if (snapshot) {
    return snapshot.songId && snapshot.url
      ? {
          songId: snapshot.songId,
          url: snapshot.url,
          ...(snapshot.title ? { title: snapshot.title } : {}),
          ...(snapshot.accent ? { accent: snapshot.accent } : {}),
        }
      : null;
  }
  return state.currentSongId && state.currentUrl
    ? {
        songId: state.currentSongId,
        url: state.currentUrl,
        ...(state.currentTitle ? { title: state.currentTitle } : {}),
        ...(state.currentAccent ? { accent: state.currentAccent } : {}),
      }
    : null;
}

/** 播放佇列頭；loop='all' 時當前曲回到佇列尾。回傳是否有曲可播 */
function playQueueHead(): boolean {
  const [next, ...rest] = state.playlist;
  if (!next) return false;
  const requeue = loopRequeueItem();
  setState({ playlist: requeue ? [...rest, requeue] : rest });
  uepAudio.play(next.songId, next.url, next.title, next.accent);
  return true;
}

/** 曲目播畢的分流：插播恢復 → 單曲循環 → 佇列推進 → 停止 */
function handleEnded(): void {
  cancelAnimationFrame(rafId);
  // 插播曲播畢 → 恢復快照（設計文件 4-2 恢復條件之一）
  if (state.interruptionSnapshot) {
    uepAudio.restoreFromInterruption();
    return;
  }
  if (state.loop === 'one' && audioEl) {
    audioEl.currentTime = 0;
    setState({ currentTime: 0, progress: 0 });
    void audioEl
      .play()
      .then(() => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(updateProgress);
      })
      .catch(() => {
        setState({ isPlaying: false });
      });
    return;
  }
  if (playQueueHead()) return;
  setState({ isPlaying: false, progress: 1 });
  persistNow();
}

/* ── 公開 API ── */
export const uepAudio = {
  /** 取得目前狀態（唯讀快照，勿直接修改） */
  getState(): AudioState {
    return state;
  },

  /** 訂閱狀態變更，回傳取消訂閱函式 */
  subscribe(listener: Listener): () => void {
    listeners.push(listener);
    return () => {
      const i = listeners.indexOf(listener);
      if (i > -1) listeners.splice(i, 1);
    };
  },

  /* ── 播放控制 ── */

  /**
   * 播放指定曲目（同曲續播、異曲換載）。回傳是否真的開始播放，
   * 讓 echo spot 在 autoplay 被擋時可降級成提示卡；一般 UI 可忽略回傳值。
   */
  play(
    songId: string,
    url: string,
    title?: string,
    accent?: string,
    recordHistory = true
  ): Promise<boolean> {
    if (recordHistory) recordCurrentForHistory(songId);
    const audio = loadSong(songId, url, title, accent);
    if (!audio) return Promise.resolve(false);
    cancelAnimationFrame(rafId);
    return audio
      .play()
      .then(() => {
        setState({ isPlaying: true });
        persistNow();
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(updateProgress);
        return true;
      })
      .catch(() => {
        setState({ isPlaying: false });
        return false;
      });
  },

  /**
   * 從指定比例位置開始播放（原子 play-at-position）。
   * Reader 對「非當前歌曲」拖 seek 用：舊做法（endSeek 舊曲 → play 新曲
   * → 50ms 後 seek）會先動到舊曲位置，且 metadata 晚於 50ms 時新曲
   * seek 遺失——這裡改用 loadedmetadata retry，定位不再依賴固定延遲。
   */
  playAtFraction(
    songId: string,
    url: string,
    fraction: number,
    title?: string,
    accent?: string
  ): Promise<boolean> {
    // 呼叫端可能在拖曳手勢中切換目標曲，先重置 seek 旗標避免 RAF 卡住
    isSeeking = false;
    recordCurrentForHistory(songId);
    const audio = loadSong(songId, url, title, accent);
    if (!audio) return Promise.resolve(false);
    seekFractionWhenReady(audio, Math.max(0, Math.min(1, fraction)));
    cancelAnimationFrame(rafId);
    return audio
      .play()
      .then(() => {
        setState({ isPlaying: true });
        persistNow();
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(updateProgress);
        return true;
      })
      .catch(() => {
        setState({ isPlaying: false });
        return false;
      });
  },

  pause(): void {
    audioEl?.pause();
    cancelAnimationFrame(rafId);
    setState({ isPlaying: false });
    persistNow();
  },

  toggle(songId: string, url: string, title?: string, accent?: string): void {
    if (state.currentSongId === songId && state.isPlaying) {
      this.pause();
    } else {
      void this.play(songId, url, title, accent);
    }
  },

  seek(fraction: number): void {
    const audio = audioEl;
    if (!audio) return;
    const d = audio.duration;
    if (d && isFinite(d) && d > 0) {
      audio.currentTime = fraction * d;
      setState({ currentTime: audio.currentTime, progress: fraction });
      persistNow();
    }
  },

  beginSeek(): void {
    isSeeking = true;
  },

  endSeek(fraction: number): void {
    isSeeking = false;
    const audio = audioEl;
    if (!audio) return;
    const d = audio.duration;
    if (d && isFinite(d) && d > 0) {
      audio.currentTime = fraction * d;
      setState({ currentTime: audio.currentTime, progress: fraction });
      persistNow();
    } else {
      // duration 尚未載入（部分音檔延遲回報），等 metadata 就緒後重試
      const retry = () => {
        if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = fraction * audio.duration;
          setState({ currentTime: audio.currentTime, progress: fraction });
          persistNow();
        }
        audio.removeEventListener('loadedmetadata', retry);
      };
      audio.addEventListener('loadedmetadata', retry);
    }
  },

  setVolume(v: number): void {
    const clamped = clampVolume(v);
    if (audioEl) audioEl.volume = clamped;
    setState({ volume: clamped });
    persistNow();
  },

  setLoop(mode: AudioLoopMode): void {
    if (mode === state.loop) return;
    setState({ loop: mode });
    persistNow();
  },

  /** 手動跳下一首（佇列空時 no-op；loop='all' 時當前曲回佇列尾） */
  next(): void {
    if (state.interruptionSnapshot && state.playlist.length === 0) {
      this.restoreFromInterruption();
      return;
    }
    // playQueueHead 的一般 play 會在插播中改取 interruption snapshot
    // 作為歷史來源，因此 Echo Spot 本身不會污染歷史。
    playQueueHead();
  },

  /** 回到上一首一般播放曲目；沒有歷史時才重播當前曲。 */
  previous(): void {
    if (state.interruptionSnapshot) {
      // 插播中的 previous 語意是「回到被中斷的曲目」。
      this.restoreFromInterruption();
      return;
    }

    const previous = state.history[state.history.length - 1];
    if (previous) {
      const current =
        state.currentSongId && state.currentUrl
          ? {
              songId: state.currentSongId,
              url: state.currentUrl,
              ...(state.currentTitle ? { title: state.currentTitle } : {}),
              ...(state.currentAccent ? { accent: state.currentAccent } : {}),
            }
          : null;
      setState({
        history: state.history.slice(0, -1),
        playlist: current
          ? [
              current,
              ...state.playlist.filter(
                (item) => item.songId !== current.songId
              ),
            ]
          : state.playlist,
      });
      pendingSeekTime = 0;
      void this.play(
        previous.songId,
        previous.url,
        previous.title,
        previous.accent,
        false
      );
      persistNow();
      return;
    }

    if (!state.currentSongId) return;
    const audio = audioEl;
    if (audio && loadedSongId === state.currentSongId) {
      audio.currentTime = 0;
      setState({ currentTime: 0, progress: 0 });
    } else {
      pendingSeekTime = 0;
      setState({ currentTime: 0, progress: 0 });
    }
    persistNow();
  },

  /* ── 佇列管理 ── */

  /** 加入佇列（同曲去重） */
  enqueue(item: AudioQueueItem): void {
    if (state.playlist.some((it) => it.songId === item.songId)) return;
    setState({ playlist: [...state.playlist, item] });
    persistNow();
  },

  setPlaylist(items: AudioQueueItem[]): void {
    setState({ playlist: [...items] });
    persistNow();
  },

  clearPlaylist(): void {
    if (state.playlist.length === 0) return;
    setState({ playlist: [] });
    persistNow();
  },

  /* ── 插播（echo spot，C 段接掃描線） ── */

  /**
   * 插播：記錄快照 → 播放插播曲。
   * 快照不巢狀——已在插播中再次呼叫只換曲、不重拍快照，
   * 恢復點永遠是使用者自己的播放狀態（不會恢復到上一個插播）。
   * 佇列在插播期間保持原樣（整頁重載不遺失佇列）。
   * 插播一律從頭播放——插播曲恰是當前曲（已載入或重載恢復中）時
   * 也不續播，快照仍保住使用者原本的位置。
   * 播放被瀏覽器拒絕（autoplay 政策）時回滾本次拍的快照——
   * 插播沒發生，島不得停留在「插播中」假象。
   */
  interrupt(
    songId: string,
    url: string,
    title?: string,
    accent?: string
  ): Promise<boolean> {
    const generation = ++interruptGeneration;
    const tookSnapshot = !state.interruptionSnapshot;
    if (tookSnapshot) {
      setState({
        interruptionSnapshot: {
          songId: state.currentSongId,
          url: state.currentUrl,
          title: state.currentTitle,
          accent: state.currentAccent,
          currentTime: state.currentTime,
          wasPlaying: state.isPlaying,
        },
      });
    }
    pendingSeekTime = 0;
    return this.play(songId, url, title, accent, false).then((played) => {
      // 快照非本次拍的（插播中再插播失敗）不動——恢復點仍是使用者狀態；
      // 期間快照已被他處消化（如離頁 restore）也不重複回滾。
      // 已被更新的插播取代（雙 echo spot 連續通過）也不回滾——本次的
      // play 是被新插播換 src 打斷的（AbortError），不是真的播不出來；
      // 這裡回滾會把正在載入的新插播踩掉、讓原曲復活。
      if (
        !played &&
        tookSnapshot &&
        state.interruptionSnapshot &&
        generation === interruptGeneration
      ) {
        this.restoreFromInterruption();
      }
      return played;
    });
  },

  /**
   * 結束插播並恢復快照。恢復條件（任一，呼叫端負責）：
   * 離開頁面 / 播放完畢（store 內建）/ 使用者手動切掉。
   * wasPlaying=true 才續播（插播前本來就暫停則維持暫停）。
   */
  restoreFromInterruption(): void {
    const snap = state.interruptionSnapshot;
    if (!snap) return;
    setState({ interruptionSnapshot: null });

    if (!snap.songId || !snap.url) {
      // 插播前沒有在播任何東西 → 回到無曲目狀態
      audioEl?.pause();
      cancelAnimationFrame(rafId);
      if (audioEl) audioEl.src = '';
      loadedSongId = null;
      setState({
        isPlaying: false,
        currentSongId: null,
        currentUrl: null,
        currentTitle: null,
        currentAccent: null,
        currentTime: 0,
        progress: 0,
        duration: 0,
      });
      persistNow();
      return;
    }

    // 回到原曲與原位置
    pendingSeekTime = snap.currentTime;
    setState({ currentSongId: snap.songId });
    if (snap.wasPlaying) {
      void this.play(
        snap.songId,
        snap.url,
        snap.title ?? undefined,
        snap.accent ?? undefined
      );
    } else {
      loadSong(
        snap.songId,
        snap.url,
        snap.title ?? undefined,
        snap.accent ?? undefined
      );
      audioEl?.pause();
      setState({ isPlaying: false });
      persistNow();
    }
  },

  /** 丟棄插播快照但不恢復（呼叫端明確不想回去時用） */
  clearInterruption(): void {
    if (!state.interruptionSnapshot) return;
    setState({ interruptionSnapshot: null });
  },

  /* ── 生命週期 ── */

  /**
   * 使用者主動清除島內播放狀態：停止目前曲目並清空佇列、歷史與
   * 插播快照，但保留音量和循環偏好。與登出/reset 的 stop() 不同，
   * 這是同一帳號內可恢復到乾淨播放器的操作。
   */
  clearPlayback(): void {
    cancelAnimationFrame(rafId);
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
    }
    loadedSongId = null;
    pendingSeekTime = null;
    isSeeking = false;
    const { volume, loop } = state;
    state = { ...createInitialAudioState(), volume, loop };
    notify();
    persistNow();
  },

  /**
   * 全面停止：登出 / 進度 reset / echoes 島被停用時呼叫。
   * 停止播放、清空全部狀態（含音量回預設）、清除持久化——
   * 同瀏覽器換帳號不得殘留上一個帳號的播放狀態。
   */
  stop(): void {
    cancelAnimationFrame(rafId);
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
    }
    loadedSongId = null;
    pendingSeekTime = null;
    isSeeking = false;
    state = createInitialAudioState();
    notify();
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(AUDIO_STORAGE_KEY);
        window.localStorage.removeItem(LEGACY_VOLUME_KEY);
      } catch {
        // 靜默
      }
    }
  },
};

/* ── window bridge（跨 React island 單例保證）＋ 生命週期接線 ── */
if (typeof window !== 'undefined' && !window.__uepAudio) {
  window.__uepAudio = uepAudio;

  // 登出（session → null）：停止播放 + 清持久化——與 islandRuntime 的
  // resetAll 同語意但不 import（依賴方向：islands 之後可 import audio，
  // audio 永不 import islands）。
  const auth = getReaderAuth();
  let wasLoggedIn = auth.isLoggedIn();
  auth.subscribe((session) => {
    const loggedIn = session !== null;
    if (!loggedIn && wasLoggedIn) uepAudio.stop();
    wasLoggedIn = loggedIn;
  });

  // 進度 reset / echoes 島被使用者停用 → 停止播放。
  // 走 CustomEvent 不走 store 訂閱——與 islandRuntime 同模式解耦。
  let echoesWasDisabled = getProgressManager()
    .getState()
    .islandsDisabled.includes('echoes');
  window.addEventListener(PROGRESS_CHANGE_EVENT, (e) => {
    const detail = (e as CustomEvent<ProgressChangeDetail>).detail;
    if (!detail) return;
    if (detail.source === 'reset') {
      uepAudio.stop();
      return;
    }
    if (detail.source === 'island-setting') {
      const disabled = detail.state.islandsDisabled.includes('echoes');
      if (disabled && !echoesWasDisabled) uepAudio.stop();
      echoesWasDisabled = disabled;
    }
  });

  // 快速切頁時 throttle 來不及寫 → pagehide 兜底（iOS Safari 相容）
  window.addEventListener('pagehide', () => {
    if (state.currentSongId) persistNow();
  });
}

/** 取得全域單例（優先 window bridge，SSR fallback 為 module 實例） */
export function getAudioStore(): typeof uepAudio {
  if (typeof window !== 'undefined' && window.__uepAudio) {
    return window.__uepAudio;
  }
  return uepAudio;
}
