/**
 * EchoesIsland 元件測試（S8 B-3）
 *
 * 重點驗證定案行為：
 * - 收合即暫停（unmount → pause）
 * - 展開續播（收合前播放中 → 重新 mount 自動續播）
 * - 佇列互動（點列播放並移除、× 移除不播放）
 *
 * store 是 module singleton：vi.resetModules 取全新實例，Audio 以
 * MockAudio 替身、rAF stub 掉（同 audioStore 測試慣例）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ── auth mock（audioStore 的登出接線，不載入真實 readerAuth） ── */
const authMock = vi.hoisted(() => {
  const listeners: Array<(session: { token: string } | null) => void> = [];
  return {
    reset() {
      listeners.length = 0;
    },
    api: {
      isLoggedIn: () => true,
      subscribe(fn: (session: { token: string } | null) => void) {
        listeners.push(fn);
        return () => {
          const i = listeners.indexOf(fn);
          if (i > -1) listeners.splice(i, 1);
        };
      },
    },
  };
});

vi.mock('../../../auth', () => ({
  getReaderAuth: () => authMock.api,
}));

/* ── Audio 元素替身 ── */
class MockAudio {
  static instances: MockAudio[] = [];
  src = '';
  volume = 1;
  preload = '';
  paused = true;
  currentTime = 0;
  duration = 0;
  private handlers = new Map<string, Set<() => void>>();

  constructor() {
    MockAudio.instances.push(this);
  }

  addEventListener(type: string, fn: () => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: () => void): void {
    this.handlers.get(type)?.delete(fn);
  }

  load = vi.fn();
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

type AudioModule = typeof import('../../../audio');
type IslandComponent = typeof import('../EchoesIsland') extends {
  default: infer T;
}
  ? T
  : never;

async function setup(): Promise<{
  store: ReturnType<AudioModule['getAudioStore']>;
  EchoesIsland: IslandComponent;
}> {
  vi.resetModules();
  const audio: AudioModule = await import('../../../audio');
  const mod = await import('../EchoesIsland');
  return { store: audio.getAudioStore(), EchoesIsland: mod.default };
}

beforeEach(() => {
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  window.localStorage.clear();
  delete (window as { __uepAudio?: unknown }).__uepAudio;
  MockAudio.instances.length = 0;
  authMock.reset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EchoesIsland', () => {
  it('無曲目時顯示空狀態提示', async () => {
    const { EchoesIsland } = await setup();
    render(<EchoesIsland />);
    expect(screen.getByText(/還沒有回聲跟著你/)).toBeTruthy();
  });

  it('收合即暫停：unmount 時暫停播放', async () => {
    const { store, EchoesIsland } = await setup();
    store.play('s1', 'https://cdn/u1.mp3', '曲一', '#5B7FB3');
    await flush();
    expect(store.getState().isPlaying).toBe(true);

    const { unmount } = render(<EchoesIsland />);
    unmount();
    expect(store.getState().isPlaying).toBe(false);
  });

  it('展開續播：收合前播放中 → 重新 mount 自動續播', async () => {
    const { store, EchoesIsland } = await setup();
    store.play('s1', 'https://cdn/u1.mp3', '曲一');
    await flush();

    const first = render(<EchoesIsland />);
    first.unmount();
    expect(store.getState().isPlaying).toBe(false);

    render(<EchoesIsland />);
    await flush();
    expect(store.getState().isPlaying).toBe(true);
    expect(store.getState().currentSongId).toBe('s1');
  });

  it('收合前本來就暫停 → 展開不誤播', async () => {
    const { store, EchoesIsland } = await setup();
    store.play('s1', 'https://cdn/u1.mp3', '曲一');
    await flush();
    store.pause();

    const first = render(<EchoesIsland />);
    first.unmount();

    render(<EchoesIsland />);
    await flush();
    expect(store.getState().isPlaying).toBe(false);
  });

  it('佇列展開列出曲目；點列播放該曲並自佇列移除', async () => {
    const { store, EchoesIsland } = await setup();
    store.enqueue({ songId: 'q1', url: 'https://cdn/q1.mp3', title: '甲' });
    store.enqueue({ songId: 'q2', url: 'https://cdn/q2.mp3', title: '乙' });

    render(<EchoesIsland />);
    fireEvent.click(screen.getByText(/佇列 · queue/));
    expect(screen.getByText('甲')).toBeTruthy();

    fireEvent.click(screen.getByText('甲'));
    await flush();
    const s = store.getState();
    expect(s.currentSongId).toBe('q1');
    expect(s.isPlaying).toBe(true);
    expect(s.playlist.map((i) => i.songId)).toEqual(['q2']);
  });

  it('× 自佇列移除但不播放', async () => {
    const { store, EchoesIsland } = await setup();
    store.enqueue({ songId: 'q1', url: 'https://cdn/q1.mp3', title: '甲' });

    render(<EchoesIsland />);
    fireEvent.click(screen.getByText(/佇列 · queue/));
    fireEvent.click(screen.getByLabelText('自佇列移除甲'));

    const s = store.getState();
    expect(s.playlist).toEqual([]);
    expect(s.currentSongId).toBeNull();
    expect(screen.getByText(/佇列是空的/)).toBeTruthy();
  });

  it('黑球＝播放鍵：無當前曲時從佇列頭開播', async () => {
    const { store, EchoesIsland } = await setup();
    store.enqueue({
      songId: 'q1',
      url: 'https://cdn/q1.mp3',
      title: '甲',
      accent: '#B86060',
    });

    render(<EchoesIsland />);
    fireEvent.click(screen.getByLabelText('播放'));
    await flush();
    const s = store.getState();
    expect(s.currentSongId).toBe('q1');
    expect(s.currentAccent).toBe('#B86060');
    expect(s.playlist).toEqual([]);
  });
});
