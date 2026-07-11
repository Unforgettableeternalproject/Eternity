/**
 * UEP 全域音訊系統 — 模組入口（S8 Echoes）
 *
 * 消費端一律從這裡 import，不要直接進子模組。
 *
 * 使用方式：
 * - React 元件：`<AudioProvider>` + `useAudio()`（Reader 介面）
 * - 跨 island / 非 React：`getAudioStore()`（完整 API：佇列/插播/停止）
 * - 純函式判定：`resolveSpoilerLevel` / `isSongCollected`
 */

export type {
  AudioLoopMode,
  AudioQueueItem,
  AudioInterruptionSnapshot,
  AudioState,
  AudioPersisted,
} from './audioTypes';
export {
  AUDIO_STORAGE_KEY,
  LEGACY_VOLUME_KEY,
  DEFAULT_VOLUME,
  AUDIO_PERSIST_THROTTLE_MS,
  createInitialAudioState,
} from './audioTypes';

export { uepAudio, getAudioStore } from './audioStore';

export { AudioProvider, useAudio } from './audioContext';
export type { AudioContextValue } from './audioContext';

export {
  resolveSpoilerLevel,
  isSpoilerPlayable,
  isSongCollected,
  deriveSongUnlockFlag,
} from './spoilerResolver';
export type { SpoilerLevel, SongSpoilerRevision } from './spoilerResolver';
