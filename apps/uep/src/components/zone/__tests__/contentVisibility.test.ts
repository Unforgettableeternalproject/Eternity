import { describe, it, expect } from 'vitest';
import {
  isHidden,
  isLocked,
  getSpoilerLevel,
  isAccessible,
} from '../contentVisibility';

/**
 * contentVisibility 工具函式測試
 *
 * 這些函式控制全站內容的可見性語意：
 * - hidden: 完全不對前台公開
 * - locked: 顯示但不可進入
 * - spoiler: 可訪問但需劇透警告
 */

describe('contentVisibility', () => {
  describe('isHidden', () => {
    it('metadata.hidden === true 時回傳 true', () => {
      expect(isHidden({ metadata: { hidden: true } })).toBe(true);
    });

    it('metadata.hidden === false 時回傳 false', () => {
      expect(isHidden({ metadata: { hidden: false } })).toBe(false);
    });

    it('沒有 metadata 時回傳 false', () => {
      expect(isHidden({})).toBe(false);
      expect(isHidden({ metadata: null })).toBe(false);
      expect(isHidden({ metadata: undefined })).toBe(false);
    });

    it('metadata 中沒有 hidden 欄位時回傳 false', () => {
      expect(isHidden({ metadata: { title: '測試' } })).toBe(false);
    });
  });

  describe('isLocked', () => {
    it('metadata.locked === true 時回傳 true', () => {
      expect(isLocked({ metadata: { locked: true } })).toBe(true);
    });

    it('metadata.locked === false 時回傳 false', () => {
      expect(isLocked({ metadata: { locked: false } })).toBe(false);
    });

    it('沒有 metadata 時回傳 false', () => {
      expect(isLocked({})).toBe(false);
    });
  });

  describe('getSpoilerLevel', () => {
    it('回傳 metadata.spoilerLevel 的數值', () => {
      expect(getSpoilerLevel({ metadata: { spoilerLevel: 1 } })).toBe(1);
      expect(getSpoilerLevel({ metadata: { spoilerLevel: 3 } })).toBe(3);
    });

    it('沒有 spoilerLevel 時回傳 0', () => {
      expect(getSpoilerLevel({})).toBe(0);
      expect(getSpoilerLevel({ metadata: {} })).toBe(0);
      expect(getSpoilerLevel({ metadata: null })).toBe(0);
    });

    it('spoilerLevel 不是數字時回傳 0', () => {
      expect(getSpoilerLevel({ metadata: { spoilerLevel: '2' } })).toBe(0);
      expect(getSpoilerLevel({ metadata: { spoilerLevel: true } })).toBe(0);
    });
  });

  describe('isAccessible', () => {
    it('既不 hidden 也不 locked 時回傳 true', () => {
      expect(isAccessible({ metadata: {} })).toBe(true);
      expect(isAccessible({ metadata: { hidden: false, locked: false } })).toBe(
        true
      );
    });

    it('hidden 時回傳 false', () => {
      expect(isAccessible({ metadata: { hidden: true } })).toBe(false);
    });

    it('locked 時回傳 false', () => {
      expect(isAccessible({ metadata: { locked: true } })).toBe(false);
    });

    it('同時 hidden 和 locked 時回傳 false', () => {
      expect(isAccessible({ metadata: { hidden: true, locked: true } })).toBe(
        false
      );
    });

    it('有 spoiler 但沒有 hidden/locked 時仍可訪問', () => {
      expect(isAccessible({ metadata: { spoilerLevel: 3 } })).toBe(true);
    });
  });
});
