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

import { mobileFadeProgress, MOBILE_FADE_TRIGGER_PROGRESS } from '../HomePage';

/** 與 HomePage 的 gate band 常數對齊 */
const MIN = 0.42;
const MAX = 0.9;
const VH = 1000;

describe('mobileFadeProgress', () => {
  it('目標還沒進入 band —— 完全不暗', () => {
    expect(mobileFadeProgress(MAX * VH + 1, VH)).toBe(0);
    expect(mobileFadeProgress(VH, VH)).toBe(0);
  });

  it('走到 band 尾端 —— 全暗', () => {
    expect(mobileFadeProgress(MIN * VH, VH)).toBe(1);
    expect(mobileFadeProgress(MIN * VH - 200, VH)).toBe(1);
  });

  it('band 中點 —— 一半', () => {
    const mid = (MAX + MIN) / 2;
    expect(mobileFadeProgress(mid * VH, VH)).toBeCloseTo(0.5, 5);
  });

  it('單調遞增：越接近下一區塊越暗', () => {
    const samples = [900, 850, 800, 700, 600, 500, 420].map((top) =>
      mobileFadeProgress(top, VH)
    );
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it('往回滑進度自己退回去——不需要方向鎖', () => {
    const forward = mobileFadeProgress(500, VH);
    const back = mobileFadeProgress(800, VH);
    expect(back).toBeLessThan(forward);
  });

  it('觸發門檻落在 band 尾段，不是一進 band 就轉場', () => {
    // 剛進 band（0.9vh）遠遠不到門檻——這正是原本被抱怨「太早」的位置
    expect(mobileFadeProgress(MAX * VH - 1, VH)).toBeLessThan(
      MOBILE_FADE_TRIGGER_PROGRESS
    );
    // band 走完九成五才過門檻
    const nearEnd = MAX * VH - (MAX - MIN) * VH * 0.95;
    expect(mobileFadeProgress(nearEnd, VH)).toBeGreaterThanOrEqual(
      MOBILE_FADE_TRIGGER_PROGRESS
    );
  });

  it('視窗高度不同時比例一致——用的是 vh 而非絕對 px', () => {
    expect(mobileFadeProgress(0.66 * 800, 800)).toBeCloseTo(
      mobileFadeProgress(0.66 * 1200, 1200),
      5
    );
  });
});
