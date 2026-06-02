/**
 * 音樂播放器 Widget — 包裝既有的 MusicPlayer 元件
 * 注意：transition:persist 問題在原型階段暫不處理
 */
import React from 'react';
import MusicPlayer from '../MusicPlayer';
import { getWidgetData } from './types';

export default function WidgetMusicPlayer() {
  const data = getWidgetData();
  const isZh = data.locale === 'zh-tw';

  const translations = isZh
    ? { title: '音樂播放器', paused: '⏸️ 音樂已暫停', playing: '▶️ 繼續播放' }
    : {
        title: 'Music Player',
        paused: '⏸️ Music Paused',
        playing: '▶️ Now Playing',
      };

  return (
    <div className="q-widget-music">
      <MusicPlayer
        tracks={data.musicTracks?.map((t) => ({
          title: t.name,
          artist: t.artist || '',
          url: t.src,
        }))}
        locale={data.locale}
        translations={translations}
      />
    </div>
  );
}
