/**
 * 保護遮罩的兩種面孔（S11）
 *
 * 擲骰本身很短，但它讀的是站台設定而不是寫死的常數，而「0 = 永遠只有文字」
 * 與「100 = 永遠是立繪」是後台說明上寫給營運看的承諾。
 */
import { describe, it, expect, afterEach } from 'vitest';

import { rollProtectionVariant } from '../content-protection';

const setChance = (pct: number) => {
  window.__uepSettings = { 'protection.noChancePct': pct };
};

/** 讓亂數回傳可預期值，避免用真亂數測邊界 */
const fixed = (v: number) => () => v;

describe('rollProtectionVariant', () => {
  afterEach(() => {
    delete window.__uepSettings;
  });

  it('設定未載入時退回程式碼預設的一成', () => {
    expect(rollProtectionVariant(fixed(0.05))).toBe('art');
    expect(rollProtectionVariant(fixed(0.15))).toBe('text');
  });

  it('0 = 永遠只有文字，連最有利的亂數也不放行', () => {
    setChance(0);
    expect(rollProtectionVariant(fixed(0))).toBe('text');
  });

  it('100 = 永遠是立繪', () => {
    setChance(100);
    expect(rollProtectionVariant(fixed(0.999))).toBe('art');
  });

  it('邊界是左閉右開：剛好等於門檻算沒中', () => {
    setChance(30);
    expect(rollProtectionVariant(fixed(0.3))).toBe('text');
    expect(rollProtectionVariant(fixed(0.2999))).toBe('art');
  });
});
