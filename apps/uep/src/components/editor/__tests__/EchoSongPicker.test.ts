import { describe, expect, it } from 'vitest';
import { flattenEchoSongs } from '../EchoSongPicker';

describe('flattenEchoSongs', () => {
  it('只列有音檔歌曲並保留 cluster/entity/spoiler 快照', () => {
    const songs = flattenEchoSongs([
      {
        id: 'echoes/characters',
        title: '角色回聲',
        pageType: 'cluster',
        children: [
          {
            id: 'echoes/characters/heroes',
            title: '英雄',
            pageType: 'subcategory',
            children: [
              {
                id: 'echoes/characters/heroes/xavier',
                title: '澤維爾之歌',
                pageType: 'song',
                metadata: {
                  audioFile: 'audio/xavier.mp3',
                  entityKey: 'xavier-colsono',
                  category: 'character',
                  spoilerLevel: 3,
                  spoilerRevisions: [
                    { targetLevel: 2, gate: { requiresFlags: ['met:x'] } },
                  ],
                  audioMeta: { duration: 123 },
                },
              },
              {
                id: 'echoes/characters/heroes/empty',
                title: '尚未上傳',
                pageType: 'song',
                metadata: {},
              },
            ],
          },
        ],
      },
    ]);

    expect(songs).toEqual([
      expect.objectContaining({
        id: 'echoes/characters/heroes/xavier',
        audioFile: 'audio/xavier.mp3',
        entityKey: 'xavier-colsono',
        clusterId: 'characters',
        clusterTitle: '角色回聲',
        subcategoryTitle: '英雄',
        duration: 123,
        spoilerLevel: 3,
        songType: 'character',
      }),
    ]);
    expect(songs[0].spoilerRevisions).toHaveLength(1);
  });

  it('沒有 spoiler revisions 時忽略靜態等級並以 L0 寫入 spot 快照', () => {
    const songs = flattenEchoSongs([
      {
        id: 'echoes/areas/theme',
        title: '區域曲',
        pageType: 'song',
        metadata: {
          audioFile: 'audio/area.mp3',
          entityKey: 'area:test',
          category: 'area',
          spoilerLevel: 2,
        },
      },
    ]);

    expect(songs[0]?.spoilerLevel).toBe(0);
  });
  it('排除特殊回憶及缺 entityKey 的非劇情歌，但保留無 key 劇情歌', () => {
    const songs = flattenEchoSongs([
      {
        id: 'echoes/root',
        title: 'Echoes',
        children: [
          {
            id: 'echoes/special',
            title: '特殊回憶',
            pageType: 'cluster',
            children: [
              {
                id: 'echoes/special/a',
                title: '不可選',
                pageType: 'song',
                metadata: { audioFile: 'audio/special.mp3', entityKey: 'sp' },
              },
            ],
          },
          {
            id: 'echoes/characters',
            title: '角色回憶',
            pageType: 'cluster',
            children: [
              {
                id: 'echoes/characters/no-key',
                title: '尚未繫結',
                pageType: 'song',
                metadata: { audioFile: 'audio/no-key.mp3' },
              },
            ],
          },
          {
            id: 'echoes/stories',
            title: '劇情回憶',
            pageType: 'cluster',
            children: [
              {
                id: 'echoes/stories/opening',
                title: '序章插播',
                pageType: 'song',
                metadata: {
                  audioFile: 'audio/opening.mp3',
                  category: 'story',
                  spoilerLevel: 3,
                },
              },
            ],
          },
        ],
      },
    ]);

    expect(songs).toEqual([
      expect.objectContaining({
        id: 'echoes/stories/opening',
        songType: 'story',
        spoilerLevel: 0,
      }),
    ]);
  });
});
