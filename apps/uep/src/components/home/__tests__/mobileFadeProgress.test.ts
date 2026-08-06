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
const START = 1.45;
const END = 1.02;
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
    const samples = [1300, 1220, 1150, 1100, 1050, 1000, 950].map((top) =>
      mobileFadeProgress(top, VH)
    );
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it('往回滑進度自己退回去——不需要方向鎖', () => {
    const forward = mobileFadeProgress(1050, VH);
    const back = mobileFadeProgress(1250, VH);
    expect(back).toBeLessThan(forward);
  });

  /**
   * 這是本次調整的核心：手機關掉了 scroll snap，捲動可以停在任意位置。
   * 遮罩必須趕在下一區塊露出之前就暗下來，否則半透明的遮罩蓋不住那片空白。
   */
  /* 全黑必須發生在接縫進畫面之前。前一版終點放在 0.85vh（露出 15% 才
     全黑），實測仍看得到邊界——遮罩淡入本身有時間差，等到「快全黑」時
     接縫早就露出來了。現在終點 1.02vh 還在視窗底緣之下。 */
  it('全黑時下一區塊還完全在視窗之外', () => {
    expect(END).toBeGreaterThan(1);
    expect(mobileFadeProgress(END * VH, VH)).toBe(1);
  });

  it('觸發轉場時接縫也還沒露出', () => {
    const triggerTop =
      (START - (START - END) * MOBILE_FADE_TRIGGER_PROGRESS) * VH;
    expect(mobileFadeProgress(triggerTop, VH)).toBeCloseTo(
      MOBILE_FADE_TRIGGER_PROGRESS,
      5
    );
    expect(triggerTop).toBeGreaterThan(VH);
  });

  /* 靜止對齊時 nextTop 等於當前區塊的高度。實測手機各區塊高
     1.70～2.15vh，起點必須明顯低於最矮的那個，否則一停下來就半黑。 */
  it('起點低於實測最矮的區塊高度（1.70vh）', () => {
    expect(START).toBeLessThan(1.7);
    expect(mobileFadeProgress(1.7 * VH, VH)).toBe(0);
  });

  it('視窗高度不同時比例一致——用的是 vh 而非絕對 px', () => {
    expect(mobileFadeProgress(1.2 * 800, 800)).toBeCloseTo(
      mobileFadeProgress(1.2 * 1200, 1200),
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
const UP_START = 0;
const UP_END = 0.1;

describe('mobileUpFadeProgress', () => {
  /* 起點取負值曾經是個真 bug：頂緣切齊就是每個區塊的靜止位置，
     那時進度接近 1 代表停著就半黑，而且超過觸發門檻——往上捲到區塊
     頂端的那一刻會被直接丟進上一個區塊。 */
  it('頂緣切齊視窗頂時完全不暗 —— 那是靜止位置', () => {
    expect(mobileUpFadeProgress(0, VH)).toBe(0);
    expect(mobileUpFadeProgress(-0.8 * VH, VH)).toBe(0);
  });

  it('切齊時的進度遠低於觸發門檻', () => {
    expect(mobileUpFadeProgress(0, VH)).toBeLessThan(
      MOBILE_FADE_TRIGGER_PROGRESS
    );
  });

  it('接縫露出一小段就全暗', () => {
    expect(mobileUpFadeProgress(UP_END * VH, VH)).toBe(1);
    expect(mobileUpFadeProgress(0.5 * VH, VH)).toBe(1);
  });

  it('區間中點 —— 一半', () => {
    const mid = (UP_START + UP_END) / 2;
    expect(mobileUpFadeProgress(mid * VH, VH)).toBeCloseTo(0.5, 5);
  });

  it('單調遞增：頂緣沉得越深越暗', () => {
    const samples = [-300, -100, 0, 20, 50, 80, 100].map((top) =>
      mobileUpFadeProgress(top, VH)
    );
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it('改變方向進度自己退回去——與往下同一個性質', () => {
    expect(mobileUpFadeProgress(20, VH)).toBeLessThan(
      mobileUpFadeProgress(70, VH)
    );
  });

  /* 往上沒有畫面外的跑道，註定會看到一點接縫，只能讓那一段夠短 */
  it('觸發轉場時的露出量壓在 10% 以內', () => {
    const triggerTop =
      (UP_START + (UP_END - UP_START) * MOBILE_FADE_TRIGGER_PROGRESS) * VH;
    expect(mobileUpFadeProgress(triggerTop, VH)).toBeCloseTo(
      MOBILE_FADE_TRIGGER_PROGRESS,
      5
    );
    expect(triggerTop / VH).toBeLessThan(0.1);
  });

  it('視窗高度不同時比例一致', () => {
    expect(mobileUpFadeProgress(0.05 * 800, 800)).toBeCloseTo(
      mobileUpFadeProgress(0.05 * 1200, 1200),
      5
    );
  });
});
