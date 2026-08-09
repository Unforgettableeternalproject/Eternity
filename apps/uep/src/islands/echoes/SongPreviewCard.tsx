import { useEffect, type CSSProperties } from 'react';
import { getAudioStore } from '../../audio';
import { echoClusterStyle, type EchoPreviewTrack } from './echoPreview';
import previewCss from './SongPreviewCard.css?inline';
import { useDeferredStyle } from '../useDeferredStyle';

interface SongPreviewCardProps {
  track: EchoPreviewTrack;
  onDismiss: () => void;
}

function maskedTitle(title: string, level: number): string {
  if (level < 2) return title;
  return [...title].map((char) => (/\s/.test(char) ? char : '█')).join('');
}

function fmtDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '--:--';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export default function SongPreviewCard({
  track,
  onDismiss,
}: SongPreviewCardProps) {
  useDeferredStyle('song-preview-card', previewCss);
  const style = echoClusterStyle(track.clusterId);
  const color = track.accent || style.color;

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 8000);
    return () => window.clearTimeout(timer);
  }, [onDismiss, track.songId]);

  return (
    <aside
      className="uep-echo-preview"
      style={{ '--echo': color } as CSSProperties}
    >
      <header className="uep-echo-preview__header">
        <span className="uep-echo-preview__dot" />
        {track.source === 'unlock'
          ? '已收錄一枚回聲 · unlocked'
          : track.source === 'played'
            ? track.justCollected
              ? '已收錄一枚回聲 · 插播中'
              : '回聲插播中 · echo spot'
            : track.source === 'spot'
              ? track.justCollected
                ? '已收錄一枚回聲 · 等待播放'
                : '回聲等待播放 · echo spot'
              : '相關回聲 · related echo'}
        <button type="button" aria-label="關閉曲目卡" onClick={onDismiss}>
          ×
        </button>
      </header>
      <div className="uep-echo-preview__track">
        <span className="uep-echo-preview__orb" aria-hidden />
        <div>
          <strong>{maskedTitle(track.title, track.spoilerLevel)}</strong>
          <small>
            {style.label} · {fmtDuration(track.duration)}
            {track.spoilerLevel > 0 ? ` · L${track.spoilerLevel}` : ''}
          </small>
        </div>
      </div>
      {/* 插播已在響（played）純告知；等待播放（spot）與
          非 Echo Spot 解鎖（unlock）才需要動作入口。 */}
      {track.source !== 'played' && (
        <div className="uep-echo-preview__actions">
          <button
            type="button"
            className="is-primary"
            disabled={track.spoilerLevel >= 3}
            onClick={() => {
              void getAudioStore().play(
                track.songId,
                track.url,
                track.title,
                color
              );
              onDismiss();
            }}
          >
            ▶ 播放
          </button>
          <button
            type="button"
            disabled={track.spoilerLevel !== 0}
            onClick={() => {
              getAudioStore().enqueue({
                songId: track.songId,
                url: track.url,
                title: track.title,
                accent: color,
              });
              onDismiss();
            }}
          >
            ＋ 加入佇列
          </button>
        </div>
      )}
    </aside>
  );
}
