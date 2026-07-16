export const UEP_ECHO_PREVIEW_EVENT = 'uep:echo-preview';

export type EchoPreviewSource = 'spot' | 'embed' | 'unlock';

export interface EchoPreviewTrack {
  source: EchoPreviewSource;
  songId: string;
  title: string;
  url: string;
  clusterId: string;
  duration?: number;
  spoilerLevel: 0 | 1 | 2 | 3;
  accent?: string;
}

export function dispatchEchoPreview(track: EchoPreviewTrack): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<EchoPreviewTrack>(UEP_ECHO_PREVIEW_EVENT, {
      detail: track,
    })
  );
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
