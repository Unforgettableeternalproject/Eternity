/**
 * 別名顯示格式測試
 *
 * 輸入端是自由文字（編輯器以頓號／逗號分隔後拆陣列），所以髒資料在這裡
 * 收斂，兩個顯示端都不必各自防禦。
 */
import { describe, it, expect } from 'vitest';

import { formatAliasLine, normalizeAliases } from '../aliases';

describe('normalizeAliases', () => {
  it('去空白、濾空、去重且保留原順序', () => {
    expect(normalizeAliases([' 艾斯 ', '', '  ', '隊長', '艾斯'])).toEqual([
      '艾斯',
      '隊長',
    ]);
  });

  it('未定義與空陣列都回空', () => {
    expect(normalizeAliases()).toEqual([]);
    expect(normalizeAliases([])).toEqual([]);
  });
});

describe('formatAliasLine', () => {
  it('以頓號串接', () => {
    expect(formatAliasLine(['艾斯', '隊長'])).toBe('又名：艾斯、隊長');
  });

  it('單一別名不加分隔', () => {
    expect(formatAliasLine(['艾斯'])).toBe('又名：艾斯');
  });

  it('沒有可顯示的別名回 null——呼叫端據此整行不渲染', () => {
    expect(formatAliasLine()).toBeNull();
    expect(formatAliasLine([])).toBeNull();
    expect(formatAliasLine(['   '])).toBeNull();
  });
});
