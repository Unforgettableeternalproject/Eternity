import { useState, useRef, useEffect } from 'react';

interface Track {
  title: string;
  artist: string;
  url: string;
  cover?: string;
}

interface MusicPlayerProps {
  tracks?: Track[];
  locale?: string;
}

export default function MusicPlayer({ 
  tracks = [
    { title: 'Track 1', artist: 'Artist', url: '/music/track1.mp3' },
    { title: 'Track 2', artist: 'Artist', url: '/music/track2.mp3' },
  ],
  locale = 'zh-tw'
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
    console.log('[MusicPlayer] getSavedVolume - Cookie consent:', cookieConsent);
    
    if (cookieConsent !== 'accepted') {
      console.log('[MusicPlayer] getSavedVolume - Cookie not accepted, using default 0.5');
      return 0.5;
    }
    
    // 檢查舊的 globalMusicPlayerState 格式
    const globalState = localStorage.getItem('globalMusicPlayerState');
    if (globalState) {
      try {
        const parsed = JSON.parse(globalState);
        console.log('[MusicPlayer] Found globalMusicPlayerState:', parsed);
        if (typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1) {
          console.log('[MusicPlayer] Using volume from globalMusicPlayerState:', parsed.volume);
          return parsed.volume;
        }
      } catch (error) {
        console.error('[MusicPlayer] Error parsing globalMusicPlayerState:', error);
      }
    }
    
    // 檢查新的獨立 key 格式
    const saved = localStorage.getItem('music-volume');
    console.log('[MusicPlayer] getSavedVolume - Saved volume from localStorage:', saved);
    
    if (saved) {
      const vol = parseFloat(saved);
      const isValid = vol >= 0 && vol <= 1;
      console.log('[MusicPlayer] getSavedVolume - Parsed volume:', vol, 'Valid:', isValid);
      return isValid ? vol : 0.5;
    }
    
    console.log('[MusicPlayer] getSavedVolume - No saved volume, using default 0.5');
    return 0.5;
  };

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(getSavedTrack());
  const [volume, setVolume] = useState(getSavedVolume());
  const [showTracks, setShowTracks] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isTransitioning = useRef(false); // 追蹤是否正在頁面轉換

  // 監聽 View Transitions 事件
  useEffect(() => {
    const handleBeforeSwap = () => {
      isTransitioning.current = true;
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
    console.log('[MusicPlayer] Volume changed to:', volume, 'Cookie consent:', cookieConsent);
    
    if (cookieConsent === 'accepted') {
      try {
        // 更新 globalMusicPlayerState（相容舊格式）
        const globalState = localStorage.getItem('globalMusicPlayerState');
        if (globalState) {
          const parsed = JSON.parse(globalState);
          parsed.volume = volume;
          localStorage.setItem('globalMusicPlayerState', JSON.stringify(parsed));
          console.log('[MusicPlayer] Updated volume in globalMusicPlayerState:', volume);
        }
        
        // 同時也儲存到獨立 key（新格式）
        localStorage.setItem('music-volume', volume.toString());
        console.log('[MusicPlayer] Volume saved to localStorage:', volume);
      } catch (error) {
        console.error('[MusicPlayer] Error saving to localStorage:', error);
      }
    } else {
      console.log('[MusicPlayer] Volume NOT saved (cookie not accepted)');
    }
  }, [volume]);

  // 監聽 Cookie 同意狀態變化，重新載入儲存的設定
  useEffect(() => {
    const handleCookieConsentChanged = () => {
      console.log('[MusicPlayer] cookie-consent-changed event triggered');
      const cookieConsent = localStorage.getItem('cookie-consent');
      console.log('[MusicPlayer] Cookie consent status:', cookieConsent);
      
      if (cookieConsent === 'accepted') {
        // 重新載入音量設定
        const savedVolume = localStorage.getItem('music-volume');
        console.log('[MusicPlayer] Reloading volume from localStorage:', savedVolume);
        
        if (savedVolume) {
          const vol = parseFloat(savedVolume);
          if (vol >= 0 && vol <= 1) {
            console.log('[MusicPlayer] Setting volume to:', vol);
            setVolume(vol);
          }
        }
        
        // 重新載入歌曲選擇
        const savedTrack = localStorage.getItem('music-current-track');
        console.log('[MusicPlayer] Reloading track from localStorage:', savedTrack);
        
        if (savedTrack) {
          const index = parseInt(savedTrack, 10);
          if (index >= 0 && index < tracks.length) {
            console.log('[MusicPlayer] Setting track to:', index);
            setCurrentTrack(index);
          }
        }
      }
    };

    console.log('[MusicPlayer] Setting up cookie-consent-changed listener');
    window.addEventListener('cookie-consent-changed', handleCookieConsentChanged);

    return () => {
      console.log('[MusicPlayer] Removing cookie-consent-changed listener');
      window.removeEventListener('cookie-consent-changed', handleCookieConsentChanged);
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
      window.removeEventListener('cookie-accepted-play-music', handleCookieAccepted);
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
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const changeTrack = (index: number) => {
    setCurrentTrack(index);
    setShowTracks(false);
    // 不需要手動設置 isPlaying，因為音頻元素的事件會自動處理
  };

  const nextTrack = () => {
    const next = (currentTrack + 1) % tracks.length;
    changeTrack(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <svg className="w-4 h-4 text-primary-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
            {locale === 'zh-tw' ? '音樂播放器' : 'Music Player'}
          </h3>
          {tracks[currentTrack].cover && (
            <img 
              src={tracks[currentTrack].cover} 
              alt={tracks[currentTrack].title}
              className="w-8 h-8 rounded object-contain bg-slate-100 dark:bg-slate-800 ml-auto"
            />
          )}
        </div>
        <button
          onClick={() => setShowTracks(!showTracks)}
          className="text-slate-600 dark:text-slate-400 hover:text-primary-500 dark:hover:text-primary-400 ml-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      <div className="text-xs text-slate-600 dark:text-slate-300 mb-2 truncate">
        {tracks[currentTrack].title} - {tracks[currentTrack].artist}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-primary-500 hover:bg-primary-600 text-white flex items-center justify-center transition-colors"
        >
          {isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
            </svg>
          ) : (
            <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>

        <button
          onClick={nextTrack}
          className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center transition-colors"
        >
          <svg className="w-4 h-4 text-slate-700 dark:text-slate-300" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
          </svg>
        </button>

        <div className="flex-1 flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
          </svg>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="flex-1 h-1 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      {showTracks && (
        <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2 max-h-40 overflow-y-auto">
          {tracks.map((track, index) => (
            <button
              key={index}
              onClick={() => changeTrack(index)}
              className={`w-full text-left text-xs p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
                currentTrack === index ? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <div className="truncate font-medium">{track.title}</div>
              <div className="truncate text-[10px] opacity-75">{track.artist}</div>
            </button>
          ))}
        </div>
      )}

      <audio
        ref={audioRef}
        src={tracks[currentTrack].url}
        loop
        id="global-music-player"
        data-astro-transition-persist="music-audio"
      />
    </div>
  );
}
