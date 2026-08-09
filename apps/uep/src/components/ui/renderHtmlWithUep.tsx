/* eslint-disable no-undef */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import UepDialogue from './UepDialogue';
import audioPlayerCss from './InlineAudioPlayer.css?inline';
import { useDeferredStyle } from '../../islands/useDeferredStyle';
import { getApiBase } from '../../lib/apiBase';

const API_BASE = getApiBase();

const ASSET_ATTR_RE =
  /\b(src|data-src)=(["'])(https?:\/\/[^"']+\/api\/assets\/|\/api\/assets\/)([^"']+)\2/g;

function normalizeInlineAssetUrls(html: string): string {
  return html.replace(
    ASSET_ATTR_RE,
    (_match, attr, quote, _prefix, rawPath) => {
      const key = rawPath
        .split('/')
        .map((part: string) => {
          try {
            return encodeURIComponent(decodeURIComponent(part));
          } catch {
            return encodeURIComponent(part);
          }
        })
        .join('/');
      return `${attr}=${quote}${API_BASE}/api/assets/${key}${quote}`;
    }
  );
}

/* ────────────────────────────────────────────────────────
   InlineAudioPlayerSimple — 純 React 自管理的 plain 版播放器
   用於 Reader 側渲染 data-role="audio-player" 節點
   ──────────────────────────────────────────────────────── */
function InlineAudioPlayerSimple({
  src,
  label,
}: {
  src: string;
  label: string;
}) {
  useDeferredStyle('inline-audio-player', audioPlayerCss);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const isSeekingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekProg, setSeekProg] = useState<number | null>(null);

  useEffect(() => {
    const a = new Audio(src);
    a.preload = 'metadata';
    audioRef.current = a;

    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => {
      setIsPlaying(false);
      setProgress(1);
      cancelAnimationFrame(rafRef.current);
    };
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);

    return () => {
      cancelAnimationFrame(rafRef.current);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
      a.pause();
      a.src = '';
    };
  }, [src]);

  const updateProgress = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!isSeekingRef.current) {
      const dur = a.duration || 0;
      setCurrentTime(a.currentTime);
      setProgress(dur > 0 ? a.currentTime / dur : 0);
    }
    if (!a.paused) {
      rafRef.current = requestAnimationFrame(updateProgress);
    }
  }, []);

  const handlePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.pause();
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    } else {
      a.play()
        .then(() => {
          setIsPlaying(true);
          cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(updateProgress);
        })
        .catch(() => {});
    }
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const displayProg = seekProg ?? progress;

  return (
    <div className="inline-audio-player">
      <button className="iap-play-btn" onClick={handlePlay} type="button">
        <span className={isPlaying ? 'iap-icon-pause' : 'iap-icon-play'} />
      </button>
      <div className="iap-bar">
        <div className="iap-track">
          <div
            className="iap-fill"
            style={{ width: `${displayProg * 100}%` }}
          />
          <div
            className="iap-thumb"
            style={{ left: `${displayProg * 100}%` }}
          />
        </div>
        <input
          type="range"
          className="iap-seek"
          min={0}
          max={1}
          step={0.001}
          value={displayProg}
          onPointerDown={() => {
            isSeekingRef.current = true;
            setSeekProg(displayProg);
          }}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setSeekProg(val);
          }}
          onPointerUp={(e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            isSeekingRef.current = false;
            setSeekProg(null);
            const a = audioRef.current;
            if (a?.duration) {
              a.currentTime = val * a.duration;
              setProgress(val);
              setCurrentTime(val * a.duration);
            }
          }}
        />
        <div className="iap-times">
          <span>{fmtTime(currentTime)}</span>
          <span>{duration > 0 ? fmtTime(duration) : '--:--'}</span>
        </div>
      </div>
      {label && <span className="iap-label">{label}</span>}
    </div>
  );
}

/**
 * 將 HTML 字串渲染為 React 節點，遇到 [data-role="uep"] 時
 * 自動替換成完整的 UepDialogue 元件（大頭貼 + 氣泡框），
 * 遇到 [data-role="audio-player"] 時替換成 InlineAudioPlayerSimple，
 * 其餘部分仍用 dangerouslySetInnerHTML 輸出。
 */
export default function renderHtmlWithUep(
  html: string,
  keyPrefix: string | number = 0,
  proseClass = 'sto-prose'
): React.ReactNode[] {
  const normalizedHtml = normalizeInlineAssetUrls(html);

  if (
    !normalizedHtml ||
    (!normalizedHtml.includes('data-role="uep"') &&
      !normalizedHtml.includes('data-role="audio-player"'))
  ) {
    return [
      <div
        key={keyPrefix}
        className={proseClass}
        dangerouslySetInnerHTML={{ __html: normalizedHtml }}
      />,
    ];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(normalizedHtml, 'text/html');
  const nodes: React.ReactNode[] = [];
  let htmlBuf = '';
  let idx = 0;

  function flushBuf() {
    const trimmed = htmlBuf.trim();
    if (trimmed) {
      nodes.push(
        <div
          key={`${keyPrefix}-h${idx}`}
          className={proseClass}
          dangerouslySetInnerHTML={{ __html: trimmed }}
        />
      );
      idx++;
    }
    htmlBuf = '';
  }

  doc.body.childNodes.forEach((child) => {
    if (child.nodeType === 1) {
      const el = child as HTMLElement;
      const role = el.getAttribute('data-role');

      // UEP 對話節點
      if (role === 'uep') {
        flushBuf();
        const side =
          (el.getAttribute('data-side') as 'left' | 'right') || 'left';
        const text = el.textContent || '';
        nodes.push(
          <div
            key={`${keyPrefix}-u${idx}`}
            style={{
              margin: '14px 0',
              textAlign: side === 'right' ? 'right' : 'left',
            }}
          >
            <UepDialogue side={side} text={text} />
          </div>
        );
        idx++;
        return;
      }

      // 音訊播放器節點
      if (role === 'audio-player') {
        flushBuf();
        const audioSrc = el.getAttribute('data-src') || '';
        const audioLabel = el.getAttribute('data-label') || '';
        if (audioSrc) {
          nodes.push(
            <InlineAudioPlayerSimple
              key={`${keyPrefix}-a${idx}`}
              src={audioSrc}
              label={audioLabel}
            />
          );
          idx++;
        }
        return;
      }
    }
    // 非特殊節點：累積到 htmlBuf
    if (child.nodeType === 1) {
      htmlBuf += (child as HTMLElement).outerHTML;
    } else if (child.nodeType === 3 && child.textContent?.trim()) {
      htmlBuf += child.textContent;
    }
  });

  flushBuf();
  return nodes;
}
