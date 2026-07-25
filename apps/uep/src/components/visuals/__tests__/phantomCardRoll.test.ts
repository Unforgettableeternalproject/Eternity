/**
 * 「不在目錄中的畫廊」浮現規則測試（S9-B 解鎖儀式）
 */

import { describe, expect, it } from 'vitest';

import {
  PHANTOM_GALLERY_CHANCE,
  shouldRevealPhantomCard,
} from '../phantomCardRoll';
import type { PhantomRollInput } from '../phantomCardRoll';

/** 預設：一切條件齊備、擲骰必中 */
function input(partial: Partial<PhantomRollInput> = {}): PhantomRollInput {
  return {
    prev: { subcatId: 'sub-a', groupIdx: 0 },
    current: { subcatId: 'sub-a', groupIdx: 1 },
    eligible: true,
    groupCount: 3,
    alreadyWon: false,
    random: () => 0,
    ...partial,
  };
}

describe('shouldRevealPhantomCard', () => {
  it('條件齊備 + 擲骰中 → 浮現', () => {
    expect(shouldRevealPhantomCard(input())).toBe(true);
  });

  it('擲骰沒中 → 不浮現', () => {
    expect(shouldRevealPhantomCard(input({ random: () => 0.99 }))).toBe(false);
  });

  it('機率邊界：剛好等於門檻不算中', () => {
    expect(
      shouldRevealPhantomCard(input({ random: () => PHANTOM_GALLERY_CHANCE }))
    ).toBe(false);
  });

  it('首次進入（沒有上一次位置）不算切換標籤', () => {
    expect(shouldRevealPhantomCard(input({ prev: null }))).toBe(false);
  });

  it('換 subcat 不算切換標籤——那是換區塊', () => {
    expect(
      shouldRevealPhantomCard(
        input({
          prev: { subcatId: 'sub-a', groupIdx: 0 },
          current: { subcatId: 'sub-b', groupIdx: 0 },
        })
      )
    ).toBe(false);
  });

  it('位置沒變（重渲染）不擲骰', () => {
    expect(
      shouldRevealPhantomCard(
        input({
          prev: { subcatId: 'sub-a', groupIdx: 1 },
          current: { subcatId: 'sub-a', groupIdx: 1 },
        })
      )
    ).toBe(false);
  });

  it('不在 subcat 頁 → 不浮現', () => {
    expect(shouldRevealPhantomCard(input({ current: null }))).toBe(false);
  });

  it('沒有解鎖資格 → 不浮現', () => {
    expect(shouldRevealPhantomCard(input({ eligible: false }))).toBe(false);
  });

  it('只有一個分類標籤的區塊 → 不浮現（艾斯維爾明確限定）', () => {
    expect(shouldRevealPhantomCard(input({ groupCount: 1 }))).toBe(false);
  });

  it('已經中過 → 不再擲', () => {
    expect(shouldRevealPhantomCard(input({ alreadyWon: true }))).toBe(false);
  });

  it('往回切標籤同樣算切換', () => {
    expect(
      shouldRevealPhantomCard(
        input({
          prev: { subcatId: 'sub-a', groupIdx: 2 },
          current: { subcatId: 'sub-a', groupIdx: 1 },
        })
      )
    ).toBe(true);
  });
});
