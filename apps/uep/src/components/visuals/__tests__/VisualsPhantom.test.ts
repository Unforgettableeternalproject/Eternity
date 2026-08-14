/**
 * VisualsPhantom variant 解析防禦測試
 *
 * 背景：division 深連結／popstate 會把完整路徑（visuals/profiles）
 * 傳進 activeDivisionId，舊版直接 `as PhantomVariant` 硬轉型後
 * CFG 查無設定，導致整個 VisualsReader 崩潰（reading 'n'）。
 * resolvePhantomVariant 保證任何輸入都落在合法 variant 上。
 */
import { describe, expect, it } from 'vitest';

import { resolvePhantomVariant } from '../VisualsPhantom';

describe('resolvePhantomVariant', () => {
  it('合法 variant 原樣返回', () => {
    expect(resolvePhantomVariant('landing')).toBe('landing');
    expect(resolvePhantomVariant('profiles')).toBe('profiles');
    expect(resolvePhantomVariant('illustrations')).toBe('illustrations');
    expect(resolvePhantomVariant('sketchs')).toBe('sketchs');
    expect(resolvePhantomVariant('pixel')).toBe('pixel');
  });

  it('完整路徑（深連結未正規化）退回 landing 而非崩潰', () => {
    expect(resolvePhantomVariant('visuals/profiles')).toBe('landing');
  });

  it('null / undefined / 空字串退回 landing', () => {
    expect(resolvePhantomVariant(null)).toBe('landing');
    expect(resolvePhantomVariant(undefined)).toBe('landing');
    expect(resolvePhantomVariant('')).toBe('landing');
  });

  it('未知值與原型鏈屬性名退回 landing', () => {
    expect(resolvePhantomVariant('unknown-division')).toBe('landing');
    expect(resolvePhantomVariant('toString')).toBe('landing');
  });
});
