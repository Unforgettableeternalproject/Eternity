/**
 * UEP 全域音訊系統 — 型別定義（S8 Echoes）
 *
 * 設計依據：docs/agent/S8_ECHOES_DESIGN.md 第一章。
 * Audio 元素抽離 React tree 成 module-level singleton（audioStore.ts），
 * 這裡只放跨模組共用的型別與常數。
 */

/** 循環模式 */
export type AudioLoopMode = 'none' | 'one' | 'all';

/** 播放佇列中的單一曲目 */
export interface AudioQueueItem {
  /** Echoes 歌曲頁 id */
  songId: string;
  /** 音檔完整 URL（呼叫端以 buildAudioUrl 組好後入列） */
  url: string;
  /** 顯示用曲名（浮島佇列清單用；spoiler 遮蔽由 UI 層處理） */
  title?: string;
  /** 分類色（cluster accent，浮島視覺：黑球光暈/漣漪/衛星著色） */
  accent?: string;
}

/**
 * 插播快照 — echo spot 觸發時記錄的「插播前」播放狀態。
 *
 * 注意兩個刻意的設計：
 * 1. 快照不巢狀：已在插播中再次 interrupt 只換曲、不重拍快照——
 *    恢復點永遠是使用者自己的播放狀態，不會恢復到上一個插播。
 * 2. 不含 playlist：插播不清空佇列（佇列在插播期間保持原樣），
 *    整頁重載時佇列因此不會遺失。
 */
export interface AudioInterruptionSnapshot {
  songId: string | null;
  url: string | null;
  title: string | null;
  accent: string | null;
  currentTime: number;
  wasPlaying: boolean;
}

/** Audio Singleton 完整狀態（唯讀快照，勿直接修改） */
export interface AudioState {
  /** 目前曲目 id；null = 無 */
  currentSongId: string | null;
  /** 目前曲目音檔 URL（重載恢復與 replay 用） */
  currentUrl: string | null;
  /** 目前曲目顯示名（浮島 UI 用） */
  currentTitle: string | null;
  /** 目前曲目分類色（浮島視覺用；null = 用 zone 預設色） */
  currentAccent: string | null;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 播放進度 0-1 */
  progress: number;
  /** 目前時間（秒） */
  currentTime: number;
  /** 總時長（秒，0 = 未知） */
  duration: number;
  /** 音量 0-1 */
  volume: number;
  /** 循環模式 */
  loop: AudioLoopMode;
  /** 播放佇列（不含當前曲目） */
  playlist: AudioQueueItem[];
  /** 插播快照；null = 目前不在插播狀態 */
  interruptionSnapshot: AudioInterruptionSnapshot | null;
}

/**
 * `uep.audio.v1` 的 localStorage 持久化形狀。
 *
 * 刻意排除 interruptionSnapshot（整頁重載後插播自然結束）。
 * wasPlaying 只作「上次離開時正在播」的記號——重載後一律恢復為
 * 暫停態，等使用者手勢續播（autoplay policy 防禦）。
 */
export interface AudioPersisted {
  currentSongId: string | null;
  currentUrl: string | null;
  currentTitle: string | null;
  currentAccent: string | null;
  currentTime: number;
  /** 總時長（秒）；重載後在 metadata 就緒前先用來算 progress 顯示 */
  duration: number;
  playlist: AudioQueueItem[];
  volume: number;
  loop: AudioLoopMode;
  wasPlaying: boolean;
}

/** localStorage key（版本進 key，schema 大改時直接換代） */
export const AUDIO_STORAGE_KEY = 'uep.audio.v1';

/** 舊版音量 key（EchoesReader 時代）——bootstrap 時遷移後刪除 */
export const LEGACY_VOLUME_KEY = 'uep-player-volume';

/** 預設音量 */
export const DEFAULT_VOLUME = 0.6;

/** 播放中持久化 throttle 間隔（ms） */
export const AUDIO_PERSIST_THROTTLE_MS = 5000;

/** 建立初始狀態 */
export function createInitialAudioState(): AudioState {
  return {
    currentSongId: null,
    currentUrl: null,
    currentTitle: null,
    currentAccent: null,
    isPlaying: false,
    progress: 0,
    currentTime: 0,
    duration: 0,
    volume: DEFAULT_VOLUME,
    loop: 'none',
    playlist: [],
    interruptionSnapshot: null,
  };
}
