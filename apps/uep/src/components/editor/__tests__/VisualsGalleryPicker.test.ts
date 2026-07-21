import { describe, expect, it } from 'vitest';

import { flattenClueGalleries } from '../VisualsGalleryPicker';

describe('flattenClueGalleries — #8 圖片選擇資料', () => {
  it('保留穩定 image id，並依 sortOrder 提供預設圖／gate 選擇', () => {
    const result = flattenClueGalleries([
      {
        id: 'visuals/illustrations/scene-1',
        title: '場景一',
        pageType: 'gallery',
        metadata: {
          illustrationId: 'scene-1',
          images: [
            {
              id: 'night',
              file: 'images/night.png',
              caption: '夜景',
              sortOrder: 2,
            },
            {
              id: 'dawn',
              file: 'images/dawn.png',
              caption: '黎明',
              sortOrder: 1,
            },
          ],
        },
      },
    ]);

    expect(result[0]).toMatchObject({
      id: 'visuals/illustrations/scene-1',
      targetType: 'illustration',
      targetKey: 'scene-1',
      imageCount: 2,
    });
    expect(result[0].images).toEqual([
      {
        id: 'dawn',
        file: 'images/dawn.png',
        title: '黎明',
        sortOrder: 1,
      },
      {
        id: 'night',
        file: 'images/night.png',
        title: '夜景',
        sortOrder: 2,
      },
    ]);
  });

  it('缺穩定 id 的舊圖片不可被 clue 精準引用', () => {
    const result = flattenClueGalleries([
      {
        id: 'visuals/profiles/hero',
        title: '角色',
        pageType: 'gallery',
        metadata: {
          entityKey: 'hero',
          images: [
            { file: 'images/legacy.png', caption: '舊圖' },
            { id: 'stable', caption: '新圖', sortOrder: 1 },
          ],
        },
      },
    ]);
    expect(result[0].imageCount).toBe(2);
    expect(result[0].images.map((image) => image.id)).toEqual(['stable']);
  });
});
