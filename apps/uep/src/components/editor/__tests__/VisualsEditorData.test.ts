/**
 * VisualsData 型別遷移測試（S8 下半場 V-A.12）
 *
 * 核心：gate 從自由文字遷移到 GateCondition 物件的相容性——
 * 舊字串靜默失效（僅留提示文案）、round-trip 不破壞既有資料、
 * 新欄位（entityKey / illustrationId / 圖片三態）正確進出。
 */
import { describe, expect, it } from 'vitest';

import {
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
  it('舊自由文字 gate → 靜默失效：gate null + 保留為提示文案', () => {
    const data = parseVisualsData({ gate: '讀完 1-4 後解鎖' });
    expect(data.gate).toBeNull();
    expect(data.legacyGateHint).toBe('讀完 1-4 後解鎖');
  });

  it('結構化 gate 物件 → 正常解析，legacyGateHint 空', () => {
    const data = parseVisualsData({
      gate: { requiresFlags: ['completed:history/ch1'] },
    });
    expect(data.gate).toEqual({ requiresFlags: ['completed:history/ch1'] });
    expect(data.legacyGateHint).toBe('');
  });

  it('無 gate → 兩者皆空', () => {
    const data = parseVisualsData({});
    expect(data.gate).toBeNull();
    expect(data.legacyGateHint).toBe('');
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
  it('舊字串 gate round-trip 不變（未設結構化閘時保留原字串）', () => {
    const metadata = {
      images: [],
      group: 'x',
      spoilerLevel: 2,
      gate: '讀完 1-4 後解鎖',
      layout: 'museum',
    };
    const out = serializeVisualsData(parseVisualsData(metadata));
    expect(out.gate).toBe('讀完 1-4 後解鎖');
    expect(out.group).toBe('x');
    expect(out.spoilerLevel).toBe(2);
    expect(out.layout).toBe('museum');
  });

  it('設定結構化閘後取代舊字串', () => {
    const data = parseVisualsData({ gate: '舊提示' });
    data.gate = { requiresFlags: ['completed:history/ch1'] };
    const out = serializeVisualsData(data);
    expect(out.gate).toEqual({ requiresFlags: ['completed:history/ch1'] });
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
