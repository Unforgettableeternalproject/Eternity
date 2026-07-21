export const UEP_ECHO_PREVIEW_EVENT = 'uep:echo-preview';
export const UEP_ECHO_SPOT_WAITING_EVENT = 'uep:echo-spot-waiting';

declare global {
  interface Window {
    __uepEchoSpotWaiting?: boolean;
  }
}

/**
 * spot：插播未成（autoplay 被擋/降級），卡片提供手動播放入口。
 * played：插播已在響，卡片純告知、不帶動作按鈕。
 * unlock：Echo Spot 以外的解鎖來源（旗標達成等），提供播放/佇列入口。
 * embed：entity 嵌入的相關回聲（不進右下角卡，由回聲島承接）。
 */
export type EchoPreviewSource = 'spot' | 'embed' | 'unlock' | 'played';

export interface EchoPreviewTrack {
  source: EchoPreviewSource;
  songId: string;
  title: string;
  url: string;
  clusterId: string;
  duration?: number;
  spoilerLevel: 0 | 1 | 2 | 3;
  accent?: string;
  /** 本次觸發是否同時完成收藏（spot/played 卡的標頭據此改寫） */
  justCollected?: boolean;
}

export function dispatchEchoPreview(track: EchoPreviewTrack): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<EchoPreviewTrack>(UEP_ECHO_PREVIEW_EVENT, {
      detail: track,
    })
  );
}

/** Echo Spot 在島收合時等待使用者展開；只保存提示狀態，播放資料由 hook 擁有。 */
export function setEchoSpotWaiting(waiting: boolean): void {
  if (typeof window === 'undefined') return;
  if (window.__uepEchoSpotWaiting === waiting) return;
  window.__uepEchoSpotWaiting = waiting;
  window.dispatchEvent(
    new CustomEvent<boolean>(UEP_ECHO_SPOT_WAITING_EVENT, { detail: waiting })
  );
}

export function getEchoSpotWaiting(): boolean {
  if (typeof window === 'undefined') return false;
  return window.__uepEchoSpotWaiting === true;
}

export const ECHO_CLUSTER_STYLE: Record<
  string,
  { color: string; label: string }
> = {
  areas: { color: '#5B7FB3', label: '地點的回憶' },
  area: { color: '#5B7FB3', label: '地點的回憶' },
  characters: { color: '#B86060', label: '角色的回憶' },
  character: { color: '#B86060', label: '角色的回憶' },
  stories: { color: '#5B9C7A', label: '劇情的回憶' },
  story: { color: '#5B9C7A', label: '劇情的回憶' },
  special: { color: '#8E6CB6', label: '特別的回憶' },
};

export function echoClusterStyle(clusterId: string) {
  return ECHO_CLUSTER_STYLE[clusterId] || ECHO_CLUSTER_STYLE.special;
}

export function buildEchoAudioUrl(apiBase: string, key: string): string {
  if (/^https?:\/\//i.test(key)) return key;
  const clean = key.startsWith('/api/assets/')
    ? key.slice('/api/assets/'.length)
    : key;
  return `${apiBase}/api/assets/${clean
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}
