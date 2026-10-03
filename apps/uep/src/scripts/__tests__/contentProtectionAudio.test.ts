/**
 * 保護遮罩與音訊的連動
 *
 * 只有失焦遮蔽（切視窗／分頁）會暫停正在播放的曲目，PrintScreen 的短遮罩不動播放；
 * 退場時只續播「出現前本來在播」的那首，本來就暫停的不得被自動播放，
 * 續播被 autoplay 政策拒絕時維持暫停。
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';

import type { uepAudio } from '../../audio';
import { createInitialAudioState } from '../../audio/audioTypes';
import type { AudioState } from '../../audio/audioTypes';
import {
  initContentProtection,
  FORCE_PROTECTION_KEY,
  suspendAudioForProtection,
  resumeAudioAfterProtection,
} from '../content-protection';

/** 假 bridge：只模擬本測試用到的 getState / pause / play */
function installFakeAudio(initial: Partial<AudioState>, playResult = true) {
  let state: AudioState = { ...createInitialAudioState(), ...initial };
  const fake = {
    getState: () => state,
    pause: vi.fn(() => {
      state = { ...state, isPlaying: false };
    }),
    play: vi.fn(() => {
      state = { ...state, isPlaying: playResult };
      return Promise.resolve(playResult);
    }),
  };
  window.__uepAudio = fake as unknown as typeof uepAudio;
  return {
    fake,
    get state() {
      return state;
    },
    set(next: Partial<AudioState>) {
      state = { ...state, ...next };
    },
  };
}

const playing: Partial<AudioState> = {
  isPlaying: true,
  currentSongId: 'song-a',
  currentUrl: 'https://example.test/a.mp3',
  currentTitle: '曲 A',
  currentAccent: '#fff',
  currentTime: 42,
};

describe('保護遮罩音訊連動', () => {
  afterEach(() => {
    // 清掉模組內殘留的暫停紀錄
    resumeAudioAfterProtection();
    delete window.__uepAudio;
  });

  it('播放中：遮罩出現時暫停，退場時以不記歷史的方式續播同一首', async () => {
    const h = installFakeAudio(playing);
    suspendAudioForProtection();
    expect(h.fake.pause).toHaveBeenCalledTimes(1);
    expect(h.state.isPlaying).toBe(false);

    resumeAudioAfterProtection();
    expect(h.fake.play).toHaveBeenCalledWith(
      'song-a',
      'https://example.test/a.mp3',
      '曲 A',
      '#fff',
      false
    );
    await Promise.resolve();
    expect(h.state.isPlaying).toBe(true);
  });

  it('本來就暫停：遮罩出現與退場都不動播放器', () => {
    const h = installFakeAudio({ ...playing, isPlaying: false });
    suspendAudioForProtection();
    resumeAudioAfterProtection();
    expect(h.fake.pause).not.toHaveBeenCalled();
    expect(h.fake.play).not.toHaveBeenCalled();
  });

  it('遮罩期間曲目被換掉或清除時不續播', () => {
    const h = installFakeAudio(playing);
    suspendAudioForProtection();
    h.set({ currentSongId: null, currentUrl: null });
    resumeAudioAfterProtection();
    expect(h.fake.play).not.toHaveBeenCalled();
  });

  it('續播只發生一次：重覆的退場事件不會再次播放', () => {
    const h = installFakeAudio(playing);
    suspendAudioForProtection();
    resumeAudioAfterProtection();
    h.set({ isPlaying: false });
    resumeAudioAfterProtection();
    expect(h.fake.play).toHaveBeenCalledTimes(1);
  });

  it('autoplay 被拒：靜默失敗並維持暫停狀態', async () => {
    const h = installFakeAudio(playing, false);
    suspendAudioForProtection();
    expect(() => resumeAudioAfterProtection()).not.toThrow();
    await Promise.resolve();
    expect(h.state.isPlaying).toBe(false);
  });

  it('沒有音訊 bridge 時不出錯', () => {
    expect(() => {
      suspendAudioForProtection();
      resumeAudioAfterProtection();
    }).not.toThrow();
  });
});

describe('遮罩觸發路徑與音訊', () => {
  const overlayVisible = () =>
    document
      .getElementById('uep-protection-overlay')
      ?.getAttribute('data-visible') === 'true';
  const blur = () => window.dispatchEvent(new Event('blur'));
  const focus = () => window.dispatchEvent(new Event('focus'));
  const printScreen = () =>
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'PrintScreen' }));

  beforeAll(() => {
    // 監聽器掛在 window／document 上，整組只初始化一次
    localStorage.setItem(FORCE_PROTECTION_KEY, 'true');
    document.body.dataset.readerPage = 'true';
    initContentProtection();
  });

  afterAll(() => {
    localStorage.removeItem(FORCE_PROTECTION_KEY);
    delete document.body.dataset.readerPage;
    document.getElementById('uep-content-protection')?.remove();
    document.getElementById('uep-protection-overlay')?.remove();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // 收掉遮罩與殘留的暫停紀錄
    focus();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    delete window.__uepAudio;
  });

  it('PrintScreen 短遮罩：出現與自動退場都不動播放器', () => {
    const h = installFakeAudio(playing);
    printScreen();
    expect(overlayVisible()).toBe(true);
    expect(h.fake.pause).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    expect(overlayVisible()).toBe(false);
    expect(h.fake.play).not.toHaveBeenCalled();
    expect(h.state.isPlaying).toBe(true);
  });

  it('DevTools test() 走短遮罩路徑，同樣不暫停', () => {
    const h = installFakeAudio(playing);
    (
      window as unknown as { __uepProtection: { test(v?: string): void } }
    ).__uepProtection.test('text');
    expect(overlayVisible()).toBe(true);
    expect(h.fake.pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(h.fake.play).not.toHaveBeenCalled();
  });

  it('失焦遮蔽：失焦時暫停，回焦時續播', () => {
    const h = installFakeAudio(playing);
    blur();
    expect(overlayVisible()).toBe(true);
    expect(h.fake.pause).toHaveBeenCalledTimes(1);

    focus();
    expect(overlayVisible()).toBe(false);
    expect(h.fake.play).toHaveBeenCalledTimes(1);
    expect(h.fake.play).toHaveBeenCalledWith(
      'song-a',
      'https://example.test/a.mp3',
      '曲 A',
      '#fff',
      false
    );
  });

  it('失焦遮蔽：blur 與 visibilitychange 接連抵達只暫停一次、仍會續播', () => {
    const h = installFakeAudio(playing);
    blur();
    blur();
    expect(h.fake.pause).toHaveBeenCalledTimes(1);
    focus();
    expect(h.fake.play).toHaveBeenCalledTimes(1);
  });

  it('短遮罩在場時失焦：升級成失焦遮蔽並暫停，計時到了也不退場', () => {
    const h = installFakeAudio(playing);
    printScreen();
    expect(h.fake.pause).not.toHaveBeenCalled();

    blur();
    expect(h.fake.pause).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1500);
    expect(overlayVisible()).toBe(true);
    expect(h.fake.play).not.toHaveBeenCalled();

    focus();
    expect(h.fake.play).toHaveBeenCalledTimes(1);
  });

  it('失焦遮蔽期間按 PrintScreen：不提前退場，回焦時照常續播', () => {
    const h = installFakeAudio(playing);
    blur();
    expect(h.fake.pause).toHaveBeenCalledTimes(1);

    printScreen();
    vi.advanceTimersByTime(1500);
    expect(overlayVisible()).toBe(true);
    expect(h.fake.play).not.toHaveBeenCalled();

    focus();
    expect(h.fake.play).toHaveBeenCalledTimes(1);
    expect(h.state.isPlaying).toBe(true);
  });

  it('失焦前本來就暫停：回焦不自動播放', () => {
    const h = installFakeAudio({ ...playing, isPlaying: false });
    blur();
    focus();
    expect(h.fake.pause).not.toHaveBeenCalled();
    expect(h.fake.play).not.toHaveBeenCalled();
  });
});
