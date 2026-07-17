/**
 * Audio Store 單元測試（S8 A-2/A-3）
 *
 * store 是 module singleton，每個測試前用 vi.resetModules() 取得全新
 * 實例，並清空 localStorage 與 window bridge（同 progressStore 測試慣例）。
 * Audio 元素以 MockAudio 替身控制 play/pause/metadata；
 * rAF stub 掉（回傳 0 不觸發），進度更新走 seek 路徑驗證，避免計時 flake。
 * auth 整包 mock——登出流程用 authMock.emit(null) 模擬，不打真實 fetch。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { PROGRESS_CHANGE_EVENT, createInitialState } from '../../progress';
import type { ProgressChangeDetail } from '../../progress';
import { AUDIO_STORAGE_KEY, LEGACY_VOLUME_KEY } from '../audioTypes';
import type { AudioPersisted } from '../audioTypes';

/* ── auth mock（audioStore 的登出接線走這裡，不載入真實 readerAuth） ── */
const authMock = vi.hoisted(() => {
  let loggedIn = true;
  const listeners: Array<(session: { token: string } | null) => void> = [];
  return {
    reset() {
      loggedIn = true;
      listeners.length = 0;
    },
    emit(session: { token: string } | null) {
      loggedIn = session !== null;
      listeners.forEach((fn) => fn(session));
    },
    api: {
      isLoggedIn: () => loggedIn,
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

vi.mock('../../auth', () => ({
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

  emit(type: string): void {
    // 複製一份再迭代——handler 內可能自行 removeEventListener
    [...(this.handlers.get(type) ?? [])].forEach((fn) => fn());
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

/** 目前活躍的 audio 元素替身 */
function lastAudio(): MockAudio {
  const audio = MockAudio.instances.at(-1);
  if (!audio) throw new Error('尚未建立任何 Audio 實例');
  return audio;
}

/** microtask flush（等 play() promise 落定） */
const flush = () => new Promise((r) => setTimeout(r, 0));

async function freshStore() {
  vi.resetModules();
  return await import('../audioStore');
}

function readStorage(): AudioPersisted | null {
  const raw = window.localStorage.getItem(AUDIO_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as AudioPersisted) : null;
}

function dispatchProgressChange(detail: ProgressChangeDetail): void {
  window.dispatchEvent(
    new CustomEvent<ProgressChangeDetail>(PROGRESS_CHANGE_EVENT, { detail })
  );
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.__uepAudio;
  delete window.__uepProgress;
  MockAudio.instances = [];
  authMock.reset();
  vi.stubGlobal('Audio', MockAudio);
  // rAF 停掉：進度更新鏈不在單元測試驗（走 seek 路徑），避免計時 flake
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

describe('bootstrap', () => {
  it('無既有資料時建立初始狀態', async () => {
    const { uepAudio } = await freshStore();
    const s = uepAudio.getState();
    expect(s.currentSongId).toBeNull();
    expect(s.isPlaying).toBe(false);
    expect(s.volume).toBe(0.6);
    expect(s.loop).toBe('none');
    expect(s.playlist).toEqual([]);
    expect(s.interruptionSnapshot).toBeNull();
  });

  it('收編舊 uep-player-volume：讀值、刪 key、落地新格式', async () => {
    window.localStorage.setItem(LEGACY_VOLUME_KEY, '0.3');
    const { uepAudio } = await freshStore();
    expect(uepAudio.getState().volume).toBe(0.3);
    expect(window.localStorage.getItem(LEGACY_VOLUME_KEY)).toBeNull();
    expect(readStorage()?.volume).toBe(0.3);
  });

  it('從 uep.audio.v1 恢復為暫停態（wasPlaying 不觸發自動播放）', async () => {
    const persisted: AudioPersisted = {
      currentSongId: 's1',
      currentUrl: 'https://cdn/u1.mp3',
      currentTitle: '測試曲',
      currentAccent: '#5B7FB3',
      currentTime: 42,
      duration: 100,
      playlist: [{ songId: 's2', url: 'https://cdn/u2.mp3', title: '下一首' }],
      volume: 0.8,
      loop: 'all',
      wasPlaying: true,
    };
    window.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(persisted));
    const { uepAudio } = await freshStore();
    const s = uepAudio.getState();
    expect(s.currentSongId).toBe('s1');
    expect(s.currentTitle).toBe('測試曲');
    expect(s.isPlaying).toBe(false); // 一律暫停態
    expect(s.currentTime).toBe(42);
    expect(s.duration).toBe(100);
    expect(s.progress).toBeCloseTo(0.42);
    expect(s.playlist).toHaveLength(1);
    expect(s.volume).toBe(0.8);
    expect(s.loop).toBe('all');
    // 恢復期間不建立 Audio 元素（惰性）
    expect(MockAudio.instances).toHaveLength(0);
  });

  it('localStorage 資料毀損時回到初始狀態而不噴錯', async () => {
    window.localStorage.setItem(AUDIO_STORAGE_KEY, '{broken json!!');
    const { uepAudio } = await freshStore();
    expect(uepAudio.getState().currentSongId).toBeNull();
  });
});

describe('播放控制', () => {
  it('play：載入音源、播放、立即持久化', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('s1', 'https://cdn/u1.mp3', '曲一');
    await flush();
    const s = uepAudio.getState();
    expect(s.currentSongId).toBe('s1');
    expect(s.currentTitle).toBe('曲一');
    expect(s.isPlaying).toBe(true);
    expect(lastAudio().src).toBe('https://cdn/u1.mp3');
    expect(readStorage()?.currentSongId).toBe('s1');
    expect(readStorage()?.wasPlaying).toBe(true);
  });

  it('重載恢復後播放同曲：metadata 就緒時 seek 回存檔位置', async () => {
    const persisted: AudioPersisted = {
      currentSongId: 's1',
      currentUrl: 'https://cdn/u1.mp3',
      currentTitle: null,
      currentAccent: null,
      currentTime: 42,
      duration: 100,
      playlist: [],
      volume: 0.6,
      loop: 'none',
      wasPlaying: false,
    };
    window.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(persisted));
    const { uepAudio } = await freshStore();
    uepAudio.play('s1', 'https://cdn/u1.mp3');
    await flush();
    const audio = lastAudio();
    audio.duration = 100;
    audio.emit('loadedmetadata');
    expect(audio.currentTime).toBe(42);
    expect(uepAudio.getState().currentTime).toBe(42);
  });

  it('換到別的曲子時不套用存檔位置（從頭播）', async () => {
    const persisted: AudioPersisted = {
      currentSongId: 's1',
      currentUrl: 'https://cdn/u1.mp3',
      currentTitle: null,
      currentAccent: null,
      currentTime: 42,
      duration: 100,
      playlist: [],
      volume: 0.6,
      loop: 'none',
      wasPlaying: false,
    };
    window.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(persisted));
    const { uepAudio } = await freshStore();
    uepAudio.play('s9', 'https://cdn/u9.mp3');
    await flush();
    const audio = lastAudio();
    audio.duration = 80;
    audio.emit('loadedmetadata');
    expect(audio.currentTime).toBe(0);
    expect(uepAudio.getState().currentSongId).toBe('s9');
  });

  it('pause：停止播放並持久化 wasPlaying=false', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('s1', 'u1');
    await flush();
    uepAudio.pause();
    expect(uepAudio.getState().isPlaying).toBe(false);
    expect(lastAudio().pause).toHaveBeenCalled();
    expect(readStorage()?.wasPlaying).toBe(false);
  });

  it('toggle：同曲播放中 → 暫停；暫停中 → 續播；異曲 → 換曲', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.toggle('s1', 'u1');
    await flush();
    expect(uepAudio.getState().isPlaying).toBe(true);
    uepAudio.toggle('s1', 'u1');
    expect(uepAudio.getState().isPlaying).toBe(false);
    uepAudio.toggle('s2', 'u2');
    await flush();
    expect(uepAudio.getState().currentSongId).toBe('s2');
    expect(uepAudio.getState().isPlaying).toBe(true);
  });

  it('seek：依 duration 換算並更新狀態', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('s1', 'u1');
    await flush();
    const audio = lastAudio();
    audio.duration = 200;
    uepAudio.seek(0.5);
    expect(audio.currentTime).toBe(100);
    expect(uepAudio.getState().progress).toBe(0.5);
  });

  it('endSeek：duration 未就緒時等 loadedmetadata 重試', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('s1', 'u1');
    await flush();
    const audio = lastAudio();
    audio.duration = 0;
    uepAudio.endSeek(0.5);
    expect(audio.currentTime).toBe(0); // 尚未套用
    audio.duration = 100;
    audio.emit('loadedmetadata');
    expect(audio.currentTime).toBe(50);
    expect(uepAudio.getState().progress).toBe(0.5);
  });

  it('setVolume：clamp 邊界、同步元素、持久化', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('s1', 'u1');
    await flush();
    uepAudio.setVolume(1.5);
    expect(uepAudio.getState().volume).toBe(1);
    uepAudio.setVolume(-0.2);
    expect(uepAudio.getState().volume).toBe(0);
    expect(lastAudio().volume).toBe(0);
    expect(readStorage()?.volume).toBe(0);
  });

  it('setLoop：更新並持久化', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.setLoop('all');
    expect(uepAudio.getState().loop).toBe('all');
    expect(readStorage()?.loop).toBe('all');
  });
});

describe('佇列管理', () => {
  it('enqueue：加入佇列、同曲去重、持久化', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.enqueue({ songId: 'a', url: 'ua' });
    uepAudio.enqueue({ songId: 'a', url: 'ua' }); // 重複 → 忽略
    uepAudio.enqueue({ songId: 'b', url: 'ub' });
    expect(uepAudio.getState().playlist.map((i) => i.songId)).toEqual([
      'a',
      'b',
    ]);
    expect(readStorage()?.playlist).toHaveLength(2);
  });

  it('setPlaylist / clearPlaylist', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.setPlaylist([{ songId: 'x', url: 'ux' }]);
    expect(uepAudio.getState().playlist).toHaveLength(1);
    uepAudio.clearPlaylist();
    expect(uepAudio.getState().playlist).toEqual([]);
  });

  it('next：播放佇列頭；loop=all 時當前曲回到佇列尾', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua', '甲');
    await flush();
    uepAudio.setLoop('all');
    uepAudio.enqueue({ songId: 'b', url: 'ub' });
    uepAudio.next();
    await flush();
    const s = uepAudio.getState();
    expect(s.currentSongId).toBe('b');
    expect(s.playlist.map((i) => i.songId)).toEqual(['a']); // 甲回到佇列尾
  });

  it('next：loop=none 時當前曲不回收；佇列空時 no-op', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    uepAudio.enqueue({ songId: 'b', url: 'ub' });
    uepAudio.next();
    await flush();
    expect(uepAudio.getState().currentSongId).toBe('b');
    expect(uepAudio.getState().playlist).toEqual([]);
    uepAudio.next(); // 佇列已空
    expect(uepAudio.getState().currentSongId).toBe('b');
  });

  it('一般換曲會進歷史，previous 返回前曲並讓 next 可再次前進', async () => {
    const { uepAudio } = await freshStore();
    await uepAudio.play('a', 'ua', '甲');
    await uepAudio.play('b', 'ub', '乙');

    expect(uepAudio.getState().history.map((item) => item.songId)).toEqual([
      'a',
    ]);
    uepAudio.previous();
    await flush();
    expect(uepAudio.getState().currentSongId).toBe('a');
    expect(uepAudio.getState().playlist[0]?.songId).toBe('b');

    uepAudio.next();
    await flush();
    expect(uepAudio.getState().currentSongId).toBe('b');
  });
  it('previous：回到當前曲開頭', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    const audio = lastAudio();
    audio.duration = 100;
    uepAudio.seek(0.5);
    uepAudio.previous();
    expect(audio.currentTime).toBe(0);
    expect(uepAudio.getState().currentTime).toBe(0);
  });

  it('ended：佇列推進；空佇列時停止並標記播畢', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    uepAudio.enqueue({ songId: 'b', url: 'ub' });
    lastAudio().emit('ended');
    await flush();
    expect(uepAudio.getState().currentSongId).toBe('b');
    expect(uepAudio.getState().isPlaying).toBe(true);
    lastAudio().emit('ended'); // 佇列已空
    await flush();
    expect(uepAudio.getState().isPlaying).toBe(false);
    expect(uepAudio.getState().progress).toBe(1);
  });

  it('ended：loop=one 單曲循環重播', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    uepAudio.setLoop('one');
    const audio = lastAudio();
    audio.currentTime = 99;
    audio.emit('ended');
    await flush();
    expect(audio.currentTime).toBe(0);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(uepAudio.getState().isPlaying).toBe(true);
  });
});

describe('插播（echo spot）', () => {
  it('interrupt：記錄原曲快照並播放插播曲；佇列不動', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua', '甲');
    await flush();
    const audio = lastAudio();
    audio.duration = 200;
    uepAudio.seek(0.25); // currentTime 50
    uepAudio.enqueue({ songId: 'q', url: 'uq' });
    uepAudio.interrupt('spot', 'uspot', '插播曲');
    await flush();
    const s = uepAudio.getState();
    expect(s.currentSongId).toBe('spot');
    expect(s.interruptionSnapshot).toEqual({
      songId: 'a',
      url: 'ua',
      title: '甲',
      accent: null,
      currentTime: 50,
      wasPlaying: true,
    });
    expect(s.playlist.map((i) => i.songId)).toEqual(['q']); // 佇列保持原樣
  });

  it('Echo Spot 插播不進歷史；插播中手動選歌只記錄原本曲目', async () => {
    const { uepAudio } = await freshStore();
    await uepAudio.play('a', 'ua', '甲');
    await uepAudio.interrupt('spot', 'uspot', '插播');
    expect(uepAudio.getState().history).toEqual([]);

    await uepAudio.play('embed', 'uembed', '嵌入選歌');
    expect(uepAudio.getState().history.map((item) => item.songId)).toEqual([
      'a',
    ]);
    expect(uepAudio.getState().history).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ songId: 'spot' })])
    );
    expect(uepAudio.getState().interruptionSnapshot).toBeNull();
  });
  it('插播中按 next 且佇列為空時恢復原曲，不把插播加入歷史', async () => {
    const { uepAudio } = await freshStore();
    await uepAudio.play('a', 'ua');
    await uepAudio.interrupt('spot', 'uspot');
    uepAudio.next();
    await flush();

    expect(uepAudio.getState().currentSongId).toBe('a');
    expect(uepAudio.getState().history).toEqual([]);
    expect(uepAudio.getState().interruptionSnapshot).toBeNull();
  });
  it('插播中再 interrupt：只換曲、快照不重拍（恢復點仍是原曲）', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    uepAudio.interrupt('spot1', 'u1');
    await flush();
    uepAudio.interrupt('spot2', 'u2');
    await flush();
    const s = uepAudio.getState();
    expect(s.currentSongId).toBe('spot2');
    expect(s.interruptionSnapshot?.songId).toBe('a');
  });

  it('插播曲已是當前曲（暫停中）→ 仍從頭插播，restore 回原位置維持暫停', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua', '甲');
    await flush();
    const audio = lastAudio();
    audio.duration = 200;
    uepAudio.seek(0.25); // currentTime 50
    uepAudio.pause();
    uepAudio.interrupt('a', 'ua', '甲');
    await flush();
    expect(audio.currentTime).toBe(0);
    expect(uepAudio.getState().isPlaying).toBe(true);
    expect(uepAudio.getState().interruptionSnapshot).toEqual(
      expect.objectContaining({
        songId: 'a',
        currentTime: 50,
        wasPlaying: false,
      })
    );
    uepAudio.restoreFromInterruption();
    await flush();
    expect(audio.currentTime).toBe(50);
    expect(uepAudio.getState().isPlaying).toBe(false);
  });

  it('插播曲已是當前曲（播放中）→ 從頭重播，不從當前位置續播', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua', '甲');
    await flush();
    const audio = lastAudio();
    audio.duration = 200;
    uepAudio.seek(0.25); // currentTime 50
    uepAudio.interrupt('a', 'ua', '甲');
    await flush();
    expect(audio.currentTime).toBe(0);
    expect(uepAudio.getState().isPlaying).toBe(true);
    expect(uepAudio.getState().interruptionSnapshot).toEqual(
      expect.objectContaining({
        songId: 'a',
        currentTime: 50,
        wasPlaying: true,
      })
    );
  });

  it('restoreFromInterruption：wasPlaying=true → 回原曲原位置續播', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua', '甲');
    await flush();
    const audio = lastAudio();
    audio.duration = 200;
    uepAudio.seek(0.25); // currentTime 50
    uepAudio.interrupt('spot', 'uspot');
    await flush();
    uepAudio.restoreFromInterruption();
    await flush();
    expect(uepAudio.getState().currentSongId).toBe('a');
    expect(uepAudio.getState().interruptionSnapshot).toBeNull();
    // metadata 就緒後 seek 回原位置
    audio.duration = 200;
    audio.emit('loadedmetadata');
    expect(audio.currentTime).toBe(50);
    expect(uepAudio.getState().isPlaying).toBe(true);
  });

  it('restoreFromInterruption：wasPlaying=false → 回原曲但維持暫停', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    uepAudio.pause();
    uepAudio.interrupt('spot', 'uspot');
    await flush();
    uepAudio.restoreFromInterruption();
    await flush();
    expect(uepAudio.getState().currentSongId).toBe('a');
    expect(uepAudio.getState().isPlaying).toBe(false);
  });

  it('插播前無曲：restore 回到無曲目狀態', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.interrupt('spot', 'uspot');
    await flush();
    expect(uepAudio.getState().interruptionSnapshot?.songId).toBeNull();
    uepAudio.restoreFromInterruption();
    expect(uepAudio.getState().currentSongId).toBeNull();
    expect(uepAudio.getState().isPlaying).toBe(false);
  });

  it('插播曲播畢自動恢復快照', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    uepAudio.interrupt('spot', 'uspot');
    await flush();
    lastAudio().emit('ended');
    await flush();
    expect(uepAudio.getState().currentSongId).toBe('a');
    expect(uepAudio.getState().interruptionSnapshot).toBeNull();
  });

  it('clearInterruption：丟棄快照不恢復', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    uepAudio.interrupt('spot', 'uspot');
    await flush();
    uepAudio.clearInterruption();
    expect(uepAudio.getState().currentSongId).toBe('spot');
    expect(uepAudio.getState().interruptionSnapshot).toBeNull();
  });

  it('interruptionSnapshot 不進持久化（重載後插播自然結束）', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    uepAudio.interrupt('spot', 'uspot');
    await flush();
    const raw = readStorage();
    expect(raw).not.toBeNull();
    expect('interruptionSnapshot' in (raw as object)).toBe(false);
  });
});

describe('生命週期', () => {
  it('stop：清空狀態與持久化', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    uepAudio.enqueue({ songId: 'b', url: 'ub' });
    uepAudio.stop();
    const s = uepAudio.getState();
    expect(s.currentSongId).toBeNull();
    expect(s.isPlaying).toBe(false);
    expect(s.playlist).toEqual([]);
    expect(window.localStorage.getItem(AUDIO_STORAGE_KEY)).toBeNull();
  });

  it('進度 reset（PROGRESS_CHANGE_EVENT source=reset）→ stop', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    dispatchProgressChange({ state: createInitialState(), source: 'reset' });
    expect(uepAudio.getState().currentSongId).toBeNull();
    expect(window.localStorage.getItem(AUDIO_STORAGE_KEY)).toBeNull();
  });

  it('echoes 島被停用 → stop；其他島停用不觸發', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    dispatchProgressChange({
      state: { ...createInitialState(), islandsDisabled: ['history'] },
      source: 'island-setting',
    });
    expect(uepAudio.getState().currentSongId).toBe('a'); // 不受影響
    dispatchProgressChange({
      state: { ...createInitialState(), islandsDisabled: ['echoes'] },
      source: 'island-setting',
    });
    expect(uepAudio.getState().currentSongId).toBeNull();
  });

  it('登出（session → null）→ stop', async () => {
    const { uepAudio } = await freshStore(); // authMock 預設已登入
    uepAudio.play('a', 'ua');
    await flush();
    authMock.emit(null);
    expect(uepAudio.getState().currentSongId).toBeNull();
    expect(window.localStorage.getItem(AUDIO_STORAGE_KEY)).toBeNull();
  });

  it('pagehide 兜底持久化', async () => {
    const { uepAudio } = await freshStore();
    uepAudio.play('a', 'ua');
    await flush();
    const audio = lastAudio();
    audio.duration = 100;
    uepAudio.seek(0.77);
    window.localStorage.removeItem(AUDIO_STORAGE_KEY); // 模擬 throttle 尚未寫
    window.dispatchEvent(new Event('pagehide'));
    expect(readStorage()?.currentTime).toBe(77);
  });

  it('subscribe：狀態變更通知訂閱者；退訂後不再通知', async () => {
    const { uepAudio } = await freshStore();
    const spy = vi.fn();
    const unsub = uepAudio.subscribe(spy);
    uepAudio.setLoop('one');
    expect(spy).toHaveBeenCalled();
    const calls = spy.mock.calls.length;
    unsub();
    uepAudio.setLoop('all');
    expect(spy.mock.calls.length).toBe(calls);
  });
});
