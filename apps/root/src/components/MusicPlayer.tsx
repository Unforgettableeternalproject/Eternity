import { useState, useRef, useEffect } from 'react';
import { showToast } from './Toast';

// 使用全域 toastManager（如果可用）
const getToastManager = () => {
  if (typeof window !== 'undefined' && (window as any).__toastManager) {
    return (window as any).__toastManager;
  }
  return null;
};

interface Track {
  title: string;
  artist: string;
  url: string;
  cover?: string;
}

interface MusicPlayerProps {
  tracks?: Track[];
  locale?: string;
  translations?: {
    title: string;
    paused: string;
    playing: string;
  };
}

export default function MusicPlayer({
  tracks = [
    { title: 'Track 1', artist: 'Artist', url: '/music/track1.mp3' },
    { title: 'Track 2', artist: 'Artist', url: '/music/track2.mp3' },
  ],
  locale = 'zh-tw',
  translations = {
    title: '音樂播放器',
    paused: '⏸️ 音樂已暫停',
    playing: '▶️ 繼續播放',
  },
}: MusicPlayerProps) {
  // 從 localStorage 讀取上次選擇的歌曲（只在接受 Cookie 後）
  const getSavedTrack = () => {
    if (typeof window === 'undefined') return 0;

    // 檢查 Cookie 同意狀態
    const cookieConsent = localStorage.getItem('cookie-consent');
    if (cookieConsent !== 'accepted') return 0;

    const saved = localStorage.getItem('music-current-track');
    if (saved) {
      const index = parseInt(saved, 10);
      // 確保索引有效
      return index >= 0 && index < tracks.length ? index : 0;
    }
    return 0;
  };

  // 從 localStorage 讀取上次的音量設定（只在接受 Cookie 後）
  const getSavedVolume = () => {
    if (typeof window === 'undefined') return 0.5;

    const cookieConsent = localStorage.getItem('cookie-consent');
    if (cookieConsent !== 'accepted') {
      return 0.5;
    }

    // 檢查舊的 globalMusicPlayerState 格式
    const globalState = localStorage.getItem('globalMusicPlayerState');
    if (globalState) {
      try {
        const parsed = JSON.parse(globalState);
        if (
          typeof parsed.volume === 'number' &&
          parsed.volume >= 0 &&
          parsed.volume <= 1
        ) {
          return parsed.volume;
        }
      } catch (error) {
        // Ignore parsing errors
      }
    }

    // 檢查新的獨立 key 格式
    const saved = localStorage.getItem('music-volume');
    if (saved) {
      const vol = parseFloat(saved);
      const isValid = vol >= 0 && vol <= 1;
      return isValid ? vol : 0.5;
    }

    return 0.5;
  };

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(getSavedTrack());
  const [volume, setVolume] = useState(getSavedVolume());
  const [showTracks, setShowTracks] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isTransitioning = useRef(false); // 追蹤是否正在頁面轉換
  const shouldAutoPlay = useRef(false); // 追蹤是否應該自動播放（切換曲目時）
  const [currentTranslations, setCurrentTranslations] = useState(translations);

  // 監聽 translations prop 變化（語言切換時）
  useEffect(() => {
    setCurrentTranslations(translations);
  }, [translations]);

  // 監聽全域語言變化事件（用於 persist 的情況）
  useEffect(() => {
    const handleLanguageChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail?.translations) {
        setCurrentTranslations(customEvent.detail.translations);
      }
    };

    window.addEventListener(
      'music-player-language-change',
      handleLanguageChange
    );

    return () => {
      window.removeEventListener(
        'music-player-language-change',
        handleLanguageChange
      );
    };
  }, []);

  // 監聽 View Transitions 事件
  useEffect(() => {
    const handleBeforeSwap = () => {
      isTransitioning.current = true;
      // 在頁面切換前關閉曲目列表，避免 DOM 不一致錯誤
      setShowTracks(false);
    };
    const handleAfterSwap = () => {
      isTransitioning.current = false;
    };

    document.addEventListener('astro:before-swap', handleBeforeSwap);
    document.addEventListener('astro:after-swap', handleAfterSwap);

    return () => {
      document.removeEventListener('astro:before-swap', handleBeforeSwap);
      document.removeEventListener('astro:after-swap', handleAfterSwap);
    };
  }, []);

  // 當用戶切換歌曲時，保存到 localStorage（只在接受 Cookie 後）
  useEffect(() => {
    const cookieConsent = localStorage.getItem('cookie-consent');
    if (cookieConsent === 'accepted') {
      localStorage.setItem('music-current-track', currentTrack.toString());
    }
  }, [currentTrack]);

  // 當用戶調整音量時，保存到 localStorage（只在接受 Cookie 後）
  useEffect(() => {
    const cookieConsent = localStorage.getItem('cookie-consent');

    if (cookieConsent === 'accepted') {
      try {
        // 更新 globalMusicPlayerState（相容舊格式）
        const globalState = localStorage.getItem('globalMusicPlayerState');
        if (globalState) {
          const parsed = JSON.parse(globalState);
          parsed.volume = volume;
          localStorage.setItem(
            'globalMusicPlayerState',
            JSON.stringify(parsed)
          );
        }

        // 同時也儲存到獨立 key（新格式）
        localStorage.setItem('music-volume', volume.toString());
      } catch (error) {
        // Ignore errors
      }
    }
  }, [volume]);

  // 監聽 Cookie 同意狀態變化，重新載入儲存的設定
  useEffect(() => {
    const handleCookieConsentChanged = () => {
      const cookieConsent = localStorage.getItem('cookie-consent');

      if (cookieConsent === 'accepted') {
        // 重新載入音量設定
        const savedVolume = localStorage.getItem('music-volume');
        if (savedVolume) {
          const vol = parseFloat(savedVolume);
          if (vol >= 0 && vol <= 1) {
            setVolume(vol);
          }
        }

        // 重新載入歌曲選擇
        const savedTrack = localStorage.getItem('music-current-track');
        if (savedTrack) {
          const index = parseInt(savedTrack, 10);
          if (index >= 0 && index < tracks.length) {
            setCurrentTrack(index);
          }
        }
      }
    };

    window.addEventListener(
      'cookie-consent-changed',
      handleCookieConsentChanged
    );

    return () => {
      window.removeEventListener(
        'cookie-consent-changed',
        handleCookieConsentChanged
      );
    };
  }, [tracks.length]);

  // 監聽音頻元素的實際播放狀態
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    // 同步初始狀態
    setIsPlaying(!audio.paused);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, []);

  // 當歌曲改變時，暫停播放並重置
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // 記住播放狀態
    const wasPlaying = !audio.paused;

    // 暫停當前播放
    if (wasPlaying) {
      audio.pause();
    }

    // 載入新歌曲
    audio.load();

    // 如果之前在播放，繼續播放新歌曲
    if (wasPlaying) {
      audio.play().catch(() => {});
    }
  }, [currentTrack]);

  // 監聽 Cookie 同意事件，用戶互動後播放音樂
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleCookieAccepted = () => {
      // 只在非行動版（md 以上，768px+）才自動播放
      if (window.innerWidth < 768) return;

      // 檢查是否已經播放過
      const hasPlayed = sessionStorage.getItem('music-has-played');
      if (hasPlayed === 'true') return;

      audio.volume = volume;
      sessionStorage.setItem('music-has-played', 'true');

      // 用戶互動後播放，不會被阻止
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {});
      }
    };

    window.addEventListener('cookie-accepted-play-music', handleCookieAccepted);

    return () => {
      window.removeEventListener(
        'cookie-accepted-play-music',
        handleCookieAccepted
      );
    };
  }, [volume]); // 空依賴陣列，只在掛載時執行一次

  // 更新音量
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const togglePlay = () => {
    if (audioRef.current) {
      const manager = getToastManager();
      if (isPlaying) {
        audioRef.current.pause();
        if (manager) {
          manager.show(currentTranslations.paused, 'info');
        }
      } else {
        audioRef.current.play();
        if (manager) {
          manager.show(currentTranslations.playing, 'info');
        }
      }
      setIsPlaying(!isPlaying);
    }
  };

  const changeTrack = (index: number) => {
    shouldAutoPlay.current = true; // 標記需要自動播放
    setCurrentTrack(index);
    setShowTracks(false);

    // 顯示切換曲目的 Toast
    const track = tracks[index];
    const manager = getToastManager();
    if (manager) {
      manager.show(
        locale === 'zh-tw'
          ? `🎵 現正撥放: ${track.title} - ${track.artist}`
          : `🎵 Now Playing: ${track.title} - ${track.artist}`,
        'success'
      );
    }
  };

  const nextTrack = () => {
    const next = (currentTrack + 1) % tracks.length;
    changeTrack(next);
  };

  // 當曲目變化時，等待 audio src 更新後自動播放
  useEffect(() => {
    if (shouldAutoPlay.current && audioRef.current) {
      // 等待 audio 元素的 src 更新（React 重新渲染後）
      const audio = audioRef.current;

      // 監聽 canplay 事件，確保新曲目可以播放時才開始
      const handleCanPlay = () => {
        audio.play().catch(() => {});
        audio.removeEventListener('canplay', handleCanPlay);
      };

      audio.addEventListener('canplay', handleCanPlay);
      shouldAutoPlay.current = false; // 重置標記

      // 清理函數
      return () => {
        audio.removeEventListener('canplay', handleCanPlay);
      };
    }
  }, [currentTrack]);

  // === 手機版控制橋接 ===
  // 接收 music-next-track / music-change-track 事件
  useEffect(() => {
    const handleNext = () => {
      shouldAutoPlay.current = true;
      setCurrentTrack((prev) => (prev + 1) % tracks.length);
    };
    const handleChange = (e: Event) => {
      const { index } = (e as CustomEvent).detail;
      if (typeof index === 'number' && index >= 0 && index < tracks.length) {
        changeTrack(index);
      }
    };
    window.addEventListener('music-next-track', handleNext);
    window.addEventListener('music-change-track', handleChange);
    return () => {
      window.removeEventListener('music-next-track', handleNext);
      window.removeEventListener('music-change-track', handleChange);
    };
  }, [tracks.length]);

  // 廣播當前曲目資訊（讓手機版同步顯示）
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('music-track-change', {
        detail: {
          index: currentTrack,
          title: tracks[currentTrack]?.title || '',
        },
      })
    );
  }, [currentTrack]);

  // 曲目顯示文字（避免空 artist 造成尾巴 ` - `）
  const trackLabel = tracks[currentTrack].artist
    ? `${tracks[currentTrack].title} — ${tracks[currentTrack].artist}`
    : tracks[currentTrack].title;

  return (
    <div className="qmp">
      {/* 曲目資訊 */}
      <div className="qmp__track">
        <span className="qmp__title">{trackLabel}</span>
        <button
          onClick={() => setShowTracks(!showTracks)}
          className="qmp__list-toggle"
          aria-label="Track list"
        >
          {showTracks ? '▾' : '▸'}{' '}
          <span className="qmp__count">
            {currentTrack + 1}/{tracks.length}
          </span>
        </button>
      </div>

      {/* 播放控制列 */}
      <div className="qmp__controls">
        <button
          onClick={togglePlay}
          className="qmp__play"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <button
          onClick={nextTrack}
          className="qmp__next"
          aria-label="Next track"
        >
          <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>

        <div className="qmp__volume">
          <svg
            width="12"
            height="12"
            fill="currentColor"
            viewBox="0 0 24 24"
            className="qmp__volume-icon"
          >
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
          </svg>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="qmp__volume-slider"
          />
        </div>
      </div>

      {/* 曲目清單 */}
      {showTracks && (
        <div className="qmp__tracklist">
          {tracks.map((track, index) => (
            <button
              key={index}
              onClick={() => changeTrack(index)}
              className={`qmp__tracklist-item ${
                currentTrack === index ? 'qmp__tracklist-item--active' : ''
              }`}
            >
              <span className="qmp__tracklist-idx">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="qmp__tracklist-name">{track.title}</span>
            </button>
          ))}
        </div>
      )}

      <audio
        ref={audioRef}
        src={tracks[currentTrack].url}
        loop
        preload="metadata"
        id="global-music-player"
        data-astro-transition-persist="music-audio"
        crossOrigin="anonymous"
      />
    </div>
  );
}
