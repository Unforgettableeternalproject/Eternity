import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkerPassedInfo, ProgressState } from '../../../progress';
import {
  readEchoSpot,
  shouldDowngradeEchoSpot,
  useEchoSpots,
} from '../useEchoSpots';

/* ── hook 層 mock：audio/進度/島守門全替身，echoPreview 只換 dispatch ── */
const audioMock = vi.hoisted(() => ({
  interruptResult: true,
  collected: false,
  interrupt: vi.fn(() => Promise.resolve(audioMock.interruptResult)),
}));
const grantFlags = vi.hoisted(() => vi.fn());
const dispatchSpy = vi.hoisted(() => vi.fn());

vi.mock('../../../audio', () => ({
  deriveSongUnlockFlag: (songId: string) => `song:${songId}`,
  getAudioStore: () => ({
    interrupt: audioMock.interrupt,
    getState: () => ({ interruptionSnapshot: null }),
  }),
  isSongCollected: () => audioMock.collected,
  resolveSpoilerLevel: () => 0,
}));
vi.mock('../../../islands/islandRuntime', () => ({
  shouldMountIsland: () => true,
}));
vi.mock('../../../progress', () => ({
  getProgressManager: () => ({ grantFlags }),
}));
vi.mock('../../../islands/echoes/echoPreview', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../islands/echoes/echoPreview')
  >()),
  dispatchEchoPreview: dispatchSpy,
}));

describe('readEchoSpot', () => {
  it('解析完整、安全的 echo spot snapshot', () => {
    const element = document.createElement('div');
    element.dataset.role = 'echo-spot';
    element.dataset.spotId = 'spot-1';
    element.dataset.songId = 'echoes/stories/arc/song';
    element.dataset.songUrlKey = 'audio/story.mp3';
    element.dataset.entityKey = 'story-echo';
    element.dataset.songTitle = '最後的誓約';
    element.dataset.clusterId = 'stories';
    element.dataset.songType = 'story';
    element.dataset.duration = '245';
    element.dataset.spoilerLevel = '3';
    element.dataset.spoilerRevisions = JSON.stringify([
      { targetLevel: 2, gate: { requiresFlags: ['story:met'] } },
    ]);

    expect(readEchoSpot(element)).toEqual(
      expect.objectContaining({
        spotId: 'spot-1',
        songId: 'echoes/stories/arc/song',
        songUrlKey: 'audio/story.mp3',
        entityKey: 'story-echo',
        duration: 245,
        spoilerLevel: 3,
        songType: 'story',
      })
    );
  });

  it('缺少穩定 spotId、songId 或音檔 key 時拒絕觸發', () => {
    const element = document.createElement('div');
    element.dataset.songId = 'echoes/a';
    expect(readEchoSpot(element)).toBeNull();
  });

  it('壞掉的 revisions JSON 退回靜態等級，不拋例外', () => {
    const element = document.createElement('div');
    element.dataset.spotId = 'spot-2';
    element.dataset.songId = 'echoes/a';
    element.dataset.songUrlKey = 'audio/a.mp3';
    element.dataset.spoilerLevel = '2';
    element.dataset.spoilerRevisions = '{bad';
    expect(readEchoSpot(element)?.spoilerRevisions).toEqual([]);
    expect(readEchoSpot(element)?.spoilerLevel).toBe(2);
  });
});

describe('shouldDowngradeEchoSpot', () => {
  it('劇情歌在正常捲動時即使無手勢或已有嘗試也直接走插播', () => {
    expect(
      shouldDowngradeEchoSpot({
        isStory: true,
        spoilerLevel: 3,
        interacted: false,
        autoplayAttempted: true,
        resumeJump: false,
        scrollVelocity: 200,
      })
    ).toBe(false);
  });

  it('一般歌曲正常掃描不再因無手勢或既有 autoplay 嘗試預先降級', () => {
    expect(
      shouldDowngradeEchoSpot({
        isStory: false,
        spoilerLevel: 0,
        interacted: false,
        autoplayAttempted: true,
        resumeJump: false,
        scrollVelocity: 200,
      })
    ).toBe(false);
  });
  it('劇情歌遇到 resume jump 或快速捲動仍視為 misfire', () => {
    const base = {
      isStory: true,
      spoilerLevel: 0 as const,
      interacted: true,
      autoplayAttempted: false,
    };
    expect(
      shouldDowngradeEchoSpot({
        ...base,
        resumeJump: true,
        scrollVelocity: 0,
      })
    ).toBe(true);
    expect(
      shouldDowngradeEchoSpot({
        ...base,
        resumeJump: false,
        scrollVelocity: 2000,
      })
    ).toBe(true);
  });
});

describe('useEchoSpots 提示卡發送時機', () => {
  beforeEach(() => {
    sessionStorage.clear();
    audioMock.interrupt.mockClear();
    audioMock.interruptResult = true;
    audioMock.collected = false;
    grantFlags.mockClear();
    dispatchSpy.mockClear();
  });

  function spotElement(): Element {
    const element = document.createElement('div');
    element.dataset.spotId = 'spot-hook';
    element.dataset.songId = 'echoes/characters/x/theme';
    element.dataset.songUrlKey = 'audio/x.mp3';
    element.dataset.songTitle = '主題曲';
    element.dataset.clusterId = 'characters';
    return element;
  }

  function markerInfo(element: Element): MarkerPassedInfo {
    return {
      index: 0,
      grantsFlags: [],
      isSentinel: false,
      totalMarkers: 1,
      element,
      role: 'echo-spot',
    };
  }

  function renderSpots(resumeJump = false) {
    return renderHook(() =>
      useEchoSpots({
        pageId: 'history/p1',
        progress: {} as ProgressState,
        apiBase: 'http://localhost:8788',
        resumeJumpRef: { current: resumeJump },
        scrollVelocityRef: { current: 0 },
      })
    );
  }

  it('插播成功只發一張 played 卡（純告知），並帶本次新收藏資訊', async () => {
    const { result, unmount } = renderSpots();
    await act(async () => {
      result.current(markerInfo(spotElement()));
    });
    expect(audioMock.interrupt).toHaveBeenCalledOnce();
    expect(grantFlags).toHaveBeenCalledWith(['song:echoes/characters/x/theme']);
    expect(dispatchSpy).toHaveBeenCalledOnce();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'played', justCollected: true })
    );
    unmount();
  });

  it('已收藏曲目插播成功 → played 卡 justCollected=false', async () => {
    audioMock.collected = true;
    const { result, unmount } = renderSpots();
    await act(async () => {
      result.current(markerInfo(spotElement()));
    });
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'played', justCollected: false })
    );
    unmount();
  });

  it('autoplay 被擋（interrupt 失敗）→ 發 spot 卡提供手動入口', async () => {
    audioMock.interruptResult = false;
    const { result, unmount } = renderSpots();
    await act(async () => {
      result.current(markerInfo(spotElement()));
    });
    expect(dispatchSpy).toHaveBeenCalledOnce();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'spot', justCollected: true })
    );
    unmount();
  });

  it('resume jump 誤觸 → 不嘗試插播，直接發 spot 卡', async () => {
    const { result, unmount } = renderSpots(true);
    await act(async () => {
      result.current(markerInfo(spotElement()));
    });
    expect(audioMock.interrupt).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'spot' })
    );
    unmount();
  });
});
