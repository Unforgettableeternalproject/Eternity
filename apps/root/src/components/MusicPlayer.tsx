import { useState, useRef, useEffect } from 'react';

interface Track {
  title: string;
  artist: string;
  url: string;
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(0);
  const [volume, setVolume] = useState(0.5);
  const [showTracks, setShowTracks] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

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
    setIsPlaying(false);
    setShowTracks(false);
  };

  const nextTrack = () => {
    const next = (currentTrack + 1) % tracks.length;
    changeTrack(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <svg className="w-4 h-4 text-primary-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
          {locale === 'zh-tw' ? '音樂播放器' : 'Music Player'}
        </h3>
        <button
          onClick={() => setShowTracks(!showTracks)}
          className="text-slate-600 dark:text-slate-400 hover:text-primary-500 dark:hover:text-primary-400"
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
        onEnded={nextTrack}
      />
    </div>
  );
}
