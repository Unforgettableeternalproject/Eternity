/**
 * 「不在目錄中的畫廊」浮現規則測試（S9-B 解鎖儀式）
 *
 * 2026-07-25 起規則放寬：每個區塊都擲得到（進入時低機率），切標籤是加碼。
 * 原本「只有切標籤才擲、且限兩個標籤以上」的設計，讓單標籤區塊成為解不開
 * 的死路——當時仰賴的 fallback 小物件已經移除。
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  PHANTOM_ENTER_CHANCE,
  PHANTOM_SWITCH_CHANCE,
  shouldRevealPhantomCard,
} from '../phantomCardRoll';
import type { PhantomRollInput } from '../phantomCardRoll';

/** 預設：同一區塊內切換標籤、條件齊備、擲骰必中 */
function input(partial: Partial<PhantomRollInput> = {}): PhantomRollInput {
  return {
    prev: { subcatId: 'sub-a', groupIdx: 0 },
    current: { subcatId: 'sub-a', groupIdx: 1 },
    eligible: true,
    alreadyWon: false,
    random: () => 0,
    ...partial,
  };
}

describe('shouldRevealPhantomCard', () => {
  it('切換標籤 + 擲骰中 → 浮現', () => {
    expect(shouldRevealPhantomCard(input())).toBe(true);
  });

  it('擲骰沒中 → 不浮現', () => {
    expect(shouldRevealPhantomCard(input({ random: () => 0.99 }))).toBe(false);
  });

  it('機率邊界：剛好等於門檻不算中', () => {
    expect(
      shouldRevealPhantomCard(input({ random: () => PHANTOM_SWITCH_CHANCE }))
    ).toBe(false);
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

  describe('進入區塊也擲得到（單標籤區塊不再是死路）', () => {
    it('首次進入 → 以進入機率擲骰', () => {
      expect(shouldRevealPhantomCard(input({ prev: null }))).toBe(true);
    });

    it('換到另一個區塊 → 以進入機率擲骰', () => {
      expect(
        shouldRevealPhantomCard(
          input({
            prev: { subcatId: 'sub-a', groupIdx: 0 },
            current: { subcatId: 'sub-b', groupIdx: 0 },
          })
        )
      ).toBe(true);
    });

    it('進入的機率低於切標籤：落在兩者之間時只有切標籤會中', () => {
      const between = (PHANTOM_ENTER_CHANCE + PHANTOM_SWITCH_CHANCE) / 2;
      expect(
        shouldRevealPhantomCard(input({ prev: null, random: () => between }))
      ).toBe(false);
      expect(shouldRevealPhantomCard(input({ random: () => between }))).toBe(
        true
      );
    });
  });

  it('不在 subcat 頁 → 不浮現', () => {
    expect(shouldRevealPhantomCard(input({ current: null }))).toBe(false);
  });

  it('沒有解鎖資格 → 不浮現', () => {
    expect(shouldRevealPhantomCard(input({ eligible: false }))).toBe(false);
  });

  it('已經中過 → 不再擲', () => {
    expect(shouldRevealPhantomCard(input({ alreadyWon: true }))).toBe(false);
  });
});

describe('機率走站台設定', () => {
  afterEach(() => {
    delete window.__uepSettings;
  });

  it('進入與切標籤各吃自己的鍵（設定以整數百分比存放）', () => {
    window.__uepSettings = {
      'visuals.phantomEnterChancePct': 50,
      'visuals.phantomSwitchChancePct': 90,
    };
    // 0.6 在進入機率之上、切標籤機率之下
    expect(shouldRevealPhantomCard(input({ random: () => 0.6 }))).toBe(true);
    expect(
      shouldRevealPhantomCard(
        input({
          prev: null,
          current: { subcatId: 'sub-a', groupIdx: 0 },
          random: () => 0.6,
        })
      )
    ).toBe(false);
  });

  it('設定未載入時退回常數', () => {
    // 0.1 高於預設的 0.08 進入機率、低於 0.18 切標籤機率
    expect(shouldRevealPhantomCard(input({ random: () => 0.1 }))).toBe(true);
    expect(
      shouldRevealPhantomCard(
        input({
          prev: null,
          current: { subcatId: 'sub-a', groupIdx: 0 },
          random: () => 0.1,
        })
      )
    ).toBe(false);
  });

  it('設 0 = 關掉這座島的儀式', () => {
    window.__uepSettings = {
      'visuals.phantomEnterChancePct': 0,
      'visuals.phantomSwitchChancePct': 0,
    };
    expect(shouldRevealPhantomCard(input({ random: () => 0 }))).toBe(false);
  });
});
