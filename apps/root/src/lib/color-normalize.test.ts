import { describe, it, expect } from 'vitest';
import { normalizeColors } from './color-normalize';

describe('normalizeColors', () => {
  // ── 基本行為 ──────────────────────────────────────────

  it('空字串原樣回傳', () => {
    expect(normalizeColors('')).toBe('');
  });

  it('null / undefined 安全處理', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeColors(null as any)).toBe(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeColors(undefined as any)).toBe(undefined);
  });

  it('不含硬編碼色的 HTML 不被修改', () => {
    const html = '<p style="color: red">Hello</p>';
    expect(normalizeColors(html)).toBe(html);
  });

  // ── rgb() 替換 ────────────────────────────────────────

  it('rgb(39, 57, 108) → var(--q-navy)', () => {
    const input = '<span style="color: rgb(39, 57, 108)">navy text</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-navy)');
    expect(normalizeColors(input)).not.toContain('rgb(39, 57, 108)');
  });

  it('rgb(26, 34, 64) → var(--q-navy-deep)', () => {
    const input = '<span style="color: rgb(26, 34, 64)">deep navy</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-navy-deep)');
  });

  it('rgb(214, 68, 46) → var(--q-coral)', () => {
    const input = '<span style="color: rgb(214, 68, 46)">coral text</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-coral)');
  });

  it('rgb(59, 67, 96) → var(--q-ink-soft)', () => {
    const input = '<span style="color: rgb(59, 67, 96)">ink soft</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-ink-soft)');
  });

  it('rgb(15, 21, 48) → var(--q-ink)', () => {
    const input = '<span style="color: rgb(15, 21, 48)">ink</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-ink)');
  });

  // ── hex 替換 ──────────────────────────────────────────

  it('#27396c → var(--q-navy)', () => {
    const input = '<span style="color: #27396c">hex navy</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-navy)');
    expect(normalizeColors(input)).not.toContain('#27396c');
  });

  it('#1a2240 → var(--q-navy-deep)', () => {
    const input = '<span style="color: #1a2240">hex deep navy</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-navy-deep)');
  });

  it('#d6442e → var(--q-coral)', () => {
    const input = '<span style="color: #d6442e">hex coral</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-coral)');
  });

  it('#3b4360 → var(--q-ink-soft)', () => {
    const input = '<span style="color: #3b4360">hex ink soft</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-ink-soft)');
  });

  it('#0f1530 → var(--q-ink)', () => {
    const input = '<span style="color: #0f1530">hex ink</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-ink)');
  });

  // ── 大小寫不敏感 ──────────────────────────────────────

  it('hex 大寫也能替換', () => {
    const input = '<span style="color: #D6442E">UPPER hex</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-coral)');
  });

  it('Color: 大寫也能替換', () => {
    const input = '<span style="Color: #27396c">upper color</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-navy)');
  });

  // ── 多重替換 ──────────────────────────────────────────

  it('同一段 HTML 中多種顏色都被替換', () => {
    const input = `
      <p style="color: rgb(39, 57, 108)">navy</p>
      <p style="color: #d6442e">coral</p>
      <p style="color: rgb(15, 21, 48)">ink</p>
    `;
    const result = normalizeColors(input);
    expect(result).toContain('var(--q-navy)');
    expect(result).toContain('var(--q-coral)');
    expect(result).toContain('var(--q-ink)');
    expect(result).not.toContain('rgb(39, 57, 108)');
    expect(result).not.toContain('#d6442e');
  });

  it('同一顏色出現多次都被替換', () => {
    const input = `
      <span style="color: #27396c">first</span>
      <span style="color: #27396c">second</span>
    `;
    const result = normalizeColors(input);
    // 確認兩處都被替換
    const matches = result.match(/var\(--q-navy\)/g);
    expect(matches).toHaveLength(2);
  });

  // ── rgb 空白容忍 ──────────────────────────────────────

  it('rgb 數字間只允許逗號前後空白（\s*）', () => {
    // regex 用 \s* 只在逗號兩側容忍空白，數字與括號間的空白不被匹配
    const input = '<span style="color: rgb( 39 , 57 , 108 )">spaced</span>';
    // 括號與數字間有空白，不符合 regex，不會被替換
    expect(normalizeColors(input)).toContain('rgb( 39 , 57 , 108 )');
  });

  it('逗號前後有空白可以匹配', () => {
    const input = '<span style="color: rgb(39,  57,  108)">tight-spaced</span>';
    expect(normalizeColors(input)).toContain('color: var(--q-navy)');
  });

  // ── 不該被替換的情境 ──────────────────────────────────

  it('相似但不同的 rgb 值不會被誤替換', () => {
    const input = '<span style="color: rgb(39, 57, 109)">not navy</span>';
    expect(normalizeColors(input)).toContain('rgb(39, 57, 109)');
    expect(normalizeColors(input)).not.toContain('var(--q-navy)');
  });

  it('background-color 不會被替換（負向前瞻排除）', () => {
    const input = '<span style="background-color: #27396c">bg navy</span>';
    expect(normalizeColors(input)).toContain('#27396c');
    expect(normalizeColors(input)).not.toContain('var(--q-navy)');
  });

  it('background-color rgb 也不會被替換', () => {
    const input =
      '<span style="background-color: rgb(214, 68, 46)">bg coral</span>';
    expect(normalizeColors(input)).toContain('rgb(214, 68, 46)');
    expect(normalizeColors(input)).not.toContain('var(--q-coral)');
  });
});
