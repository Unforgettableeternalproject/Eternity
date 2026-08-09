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
import { useIslandChrome } from '../islandChrome';

import type { EchoPreviewTrack } from './echoPreview';
import {
  clearEchoSuggestion,
  consumeEchoSuggestion,
  UEP_ECHO_SUGGESTION_EVENT,
} from './echoSuggestionBridge';

import islandCss from './EchoesIsland.css?inline';
import { useDeferredStyle } from '../useDeferredStyle';

/** Echoes zone 預設 accent（無分類色資訊時的 fallback）＝ --echoes-main */
const DEFAULT_ACCENT = '#355C7D';

/**
 * 空池：島裡一枚回聲都沒有時的水色。
 *
 * 曾經是中性灰，讓「染色」成為播放的獎賞；但其他四座島待機時本來就是
 * 自己的區域色，只有這座退回灰，看起來像沒接上任何區域
 * （艾斯維爾 2026-07-25 回饋）。改為 Echoes 區域主色——播放時仍會被
 * 當前 cluster 色蓋過，只是起點不再是無主的灰。
 */
const IDLE_POOL = DEFAULT_ACCENT;

/** 播放時浮現的回聲球——位置固定、節奏錯開，比 zone 背景的稀疏得多 */
const POOL_ORBS = [
  { left: '12%', size: 7, delay: 0, dur: 13 },
  { left: '31%', size: 5, delay: 4.5, dur: 16 },
  { left: '52%', size: 8, delay: 9, dur: 14 },
  { left: '69%', size: 4, delay: 2.5, dur: 18 },
  { left: '84%', size: 6, delay: 11.5, dur: 15 },
];

/**
 * 回聲球體底色：待機淡灰，播放中被分類色「染色」
 * （艾斯維爾 2026-07-11：不要黑色——播放不同 cluster 時球染該色）。
 *
 * 2026-07-26 調整：拿掉打亮的高光——原本 45% 白的亮斑加上另一顆 fleck，
 * 球看起來像上了釉的塑膠珠。回聲是實心的，只留一點方向感就好。
 * 待機灰也從暖灰（#f7f4ec 系）換成中性灰：暖灰疊在冷色水上會發濁。
 */
function ballBg(accent: string, playing: boolean): string {
  return playing
    ? `radial-gradient(circle at 38% 34%, color-mix(in srgb, ${accent} 20%, #fff) 0%, ${accent} 58%, color-mix(in srgb, ${accent} 72%, #000) 100%)`
    : 'radial-gradient(circle at 38% 34%, #eef1f2 0%, #d9dee1 55%, #bcc4c9 100%)';
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
  suggesting,
  onToggle,
}: {
  accent: string;
  playing: boolean;
  interruption: boolean;
  satellites: AudioQueueItem[];
  disabled: boolean;
  suggesting: boolean;
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
        className={`uep-eisland__ball${playing ? ' is-playing' : ''}${suggesting ? ' is-suggesting' : ''}`}
        onClick={onToggle}
        disabled={disabled}
        title={playing ? '暫停' : '播放'}
        aria-label={playing ? '暫停' : '播放'}
        style={{
          width: ball,
          height: ball,
          background: ballBg(accent, playing || suggesting),
          boxShadow: `0 0 0 3px var(--bg-card), 0 0 0 4px ${accent}, 0 6px 18px rgba(20, 12, 4, 0.28)${
            playing ? `, 0 0 22px ${accent}55` : ''
          }`,
        }}
      >
        <span className="uep-eisland__ball-glyph" aria-hidden>
          {playing ? '❚❚' : '▶'}
        </span>
      </button>
      {/* 球下方的落影：深色模式是水面倒影，亮色模式改成一片投影
          （亮色下的倒影會在淺水上留一團暗塊，整座島跟著發灰）。
          底色交給 CSS 變數，兩個模式才能各自決定要不要用。 */}
      <span
        className="uep-eisland__orb-cast"
        aria-hidden
        style={
          {
            width: ball,
            height: ball * 0.55,
            '--orb-bg': ballBg(accent, playing || suggesting),
          } as React.CSSProperties
        }
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * EchoesIsland 本體
 * ──────────────────────────────────────────────────────────────── */
export default function EchoesIsland() {
  useDeferredStyle('echoes-island', islandCss);
  const store = getAudioStore();
  const chrome = useIslandChrome();
  const state: AudioState = useSyncExternalStore(
    useCallback((onChange) => store.subscribe(onChange), [store]),
    () => store.getState(),
    () => store.getState()
  );

  const [queueOpen, setQueueOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<EchoPreviewTrack | null>(null);

  useEffect(() => {
    const pending = consumeEchoSuggestion();
    // pending 是島收合期間留下的，取走時情況可能已經變了——這段期間使用者
    // 自己播起同一首的話，這張卡沒有可提示的事（來源端 IslandHost 已在推送
    // 當下擋過一次，這裡擋的是「推送之後才變成正在播」）
    if (pending && pending.songId !== store.getState().currentSongId) {
      setSuggestion(pending);
    }
    const onSuggestion = (event: Event) => {
      const detail = (event as CustomEvent<EchoPreviewTrack | null>).detail;
      // detail null = 清空提示（entity 反查查無/不合格/失敗）
      if (!detail) {
        setSuggestion(null);
        return;
      }
      window.__uepEchoSuggestion = null;
      setSuggestion(detail);
    };
    window.addEventListener(UEP_ECHO_SUGGESTION_EVENT, onSuggestion);
    return () =>
      window.removeEventListener(UEP_ECHO_SUGGESTION_EVENT, onSuggestion);
  }, [store]);

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

  /**
   * 島當前的色彩身分。關聯曲提示卡在時＝那首曲的分類色，否則＝正在播的曲。
   *
   * 全島唯一一個色彩來源：水、球、漣漪、狀態點、進度條、循環鍵一律吃它。
   * 曾經分成「提示色」與「播放色」兩條，於是提示卡出現時水和球換了色、
   * 進度條與狀態點還留在上一個 cluster——兩種分類色同時掛在一座島上
   * （艾斯維爾 2026-07-29）。個別曲目的色（佇列衛星、佇列列）不在此列，
   * 那是每一枚回聲自己的身分。
   */
  const accent = suggestion?.accent || state.currentAccent || DEFAULT_ACCENT;
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

  function playSuggestion() {
    if (!suggestion) return;
    // 一般 play 會把插播前的正常曲目納入歷史，並排除 Echo Spot 曲目。
    void store.play(
      suggestion.songId,
      suggestion.url,
      suggestion.title,
      suggestion.accent
    );
    setSuggestion(null);
  }

  /** 點佇列列：播放該曲並自佇列移除（loop=all 時當前曲回佇列尾，同 next 語意） */
  function playFromQueue(index: number) {
    const item = state.playlist[index];
    if (!item) return;
    let playlist = state.playlist.filter((_, i) => i !== index);
    if (state.loop === 'all') {
      // 插播中「當前曲」是 Echo Spot 插播曲，不得污染正常佇列——
      // 回填來源改用快照裡使用者自己的曲目（同 store playQueueHead 語意）
      const snap = state.interruptionSnapshot;
      const requeue = snap
        ? snap.songId && snap.url
          ? {
              songId: snap.songId,
              url: snap.url,
              ...(snap.title ? { title: snap.title } : {}),
              ...(snap.accent ? { accent: snap.accent } : {}),
            }
          : null
        : state.currentSongId && state.currentUrl
          ? {
              songId: state.currentSongId,
              url: state.currentUrl,
              ...(state.currentTitle ? { title: state.currentTitle } : {}),
              ...(state.currentAccent ? { accent: state.currentAccent } : {}),
            }
          : null;
      if (requeue) playlist = [...playlist, requeue];
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

  function clearEchoState() {
    // 插播中（#4 追加）：× 單純取消這次插播、復原插播前的快照，
    // 不全清佇列/歷史（restoreFromInterruption 帶回插播前的播放狀態）。
    if (state.interruptionSnapshot) {
      store.restoreFromInterruption();
      return;
    }
    store.clearPlayback();
    clearEchoSuggestion();
    setSuggestion(null);
    setQueueOpen(false);
    setSeekProg(null);
    wasPlayingBeforeCollapse = false;
  }

  /* ── seek（沿 Reader 的 input-range 覆蓋模式） ── */
  const [seekProg, setSeekProg] = useState<number | null>(null);
  const isSeeking = seekProg !== null;
  const displayProg = isSeeking ? seekProg : state.progress;

  const dur = state.duration;
  const curTime = isSeeking && dur > 0 ? displayProg * dur : state.currentTime;

  /**
   * 整池水的色相。條件是「島裡有沒有回聲」而不是「正在不在播」——暫停只是
   * 停下來，回聲還在水裡，顏色不該退回灰（艾斯維爾 2026-07-25）。
   *
   * 二次回饋：**上下都染**，上淺下深（淺藍→深藍、淺紅→深紅），不再保留
   * 灰色水面。漸層由 CSS 用 color-mix 從這個色算出深淺兩端，@property 讓
   * 切歌時色相能平順過渡。
   */
  const poolAccent = hasSong || suggestion !== null ? accent : IDLE_POOL;

  return (
    <div
      className="uep-eisland"
      style={{ '--uep-pool-accent': poolAccent } as React.CSSProperties}
    >
      {/* 島頭＝拖曳把手。島名直接落在水上，不再是一塊獨立的標頭板 */}
      <div className="uep-eisland__brim" {...chrome.dragHandleProps}>
        <div className="uep-island-title uep-eisland__name">流浪回聲</div>
      </div>

      {/* 播放時從水裡浮上來的回聲球（比 zone 背景稀疏、更淡、更小） */}
      {state.isPlaying && (
        <div className="uep-eisland__orbs" aria-hidden>
          {POOL_ORBS.map((o, i) => (
            <span
              key={i}
              style={{
                left: o.left,
                width: o.size,
                height: o.size,
                animationDelay: `${o.delay}s`,
                animationDuration: `${o.dur}s`,
              }}
            />
          ))}
        </div>
      )}

      {chrome.bare && (
        <button
          type="button"
          className="uep-island-close uep-eisland__close"
          onClick={chrome.requestClose}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="收合流浪回聲"
          title="收起"
        >
          退潮
        </button>
      )}

      {/* ── echo spot 插播 banner ── */}
      {interrupting && (
        <div
          className="uep-eisland__interrupt"
          style={{ '--interrupt': accent } as React.CSSProperties}
        >
          <span className="uep-eisland__interrupt-dot" />
          回聲插播中
          <span className="uep-eisland__interrupt-back">
            結束後回到「{state.interruptionSnapshot?.title || '先前的回聲'}」
          </span>
        </div>
      )}

      {suggestion && (
        <div
          className="uep-eisland__suggestion"
          style={{ '--suggestion': accent } as React.CSSProperties}
        >
          <span className="uep-eisland__suggestion-dot" aria-hidden />
          <div className="uep-eisland__suggestion-copy">
            <small>RELATED ECHO</small>
            <strong>{suggestion.title}</strong>
          </div>
          <button type="button" onClick={playSuggestion}>
            播放
          </button>
          <button
            type="button"
            className="is-dismiss"
            onClick={() => setSuggestion(null)}
          >
            忽略
          </button>
        </div>
      )}

      {/* ── 舞台：黑色回聲（＝播放鍵）橫排曲目資訊 ── */}
      <div className="uep-eisland__stage">
        {/* 波形：兩道漂移的輪廓線，橫穿過回聲球（球疊在線之上）。不再是
            「水面」——填色的波峰要靠夠深的水才讀得到，反而是整座島發灰的
            來源之一（艾斯維爾 2026-07-26）。只留線。
            掛在舞台內而非島的絕對座標：插播 banner 出現時球會被往下推，
            線得跟著球走才會一直穿過球心。 */}
        <div className="uep-eisland__wave" aria-hidden>
          <svg viewBox="0 0 1200 40" preserveAspectRatio="none">
            <path d="M0 20C150 8 300 32 600 20S1050 8 1200 20" />
          </svg>
          <svg viewBox="0 0 1200 40" preserveAspectRatio="none">
            <path d="M0 23C200 34 380 11 600 23S1000 34 1200 23" />
          </svg>
        </div>
        <EchoOrb
          accent={accent}
          playing={state.isPlaying}
          interruption={interrupting}
          satellites={state.playlist}
          disabled={!hasSong && state.playlist.length === 0}
          suggesting={suggestion !== null}
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
          className="uep-eisland__ctl uep-eisland__clear"
          onClick={clearEchoState}
          disabled={
            !hasSong &&
            state.playlist.length === 0 &&
            state.history.length === 0 &&
            !interrupting &&
            suggestion === null
          }
          title="清除回聲狀態"
          aria-label="清除回聲狀態"
        >
          <span className="uep-eisland__ctl-glyph" aria-hidden>
            ×
          </span>
        </button>
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
          // 插播中佇列空仍可按——store.next() 此時的語意是恢復被中斷的曲目
          disabled={state.playlist.length === 0 && !interrupting}
          title={
            interrupting && state.playlist.length === 0 ? '結束插播' : '下一首'
          }
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

      {/* 池底：讓整池水像立在一個底座上，而不是憑空截斷 */}
      <div className="uep-eisland__base" aria-hidden />
    </div>
  );
}
