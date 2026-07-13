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
      }),
    ]);
    expect(songs[0].spoilerRevisions).toHaveLength(1);
  });
});
