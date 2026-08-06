/**
 * 手機切區塊淡出進度測試（S11 A-5）
 *
 * 手機沒有 wheel delta 可累積，原本一進 gate band 就轉場——閱讀線還在
 * 螢幕中央、當前區塊底部還沒讀到就被帶走，而且轉場是瞬間全黑。
 * 改成 band 前段淡出、尾段才轉場。
 *
 * 進度是捲動位置的純函數（沒有累積量、沒有方向鎖），這裡把邊界釘死。
 */
import { describe, expect, it } from 'vitest';

import {
  mobileFadeProgress,
  mobileUpFadeProgress,
  MOBILE_FADE_TRIGGER_PROGRESS,
} from '../HomePage';

/** 與 HomePage 的淡出區間常數對齊 */
const START = 1.1;
const END = 0.85;
const VH = 1000;

describe('mobileFadeProgress', () => {
  it('下一區塊還在畫面外 —— 完全不暗', () => {
    expect(mobileFadeProgress(START * VH + 1, VH)).toBe(0);
    expect(mobileFadeProgress(1.5 * VH, VH)).toBe(0);
  });

  it('走到區間尾端 —— 全暗', () => {
    expect(mobileFadeProgress(END * VH, VH)).toBe(1);
    expect(mobileFadeProgress(END * VH - 200, VH)).toBe(1);
  });

  it('區間中點 —— 一半', () => {
    const mid = (START + END) / 2;
    expect(mobileFadeProgress(mid * VH, VH)).toBeCloseTo(0.5, 5);
  });

  it('單調遞增：越接近下一區塊越暗', () => {
    const samples = [1150, 1100, 1050, 1000, 950, 900, 850].map((top) =>
      mobileFadeProgress(top, VH)
    );
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it('往回滑進度自己退回去——不需要方向鎖', () => {
    const forward = mobileFadeProgress(900, VH);
    const back = mobileFadeProgress(1050, VH);
    expect(back).toBeLessThan(forward);
  });

  /**
   * 這是本次調整的核心：手機關掉了 scroll snap，捲動可以停在任意位置。
   * 遮罩必須趕在下一區塊露出之前就暗下來，否則半透明的遮罩蓋不住那片空白。
   */
  it('半黑的時候下一區塊幾乎還沒露出', () => {
    // progress 0.5 對應 0.975vh —— 只露出 2.5%
    const halfTop = (START - (START - END) * 0.5) * VH;
    expect(mobileFadeProgress(halfTop, VH)).toBeCloseTo(0.5, 5);
    const revealedRatio = (VH - halfTop) / VH;
    expect(revealedRatio).toBeLessThan(0.05);
  });

  it('觸發時的露出量壓在 15% 以內', () => {
    // 解出 progress 剛好達門檻的位置
    const triggerTop =
      (START - (START - END) * MOBILE_FADE_TRIGGER_PROGRESS) * VH;
    expect(mobileFadeProgress(triggerTop, VH)).toBeCloseTo(
      MOBILE_FADE_TRIGGER_PROGRESS,
      5
    );
    expect((VH - triggerTop) / VH).toBeLessThan(0.15);
  });

  it('視窗高度不同時比例一致——用的是 vh 而非絕對 px', () => {
    expect(mobileFadeProgress(0.95 * 800, 800)).toBeCloseTo(
      mobileFadeProgress(0.95 * 1200, 1200),
      5
    );
  });
});

/**
 * 往回捲的鏡像版本。
 *
 * 往上原本是硬門檻（頂緣下沉超過 0.16vh 就直接轉場），同一個手勢在
 * 兩個方向上質感不同——往下漸暗、往上啪一下。
 *
 * 幾何是不對稱的：往下時下一區塊還在畫面外，有跑道可以先暗起來；
 * 往上時手指一動，上一區塊立刻開始露出，沒有跑道。所以起點固定在 0。
 */
const UP_END = 0.16;

describe('mobileUpFadeProgress', () => {
  it('頂緣還在視窗頂之上 —— 完全不暗（人還在區塊內往上讀）', () => {
    expect(mobileUpFadeProgress(-100, VH)).toBe(0);
    expect(mobileUpFadeProgress(0, VH)).toBe(0);
  });

  it('下沉滿一個區間 —— 全暗', () => {
    expect(mobileUpFadeProgress(UP_END * VH, VH)).toBe(1);
    expect(mobileUpFadeProgress(UP_END * VH + 500, VH)).toBe(1);
  });

  it('區間中點 —— 一半', () => {
    expect(mobileUpFadeProgress((UP_END / 2) * VH, VH)).toBeCloseTo(0.5, 5);
  });

  it('單調遞增：頂緣沉得越深越暗', () => {
    const samples = [0, 20, 60, 100, 140, 160].map((top) =>
      mobileUpFadeProgress(top, VH)
    );
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it('改變方向進度自己退回去——與往下同一個性質', () => {
    expect(mobileUpFadeProgress(40, VH)).toBeLessThan(
      mobileUpFadeProgress(120, VH)
    );
  });

  /* 兩個方向的「全黑時露出多少」要對齊，否則同一頁的兩種轉場看起來
     像兩套不同的東西 */
  it('觸發時的露出量與往下那組相當（都在 16% 以內）', () => {
    const triggerTop = UP_END * MOBILE_FADE_TRIGGER_PROGRESS * VH;
    expect(mobileUpFadeProgress(triggerTop, VH)).toBeCloseTo(
      MOBILE_FADE_TRIGGER_PROGRESS,
      5
    );
    expect(triggerTop / VH).toBeLessThan(0.16);
  });

  it('視窗高度不同時比例一致', () => {
    expect(mobileUpFadeProgress(0.08 * 800, 800)).toBeCloseTo(
      mobileUpFadeProgress(0.08 * 1200, 1200),
      5
    );
  });
});
