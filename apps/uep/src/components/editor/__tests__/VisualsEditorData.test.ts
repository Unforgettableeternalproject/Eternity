/**
 * VisualsData 型別遷移測試（S8 下半場 V-A.12）
 *
 * 核心：gate 從自由文字遷移到 GateCondition 物件的相容性——
 * 舊字串靜默失效（僅留提示文案）、round-trip 不破壞既有資料、
 * 新欄位（entityKey / illustrationId / 圖片三態）正確進出。
 */
import { describe, expect, it } from 'vitest';

import {
  collectOtherVisualsGalleryKeys,
  deriveDivisionId,
  normalizeGateObject,
  parseVisualsData,
  serializeVisualsData,
} from '../VisualsEditorBody';
import type { ImageItem } from '../VisualsEditorBody';

describe('normalizeGateObject', () => {
  it('物件形狀 → GateCondition（過濾非字串/空白旗標）', () => {
    expect(
      normalizeGateObject({ requiresFlags: ['a:b', '', 42, '  '], extra: 1 })
    ).toEqual({ requiresFlags: ['a:b'] });
    expect(normalizeGateObject({ pristineOnly: true })).toEqual({
      pristineOnly: true,
    });
    expect(
      normalizeGateObject({ requiresFlags: ['x'], pristineOnly: true })
    ).toEqual({ requiresFlags: ['x'], pristineOnly: true });
  });

  it('字串/陣列/空條件/非物件 → null', () => {
    expect(normalizeGateObject('讀完第一章解鎖')).toBeNull();
    expect(normalizeGateObject(['x'])).toBeNull();
    expect(normalizeGateObject({})).toBeNull();
    expect(normalizeGateObject({ requiresFlags: [] })).toBeNull();
    expect(normalizeGateObject({ pristineOnly: false })).toBeNull();
    expect(normalizeGateObject(null)).toBeNull();
    expect(normalizeGateObject(undefined)).toBeNull();
  });
});

describe('parseVisualsData — gate 遷移', () => {
  it('舊自由文字 gate → 靜默失效：gate null + 承接為提示文案', () => {
    const data = parseVisualsData({ gate: '讀完 1-4 後解鎖' });
    expect(data.gate).toBeNull();
    expect(data.gateHint).toBe('讀完 1-4 後解鎖');
  });

  it('gateHint key 優先於舊字串 gate', () => {
    const data = parseVisualsData({ gate: '舊字串', gateHint: '新提示' });
    expect(data.gateHint).toBe('新提示');
  });

  it('結構化 gate 物件 → 正常解析（唯讀鏡像），gateHint 空', () => {
    const data = parseVisualsData({
      gate: { requiresFlags: ['completed:history/ch1'] },
    });
    expect(data.gate).toEqual({ requiresFlags: ['completed:history/ch1'] });
    expect(data.gateHint).toBe('');
  });

  it('無 gate → 兩者皆空', () => {
    const data = parseVisualsData({});
    expect(data.gate).toBeNull();
    expect(data.gateHint).toBe('');
  });

  it('entityKey / illustrationId 解析（非字串防禦）', () => {
    expect(parseVisualsData({ entityKey: 'xavier' }).entityKey).toBe('xavier');
    expect(parseVisualsData({ illustrationId: 'scene-1' }).illustrationId).toBe(
      'scene-1'
    );
    expect(parseVisualsData({ entityKey: 42 }).entityKey).toBe('');
    expect(parseVisualsData({}).illustrationId).toBe('');
  });
});

describe('serializeVisualsData — round-trip 相容', () => {
  it('舊字串 gate → 承接進 gateHint，不再輸出 gate（Inspector 單一來源）', () => {
    const metadata = {
      images: [],
      group: 'x',
      spoilerLevel: 2,
      gate: '讀完 1-4 後解鎖',
      layout: 'museum',
    };
    const out = serializeVisualsData(parseVisualsData(metadata));
    expect(out.gate).toBeUndefined();
    expect(out.gateHint).toBe('讀完 1-4 後解鎖');
    expect(out.group).toBe('x');
    expect(out.spoilerLevel).toBe(2);
    expect(out.layout).toBe('museum');
  });

  it('結構化 gate 物件存在時 serialize 亦不輸出 gate——由 Inspector 面板保存', () => {
    const data = parseVisualsData({
      gate: { requiresFlags: ['completed:history/ch1'] },
    });
    const out = serializeVisualsData(data);
    expect(out.gate).toBeUndefined();
  });

  it('entityKey / illustrationId trim 後寫出，空值省略', () => {
    const data = parseVisualsData({});
    data.entityKey = '  xavier  ';
    const out = serializeVisualsData(data);
    expect(out.entityKey).toBe('xavier');
    expect(out.illustrationId).toBeUndefined();
  });

  it('圖片三態欄位隨 images 陣列原樣 round-trip', () => {
    const images: ImageItem[] = [
      { id: 'a', file: 'images/a.png', caption: '', sortOrder: 0 },
      {
        id: 'b',
        file: 'images/b.png',
        caption: 'x',
        sortOrder: 1,
        initialState: 'locked',
        lockGate: { requiresFlags: ['completed:history/ch2'] },
        partialGate: { pristineOnly: true },
      },
    ];
    const out = serializeVisualsData(parseVisualsData({ images }));
    expect(out.images).toEqual(images);
  });

  it('無三態欄位的既有圖片資料原樣保留（預設解鎖由 resolver 端處理）', () => {
    const images = [
      { id: 'a', file: 'images/a.png', caption: '', sortOrder: 0 },
    ];
    const out = serializeVisualsData(parseVisualsData({ images }));
    expect(out.images).toEqual(images);
    expect(out.images[0].initialState).toBeUndefined();
  });
});

describe('deriveDivisionId — 分館推導（V-B.16）', () => {
  it('pageSlug 第一段即分館 id', () => {
    expect(deriveDivisionId('profiles/characters/xavier')).toBe('profiles');
    expect(deriveDivisionId('illustrations/scenes/finale')).toBe(
      'illustrations'
    );
    expect(deriveDivisionId('sketchs/drafts/a')).toBe('sketchs');
  });

  it('空 slug 回空字串', () => {
    expect(deriveDivisionId('')).toBe('');
  });
});

describe('collectOtherVisualsGalleryKeys — 唯一性收集（V-B.16）', () => {
  const tree = [
    {
      id: 'visuals/profiles',
      pageType: 'division',
      children: [
        {
          id: 'visuals/profiles/characters',
          pageType: 'subcategory',
          children: [
            {
              id: 'visuals/profiles/characters/xavier',
              pageType: 'gallery',
              metadata: { entityKey: 'xavier-colsono' },
            },
            {
              id: 'visuals/profiles/characters/novia',
              pageType: 'gallery',
              metadata: { entityKey: 'novia' },
            },
          ],
        },
      ],
    },
    {
      id: 'visuals/illustrations',
      pageType: 'division',
      children: [
        {
          id: 'visuals/illustrations/scenes/finale',
          pageType: 'gallery',
          metadata: { illustrationId: 'rain-sea-finale' },
        },
      ],
    },
  ];

  it('收集其他 gallery 的 entityKey 與插圖 ID，排除自身', () => {
    const keys = collectOtherVisualsGalleryKeys(
      tree,
      'visuals/profiles/characters/xavier'
    );
    expect(keys.entityKeys.has('xavier-colsono')).toBe(false);
    expect(keys.entityKeys.has('novia')).toBe(true);
    expect(keys.illustrationIds.has('rain-sea-finale')).toBe(true);
  });

  it('自身 id 比較容忍 encoded/decoded 差異', () => {
    const keys = collectOtherVisualsGalleryKeys(
      tree,
      'visuals/profiles/characters/%78avier'
    );
    // canonicalize 後視為同一頁 → 排除
    expect(keys.entityKeys.has('xavier-colsono')).toBe(false);
  });

  it('非 gallery 節點與空白 key 不收', () => {
    const keys = collectOtherVisualsGalleryKeys(
      [
        {
          id: 'visuals/profiles',
          pageType: 'division',
          metadata: { entityKey: 'should-ignore' },
          children: [
            {
              id: 'visuals/profiles/blank',
              pageType: 'gallery',
              metadata: { entityKey: '   ' },
            },
          ],
        },
      ],
      'visuals/other'
    );
    expect(keys.entityKeys.size).toBe(0);
    expect(keys.illustrationIds.size).toBe(0);
  });
});
