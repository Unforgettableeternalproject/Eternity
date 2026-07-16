/**
 * UEP 全域音訊系統 — React Context 橋接層（AudioProvider 薄殼）
 *
 * S8 A-4：原 EchoesReader 內建的 AudioProvider（自持 Audio 元素、
 * unmount 即殺）改為包裹 audioStore singleton 的薄殼——Context 介面
 * 欄位與原版完全對齊，讓 EchoesAudioPlayer 等消費端零改動。
 *
 * 播放的事實來源在 audioStore（module 層），Provider 只做：
 * 1. 訂閱 store → setState 驅動重渲染
 * 2. 把操作代理到 store API
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { getAudioStore } from './audioStore';
import type { AudioState } from './audioTypes';

/** Context 介面——與原 EchoesReader AudioCtx 完全對齊（勿擅自增刪） */
export interface AudioContextValue {
  currentSongId: string | null;
  isPlaying: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  volume: number;
  play: (songId: string, url: string, title?: string, accent?: string) => void;
  pause: () => void;
  toggle: (
    songId: string,
    url: string,
    title?: string,
    accent?: string
  ) => void;
  seek: (fraction: number) => void;
  setVolume: (v: number) => void;
  beginSeek: () => void;
  endSeek: (fraction: number) => void;
}

const AudioCtx = createContext<AudioContextValue>({
  currentSongId: null,
  isPlaying: false,
  progress: 0,
  currentTime: 0,
  duration: 0,
  volume: 1,
  play: () => {},
  pause: () => {},
  toggle: () => {},
  seek: () => {},
  setVolume: () => {},
  beginSeek: () => {},
  endSeek: () => {},
});

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AudioState>(() =>
    getAudioStore().getState()
  );

  useEffect(() => {
    const store = getAudioStore();
    // mount 後補一次快照——SSR 初值與 client store 可能有落差
    setState(store.getState());
    return store.subscribe(setState);
  }, []);

  const value = useMemo<AudioContextValue>(
    () => ({
      currentSongId: state.currentSongId,
      isPlaying: state.isPlaying,
      progress: state.progress,
      currentTime: state.currentTime,
      duration: state.duration,
      volume: state.volume,
      play: (songId, url, title, accent) =>
        getAudioStore().play(songId, url, title, accent),
      pause: () => getAudioStore().pause(),
      toggle: (songId, url, title, accent) =>
        getAudioStore().toggle(songId, url, title, accent),
      seek: (fraction) => getAudioStore().seek(fraction),
      setVolume: (v) => getAudioStore().setVolume(v),
      beginSeek: () => getAudioStore().beginSeek(),
      endSeek: (fraction) => getAudioStore().endSeek(fraction),
    }),
    [state]
  );

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}

export const useAudio = () => useContext(AudioCtx);
