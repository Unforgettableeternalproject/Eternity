import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkerPassedInfo, ProgressState } from '../../../progress';
import { getEchoSpotWaiting } from '../../../islands/echoes/echoPreview';
import {
  readEchoSpot,
  refreshEchoSpot,
  shouldDowngradeEchoSpot,
  useEchoSpots,
} from '../useEchoSpots';

/** 建立 fetch stub：回傳 by-id 反查的成功 payload */
function stubSongFetch(song: Record<string, unknown> | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: song ? { found: true, song } : { found: false },
          }),
      })
    )
  );
}

/** 建立 fetch stub：模擬離線／網路失敗 */
function stubOfflineFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('offline')))
  );
}

/* ── hook 層 mock：audio/進度/島守門全替身，echoPreview 只換 dispatch ── */
const audioMock = vi.hoisted(() => ({
  interruptResult: true,
  collected: false,
  interrupt: vi.fn(() => Promise.resolve(audioMock.interruptResult)),
}));
const grantFlags = vi.hoisted(() => vi.fn());
const dispatchSpy = vi.hoisted(() => vi.fn());
const islandMock = vi.hoisted(() => ({
  mounted: true,
  open: true,
  listeners: new Set<
    (
      state: { windows: { echoes: { open: boolean } } },
      detail: { source: string }
    ) => void
  >(),
  emit(source = 'open') {
    for (const listener of this.listeners) {
      listener({ windows: { echoes: { open: this.open } } }, { source });
    }
  },
}));

vi.mock('../../../audio', () => ({
  // 帶 entityKey 的旗標格式——驗證授旗用「現行」entityKey（#2 回歸）
  deriveSongUnlockFlag: (songId: string, entityKey?: string | null) =>
    entityKey ? `entity:${entityKey}` : `song:${songId}`,
  getAudioStore: () => ({
    interrupt: audioMock.interrupt,
    getState: () => ({ interruptionSnapshot: null }),
  }),
  isSongCollected: () => audioMock.collected,
  resolveSpoilerLevel: () => 0,
}));
vi.mock('../../../islands/islandRuntime', () => ({
  shouldMountIsland: () => islandMock.mounted,
  getIslandRuntime: () => ({
    getWindow: () => ({ open: islandMock.open }),
    subscribe: (
      listener: typeof islandMock.listeners extends Set<infer T> ? T : never
    ) => {
      islandMock.listeners.add(listener);
      return () => islandMock.listeners.delete(listener);
    },
  }),
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

describe('refreshEchoSpot 快照刷新', () => {
  function snapshotSpot() {
    const element = document.createElement('div');
    element.dataset.spotId = 'spot-r';
    element.dataset.songId = 'echoes/characters/x/theme';
    element.dataset.songUrlKey = 'audio/old.mp3';
    element.dataset.songTitle = '舊曲名';
    element.dataset.spoilerLevel = '2';
    element.dataset.spoilerRevisions = JSON.stringify([
      { targetLevel: 1, gate: { requiresFlags: ['stale'] } },
    ]);
    return readEchoSpot(element)!;
  }

  it('反查成功 → 音檔/標題/spoiler 全以現行資料為準', async () => {
    stubSongFetch({
      audioFile: 'audio/new.mp3',
      title: '新曲名',
      spoilerLevel: 0,
    });
    const refreshed = await refreshEchoSpot('http://api', snapshotSpot());
    expect(refreshed.songUrlKey).toBe('audio/new.mp3');
    expect(refreshed.title).toBe('新曲名');
    expect(refreshed.spoilerLevel).toBe(0);
    // 過期的降級鏈快照不得殘留（現行資料無 revisions = 無降級鏈）
    expect(refreshed.spoilerRevisions).toEqual([]);
  });

  it('反查失敗（離線）→ 完整退回快照', async () => {
    stubOfflineFetch();
    const spot = snapshotSpot();
    expect(await refreshEchoSpot('http://api', spot)).toEqual(spot);
  });

  it('歌曲已不存在（found:false）→ 退回快照', async () => {
    stubSongFetch(null);
    const spot = snapshotSpot();
    expect(await refreshEchoSpot('http://api', spot)).toEqual(spot);
  });

  it('歌曲現行無音檔 → 退回快照（不刷新任何欄位）', async () => {
    stubSongFetch({ audioFile: null, title: '新曲名' });
    const spot = snapshotSpot();
    expect(await refreshEchoSpot('http://api', spot)).toEqual(spot);
  });
});

describe('useEchoSpots 提示卡發送時機', () => {
  beforeEach(() => {
    sessionStorage.clear();
    audioMock.interrupt.mockClear();
    audioMock.interruptResult = true;
    audioMock.collected = false;
    islandMock.mounted = true;
    islandMock.open = true;
    islandMock.listeners.clear();
    grantFlags.mockClear();
    dispatchSpy.mockClear();
    // 預設離線：反查退回快照，既有案例行為與反查前一致
    stubOfflineFetch();
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

  it('歌曲已換音檔 → 插播使用現行 URL 而非快照（換檔 bug 回歸）', async () => {
    stubSongFetch({
      audioFile: 'audio/x-v2.mp3',
      title: '主題曲（重錄版）',
      spoilerLevel: 0,
    });
    const { result, unmount } = renderSpots();
    await act(async () => {
      result.current(markerInfo(spotElement()));
    });
    expect(audioMock.interrupt).toHaveBeenCalledWith(
      'echoes/characters/x/theme',
      'http://localhost:8788/api/assets/audio/x-v2.mp3',
      '主題曲（重錄版）',
      expect.any(String)
    );
    unmount();
  });

  it('反查離線 → 插播退回快照 URL', async () => {
    const { result, unmount } = renderSpots();
    await act(async () => {
      result.current(markerInfo(spotElement()));
    });
    expect(audioMock.interrupt).toHaveBeenCalledWith(
      'echoes/characters/x/theme',
      'http://localhost:8788/api/assets/audio/x.mp3',
      '主題曲',
      expect.any(String)
    );
    unmount();
  });

  it('Echoes 島收合 → 不偷播、dock 進等待；展開後才插播一次', async () => {
    islandMock.open = false;
    const { result, unmount } = renderSpots();
    await act(async () => {
      result.current(markerInfo(spotElement()));
    });
    expect(audioMock.interrupt).not.toHaveBeenCalled();
    expect(getEchoSpotWaiting()).toBe(true);

    await act(async () => {
      islandMock.open = true;
      islandMock.emit('open');
    });
    expect(audioMock.interrupt).toHaveBeenCalledOnce();
    expect(getEchoSpotWaiting()).toBe(false);
    unmount();
  });

  it('Echoes 島收合後離開文章 → 丟棄等待事件，之後展開不插播', async () => {
    islandMock.open = false;
    const { result, rerender, unmount } = renderHook(
      ({ pageId }) =>
        useEchoSpots({
          pageId,
          progress: {} as ProgressState,
          apiBase: 'http://localhost:8788',
          resumeJumpRef: { current: false },
          scrollVelocityRef: { current: 0 },
        }),
      { initialProps: { pageId: 'history/p1' as string | null } }
    );
    await act(async () => {
      result.current(markerInfo(spotElement()));
    });
    expect(getEchoSpotWaiting()).toBe(true);

    rerender({ pageId: 'history/p2' });
    expect(getEchoSpotWaiting()).toBe(false);
    await act(async () => {
      islandMock.open = true;
      islandMock.emit('open');
    });
    expect(audioMock.interrupt).not.toHaveBeenCalled();
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

  it('【回歸 #2】Admin 改綁 entityKey → 授旗用反查後的現行值，不用快照', async () => {
    stubSongFetch({
      audioFile: 'audio/x.mp3',
      entityKey: 'current-key',
      spoilerLevel: 0,
    });
    const element = spotElement();
    (element as HTMLElement).dataset.entityKey = 'stale-key';
    const { result, unmount } = renderSpots();
    await act(async () => {
      result.current(markerInfo(element));
    });
    expect(grantFlags).toHaveBeenCalledWith(['entity:current-key']);
    unmount();
  });

  it('【回歸 #2】現行已解除 entityKey 綁定 → 授旗退回 songId 旗標', async () => {
    stubSongFetch({
      audioFile: 'audio/x.mp3',
      entityKey: null,
      spoilerLevel: 0,
    });
    const element = spotElement();
    (element as HTMLElement).dataset.entityKey = 'stale-key';
    const { result, unmount } = renderSpots();
    await act(async () => {
      result.current(markerInfo(element));
    });
    expect(grantFlags).toHaveBeenCalledWith(['song:echoes/characters/x/theme']);
    unmount();
  });

  it('【回歸 #3】島不可掛載（登出/停用）→ 授旗仍發生，但不插播不發卡', async () => {
    islandMock.mounted = false;
    const { result, unmount } = renderSpots();
    await act(async () => {
      result.current(markerInfo(spotElement()));
    });
    expect(grantFlags).toHaveBeenCalledWith(['song:echoes/characters/x/theme']);
    expect(audioMock.interrupt).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    unmount();
  });
});
