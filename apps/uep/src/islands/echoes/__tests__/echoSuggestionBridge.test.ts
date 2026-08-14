import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EchoPreviewTrack } from '../echoPreview';
import {
  clearEchoSuggestion,
  consumeEchoSuggestion,
  isEchoSuggestionEligible,
  pushEchoSuggestion,
  UEP_ECHO_SUGGESTION_EVENT,
} from '../echoSuggestionBridge';

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

describe('clearEchoSuggestion（回歸 #5：反查失敗清舊卡）', () => {
  const track: EchoPreviewTrack = {
    source: 'embed',
    songId: 'echoes/characters/x/theme',
    title: '主題曲',
    url: 'http://api/audio.mp3',
    clusterId: 'characters',
    spoilerLevel: 0,
  };

  beforeEach(() => {
    window.__uepEchoSuggestion = null;
  });

  it('清掉 window pending 並廣播 detail null', () => {
    pushEchoSuggestion(track);
    expect(window.__uepEchoSuggestion).toEqual(track);

    const listener = vi.fn();
    window.addEventListener(UEP_ECHO_SUGGESTION_EVENT, listener);
    clearEchoSuggestion();
    window.removeEventListener(UEP_ECHO_SUGGESTION_EVENT, listener);

    expect(window.__uepEchoSuggestion).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    expect(
      (listener.mock.calls[0][0] as CustomEvent<EchoPreviewTrack | null>).detail
    ).toBeNull();
    expect(consumeEchoSuggestion()).toBeNull();
  });
});
