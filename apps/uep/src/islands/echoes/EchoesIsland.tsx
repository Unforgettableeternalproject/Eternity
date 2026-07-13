/**
 * EchoesIsland — 流浪回聲（S8 B-3）
 *
 * 跨頁面跟著走的基本播放器。視覺依 Eternity-Design/components/
 * echoes-island.jsx 定案稿（2026-07-11 格局改版）：
 * - 黑色回聲球＝播放鍵（分類色成為光暈、外環與漣漪）
 * - 佇列曲目以小回聲球繞黑球公轉（佇列收合時仍是佇列的軌道形態）
 * - 橫排舞台（黑球 96px 靠左、曲目資訊靠左排右側）
 * - 佇列預設收合、toggle 展開（列表 maxHeight 176）
 *
 * 視窗外殼（拖曳/收合/手機 bottom sheet）由 DraggableIsland 提供，
 * 這裡只有 body。
 *
 * 收合即暫停（2026-07-11 二輪定案）：DraggableIsland 收合 → body
 * unmount → cleanup 暫停；展開（點擊＝使用者手勢）若收合前播放中則
 * 自動續播。旗標放 module-level（React ref 會隨 unmount 消失）。
 */
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { getAudioStore } from '../../audio';
import type { AudioQueueItem, AudioState } from '../../audio';

import './EchoesIsland.css';

/** Echoes zone 預設 accent（無分類色資訊時的 fallback） */
const DEFAULT_ACCENT = '#355C7D';

/**
 * 回聲球體底色：待機淡灰，播放中被分類色「染色」
 * （艾斯維爾 2026-07-11：不要黑色——播放不同 cluster 時球染該色）。
 */
function ballBg(accent: string, playing: boolean): string {
  return playing
    ? `radial-gradient(circle at 34% 30%, color-mix(in srgb, ${accent} 45%, #fff) 0%, ${accent} 60%, color-mix(in srgb, ${accent} 65%, #000) 100%)`
    : 'radial-gradient(circle at 34% 30%, #f7f4ec 0%, #ddd7cb 55%, #bfb8a9 100%)';
}

/**
 * 收合前是否正在播放——收合＝unmount，React ref 活不過去，
 * 放 module-level（同 bundle 內跨 mount 存活即可）。
 */
let wasPlayingBeforeCollapse = false;

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/* ────────────────────────────────────────────────────────────────
 * 中央黑色回聲：漣漪 + 公轉佇列衛星 + 黑球（＝播放/暫停鍵）
 * ──────────────────────────────────────────────────────────────── */
function EchoOrb({
  accent,
  playing,
  interruption,
  satellites,
  disabled,
  onToggle,
}: {
  accent: string;
  playing: boolean;
  interruption: boolean;
  satellites: AudioQueueItem[];
  disabled: boolean;
  onToggle: () => void;
}) {
  const size = 96;
  const ball = 44;
  const sats = satellites.slice(0, 5);
  return (
    <div className="uep-eisland__orb" style={{ width: size, height: size }}>
      {/* 軌道 hairline */}
      <span className="uep-eisland__orbit-ring" aria-hidden />
      {/* 漣漪（播放中；插播時加速） */}
      {playing &&
        [0, 1, 2].map((i) => (
          <span
            key={i}
            className={`uep-eisland__ripple${interruption ? ' is-interrupt' : ''}`}
            aria-hidden
            style={{
              width: ball,
              height: ball,
              borderColor: accent,
              animationDelay: `${i * (interruption ? 0.55 : 0.9)}s`,
            }}
          />
        ))}
      {/* 公轉佇列衛星（插播時軌道清空） */}
      <div
        className="uep-eisland__orbit"
        aria-hidden
        style={{ animationPlayState: playing ? 'running' : 'paused' }}
      >
        {!interruption &&
          sats.map((t, i) => {
            const ang =
              (i / Math.max(sats.length, 1)) * Math.PI * 2 - Math.PI / 2;
            const r = (size - 16) / 2;
            return (
              <span
                key={t.songId}
                className="uep-eisland__sat"
                style={{
                  left: size / 2 + Math.cos(ang) * r - 4,
                  top: size / 2 + Math.sin(ang) * r - 4,
                  background: t.accent || DEFAULT_ACCENT,
                }}
              />
            );
          })}
      </div>
      {/* 黑色回聲＝播放鍵 */}
      <button
        type="button"
        className={`uep-eisland__ball${playing ? ' is-playing' : ''}`}
        onClick={onToggle}
        disabled={disabled}
        title={playing ? '暫停' : '播放'}
        aria-label={playing ? '暫停' : '播放'}
        style={{
          width: ball,
          height: ball,
          background: ballBg(accent, playing),
          boxShadow: `0 0 0 3px var(--bg-card), 0 0 0 4px ${accent}, 0 6px 18px rgba(20, 12, 4, 0.28)${
            playing ? `, 0 0 22px ${accent}55` : ''
          }`,
        }}
      >
        <span className="uep-eisland__ball-glyph" aria-hidden>
          {playing ? '❚❚' : '▶'}
        </span>
      </button>
      {/* 高光斑 */}
      <span
        className="uep-eisland__fleck"
        aria-hidden
        style={{
          transform: `translate(${-ball / 2 + 11}px, ${-ball / 2 + 9}px)`,
        }}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * EchoesIsland 本體
 * ──────────────────────────────────────────────────────────────── */
export default function EchoesIsland() {
  const store = getAudioStore();
  const state: AudioState = useSyncExternalStore(
    useCallback((onChange) => store.subscribe(onChange), [store]),
    () => store.getState(),
    () => store.getState()
  );

  const [queueOpen, setQueueOpen] = useState(false);

  /* 收合即暫停 / 展開續播（島展開本身即使用者手勢，autoplay 安全） */
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const s = store.getState();
    if (wasPlayingBeforeCollapse) {
      wasPlayingBeforeCollapse = false;
      if (s.currentSongId && s.currentUrl && !s.isPlaying) {
        store.play(
          s.currentSongId,
          s.currentUrl,
          s.currentTitle ?? undefined,
          s.currentAccent ?? undefined
        );
      }
    }
    return () => {
      // 收合（unmount）：記下播放狀態並暫停。登出/停用時 stop() 已把
      // isPlaying 清成 false，旗標自然不會誤續播。
      wasPlayingBeforeCollapse = stateRef.current.isPlaying;
      store.pause();
    };
  }, [store]);

  const accent = state.currentAccent || DEFAULT_ACCENT;
  const hasSong = state.currentSongId !== null;
  const interrupting = state.interruptionSnapshot !== null;

  /* ── 播放操作 ── */
  function toggleOrb() {
    if (state.isPlaying) {
      store.pause();
      return;
    }
    if (state.currentSongId && state.currentUrl) {
      store.play(
        state.currentSongId,
        state.currentUrl,
        state.currentTitle ?? undefined,
        state.currentAccent ?? undefined
      );
    } else {
      store.next(); // 無當前曲：從佇列頭開播
    }
  }

  /** 點佇列列：播放該曲並自佇列移除（loop=all 時當前曲回佇列尾，同 next 語意） */
  function playFromQueue(index: number) {
    const item = state.playlist[index];
    if (!item) return;
    let playlist = state.playlist.filter((_, i) => i !== index);
    if (state.loop === 'all' && state.currentSongId && state.currentUrl) {
      playlist = [
        ...playlist,
        {
          songId: state.currentSongId,
          url: state.currentUrl,
          ...(state.currentTitle ? { title: state.currentTitle } : {}),
          ...(state.currentAccent ? { accent: state.currentAccent } : {}),
        },
      ];
    }
    store.setPlaylist(playlist);
    store.play(item.songId, item.url, item.title, item.accent);
  }

  function removeFromQueue(index: number) {
    store.setPlaylist(state.playlist.filter((_, i) => i !== index));
  }

  function cycleLoop() {
    store.setLoop(
      state.loop === 'none' ? 'all' : state.loop === 'all' ? 'one' : 'none'
    );
  }

  /* ── seek（沿 Reader 的 input-range 覆蓋模式） ── */
  const [seekProg, setSeekProg] = useState<number | null>(null);
  const isSeeking = seekProg !== null;
  const displayProg = isSeeking ? seekProg : state.progress;

  const dur = state.duration;
  const curTime = isSeeking && dur > 0 ? displayProg * dur : state.currentTime;

  return (
    <div className="uep-eisland">
      {/* ── echo spot 插播 banner ── */}
      {interrupting && (
        <div
          className="uep-eisland__interrupt"
          style={{ borderColor: accent, color: accent }}
        >
          <span
            className="uep-eisland__interrupt-dot"
            style={{ background: accent, boxShadow: `0 0 6px ${accent}` }}
          />
          回聲插播中
          <span className="uep-eisland__interrupt-back">
            結束後回到「{state.interruptionSnapshot?.title || '先前的回聲'}」
          </span>
        </div>
      )}

      {/* ── 舞台：黑色回聲（＝播放鍵）橫排曲目資訊 ── */}
      <div className="uep-eisland__stage">
        <EchoOrb
          accent={accent}
          playing={state.isPlaying}
          interruption={interrupting}
          satellites={state.playlist}
          disabled={!hasSong && state.playlist.length === 0}
          onToggle={toggleOrb}
        />
        <div className="uep-eisland__info">
          {hasSong ? (
            <>
              <div
                className="uep-eisland__title"
                title={state.currentTitle ?? undefined}
              >
                {state.currentTitle || '未知的回聲'}
              </div>
              <div className="uep-eisland__meta">
                <span
                  className="uep-eisland__meta-dot"
                  style={{ background: accent }}
                />
                {state.isPlaying ? 'NOW PLAYING' : 'STANDBY'}
              </div>
            </>
          ) : (
            <div className="uep-eisland__empty-hint">
              還沒有回聲跟著你。
              <br />
              去回音蒐藏間帶幾枚回來吧。
            </div>
          )}
        </div>
      </div>

      {/* ── seek ── */}
      <div className="uep-eisland__seek">
        <div className="uep-eisland__seek-track">
          <div
            className="uep-eisland__seek-fill"
            style={{ width: `${displayProg * 100}%`, background: accent }}
          />
          <span
            className="uep-eisland__seek-thumb"
            style={{
              left: `${displayProg * 100}%`,
              background: ballBg(accent, state.isPlaying),
              boxShadow: `0 0 0 1.5px ${accent}`,
            }}
          />
          <input
            type="range"
            className="uep-eisland__seek-input"
            min={0}
            max={1}
            step={0.001}
            value={displayProg}
            disabled={!hasSong}
            aria-label="播放進度"
            onChange={(e) => setSeekProg(parseFloat(e.target.value))}
            onPointerDown={() => {
              store.beginSeek();
              setSeekProg(displayProg);
            }}
            onPointerUp={(e) => {
              const val =
                seekProg ?? parseFloat((e.target as HTMLInputElement).value);
              setSeekProg(null);
              store.endSeek(val);
            }}
          />
        </div>
        <div className="uep-eisland__times">
          <span>{fmtTime(curTime)}</span>
          <span>{dur > 0 ? fmtTime(dur) : '--:--'}</span>
        </div>
      </div>

      {/* ── 控制列：⟳ ◀◀ ▶▶ ♪（播放/暫停在黑球上） ── */}
      <div className="uep-eisland__controls">
        <button
          type="button"
          className={`uep-eisland__ctl uep-eisland__loop${state.loop !== 'none' ? ' is-on' : ''}`}
          onClick={cycleLoop}
          title={`循環：${state.loop === 'none' ? '關' : state.loop === 'all' ? '全部' : '單曲'}`}
          aria-label="切換循環模式"
          style={
            state.loop !== 'none'
              ? { borderColor: accent, color: accent }
              : undefined
          }
        >
          <span className="uep-eisland__ctl-glyph" aria-hidden>
            ⟳
          </span>
          {state.loop === 'one' && (
            <span
              className="uep-eisland__loop-one"
              style={{ background: accent }}
            >
              1
            </span>
          )}
        </button>
        <span className="uep-eisland__flex" />
        <button
          type="button"
          className="uep-eisland__ctl"
          onClick={() => store.previous()}
          disabled={!hasSong}
          title="重播"
          aria-label="回到曲目開頭"
        >
          <svg className="uep-eisland__ctl-svg" viewBox="0 0 16 16" aria-hidden>
            <path d="M3 3h1.5v10H3zM13 3.2v9.6L5.5 8z" />
          </svg>
        </button>
        <button
          type="button"
          className="uep-eisland__ctl"
          onClick={() => store.next()}
          disabled={state.playlist.length === 0}
          title="下一首"
          aria-label="下一首"
        >
          <svg className="uep-eisland__ctl-svg" viewBox="0 0 16 16" aria-hidden>
            <path d="M11.5 3h1.5v10h-1.5zM3 3.2v9.6L10.5 8z" />
          </svg>
        </button>
        <span className="uep-eisland__flex" />
        <div className="uep-eisland__vol">
          <span className="uep-eisland__vol-glyph" aria-hidden>
            {state.volume === 0 ? '∅' : '♪'}
          </span>
          <div className="uep-eisland__vol-track">
            <div
              className="uep-eisland__vol-fill"
              style={{ width: `${state.volume * 100}%` }}
            />
            <input
              type="range"
              className="uep-eisland__vol-input"
              min={0}
              max={1}
              step={0.05}
              value={state.volume}
              aria-label={`音量 ${Math.round(state.volume * 100)}%`}
              onChange={(e) => store.setVolume(parseFloat(e.target.value))}
            />
          </div>
        </div>
      </div>

      {/* ── 佇列（預設收合，toggle 展開） ── */}
      <div className="uep-eisland__queue">
        <button
          type="button"
          className="uep-eisland__queue-toggle"
          onClick={() => setQueueOpen((o) => !o)}
          aria-expanded={queueOpen}
        >
          <span
            className={`uep-eisland__queue-arrow${queueOpen ? ' is-open' : ''}`}
            aria-hidden
          >
            ▶
          </span>
          佇列 · queue
          <span className="uep-eisland__queue-dots" aria-hidden>
            {state.playlist.slice(0, 5).map((t) => (
              <span
                key={t.songId}
                style={{ background: t.accent || DEFAULT_ACCENT }}
              />
            ))}
          </span>
          <span className="uep-eisland__flex" />
          <span className="uep-eisland__queue-count">
            {state.playlist.length}
          </span>
        </button>

        {queueOpen && (
          <div className="uep-eisland__queue-list">
            {state.playlist.map((t, i) => (
              <div
                key={t.songId}
                className="uep-eisland__row"
                role="button"
                tabIndex={0}
                onClick={() => playFromQueue(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    playFromQueue(i);
                  }
                }}
              >
                <span
                  className="uep-eisland__row-orb"
                  style={{ background: t.accent || DEFAULT_ACCENT }}
                />
                <span className="uep-eisland__row-title">
                  {t.title || '未知的回聲'}
                </span>
                <button
                  type="button"
                  className="uep-eisland__row-x"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromQueue(i);
                  }}
                  aria-label={`自佇列移除${t.title || '此曲'}`}
                >
                  ×
                </button>
              </div>
            ))}
            {state.playlist.length === 0 && (
              <div className="uep-eisland__queue-empty">
                佇列是空的。去回音蒐藏間撿幾顆回聲回來吧。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
