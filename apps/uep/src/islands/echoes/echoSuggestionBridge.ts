import type { EchoPreviewTrack } from './echoPreview';

export const UEP_ECHO_SUGGESTION_EVENT = 'uep:echo-suggestion';

interface EchoSuggestionEligibility {
  songType?: string;
  unlocked: boolean;
  spoilerLevel: number;
  audioFile?: string;
}

/** 互動式嵌入只提示已解鎖、L0 且可播放的非劇情歌。 */
export function isEchoSuggestionEligible({
  songType,
  unlocked,
  spoilerLevel,
  audioFile,
}: EchoSuggestionEligibility): boolean {
  return songType !== 'story' && unlocked && spoilerLevel === 0 && !!audioFile;
}

declare global {
  interface Window {
    __uepEchoSuggestion?: EchoPreviewTrack | null;
  }
}

/**
 * Interactive embedding 的曲目提示橋。Host 可能在 EchoesIsland 尚未 mount
 * 時收到事件，因此 pending 值放 window，島展開後仍能消費。
 */
export function pushEchoSuggestion(track: EchoPreviewTrack): void {
  if (typeof window === 'undefined') return;
  window.__uepEchoSuggestion = track;
  window.dispatchEvent(
    new CustomEvent<EchoPreviewTrack>(UEP_ECHO_SUGGESTION_EVENT, {
      detail: track,
    })
  );
}

/**
 * 清除提示（detail null）：entity 反查查無對應曲、不合格或失敗時呼叫
 * ——否則上一張 RELATED ECHO 卡殘留，誤導使用者以為與新點擊的
 * entity 有關（對位 visuals 的 clearPhantomSuggestion）。
 */
export function clearEchoSuggestion(): void {
  if (typeof window === 'undefined') return;
  window.__uepEchoSuggestion = null;
  window.dispatchEvent(
    new CustomEvent<EchoPreviewTrack | null>(UEP_ECHO_SUGGESTION_EVENT, {
      detail: null,
    })
  );
}

export function consumeEchoSuggestion(): EchoPreviewTrack | null {
  if (typeof window === 'undefined') return null;
  const track = window.__uepEchoSuggestion || null;
  window.__uepEchoSuggestion = null;
  return track;
}
