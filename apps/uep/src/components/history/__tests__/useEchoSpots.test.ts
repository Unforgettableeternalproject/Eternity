import { describe, expect, it } from 'vitest';
import { readEchoSpot, shouldDowngradeEchoSpot } from '../useEchoSpots';

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
