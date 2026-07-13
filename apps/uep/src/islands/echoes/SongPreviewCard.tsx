import { useEffect, type CSSProperties } from 'react';
import { getAudioStore } from '../../audio';
import { echoClusterStyle, type EchoPreviewTrack } from './echoPreview';
import './SongPreviewCard.css';

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
        {track.source === 'spot'
          ? '發現一枚回聲 · echo spot'
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
    </aside>
  );
}
