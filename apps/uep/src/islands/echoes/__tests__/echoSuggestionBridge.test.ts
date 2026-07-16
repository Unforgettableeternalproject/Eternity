import { describe, expect, it } from 'vitest';

import { isEchoSuggestionEligible } from '../echoSuggestionBridge';

describe('isEchoSuggestionEligible', () => {
  const eligible = {
    songType: 'character',
    unlocked: true,
    spoilerLevel: 0,
    audioFile: 'audio/echoes/song.mp3',
  };

  it('只允許已解鎖且位於 L0 的非劇情歌曲', () => {
    expect(isEchoSuggestionEligible(eligible)).toBe(true);
  });

  it.each([
    [{ ...eligible, songType: 'story' }, '劇情歌'],
    [{ ...eligible, unlocked: false }, '未解鎖歌曲'],
    [{ ...eligible, spoilerLevel: 1 }, '仍受遮蔽歌曲'],
    [{ ...eligible, audioFile: '' }, '沒有音檔的歌曲'],
  ])('排除%s（%s）', (input) => {
    expect(isEchoSuggestionEligible(input)).toBe(false);
  });
});
