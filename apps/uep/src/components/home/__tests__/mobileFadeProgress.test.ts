/**
 * 手機切區塊淡出進度測試（S11 A-5）
 *
 * 手機沒有 wheel delta 可累積，原本一進 gate band 就轉場——閱讀線還在
 * 螢幕中央、當前區塊底部還沒讀到就被帶走，而且轉場是瞬間全黑。
 * 改成 band 前段淡出、尾段才轉場。
 *
 * 進度是捲動位置的純函數（沒有累積量、沒有方向鎖），這裡把邊界釘死。
 *
 * ⚠️ 區間**依當前區塊的高度而定**，不是固定的 vh 比例。實測手機各段高度
 * 差了兩倍以上（以捲動容器高為單位：導覽 0.86、Atlas 1.00、Verse 1.10、
 * zone 區塊 2.11），用同一組常數會讓矮的那幾段靜止時就已經滿格。
 */
import { describe, expect, it } from 'vitest';

import {
  mobileFadeProgress,
  mobileUpFadeProgress,
  MOBILE_FADE_TRIGGER_PROGRESS,
} from '../HomePage';

/** 捲動容器的高度（不是 window.innerHeight——兩者差一個 topbar） */
const VIEW = 789;
/** 實測的 zone 區塊高度：比視窗高，接縫進畫面前有跑道 */
const TALL = 1662;
/** 實測的導覽區塊高度：比視窗矮，沒有跑道 */
const SHORT = 681;

describe('mobileFadeProgress — 區塊比視窗高（有跑道）', () => {
  const p = (top: number) => mobileFadeProgress(top, VIEW, TALL);

  it('靜止對齊時完全不暗', () => {
    expect(p(TALL)).toBe(0);
  });

  it('接縫還沒進畫面就已經全暗', () => {
    expect(p(VIEW)).toBe(1);
    expect(p(VIEW - 100)).toBe(1);
  });

  it('單調遞增', () => {
    const samples = [1600, 1400, 1250, 1100, 950, 800, 780].map(p);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it('往回滑進度自己退回去——不需要方向鎖', () => {
    expect(p(1250)).toBeLessThan(p(900));
  });

  it('觸發轉場時接縫也還沒露出', () => {
    // 解出剛好達門檻的位置，必須仍在視窗底緣之下
    const start = Math.min(TALL, VIEW * 1.55);
    const triggerTop = start - (start - VIEW) * MOBILE_FADE_TRIGGER_PROGRESS;
    expect(p(triggerTop)).toBeCloseTo(MOBILE_FADE_TRIGGER_PROGRESS, 5);
    expect(triggerTop).toBeGreaterThan(VIEW);
  });
});

/* 導覽區塊（0.86 個容器高）曾經整個沒有淡出：固定區間的終點比它的靜止
   位置還遠，進度恆為 1，第一次捲動就直接轉場。 */
describe('mobileFadeProgress — 區塊比視窗矮（沒有跑道）', () => {
  const p = (top: number) => mobileFadeProgress(top, VIEW, SHORT);

  it('靜止對齊時仍然完全不暗——這是先前壞掉的那一項', () => {
    expect(p(SHORT)).toBe(0);
  });

  it('不是瞬間跳到全暗，中間有真正的漸變', () => {
    const mid = p(SHORT * 0.78);
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.9);
  });

  it('走到區塊高度的一半略多就全暗', () => {
    expect(p(SHORT * 0.55)).toBe(1);
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
    expect(mobileUpFadeProgress(0, VIEW)).toBe(0);
    expect(mobileUpFadeProgress(-0.8 * VIEW, VIEW)).toBe(0);
  });

  it('切齊時的進度遠低於觸發門檻', () => {
    expect(mobileUpFadeProgress(0, VIEW)).toBeLessThan(
      MOBILE_FADE_TRIGGER_PROGRESS
    );
  });

  it('接縫露出一小段就全暗', () => {
    expect(mobileUpFadeProgress(UP_END * VIEW, VIEW)).toBe(1);
    expect(mobileUpFadeProgress(0.5 * VIEW, VIEW)).toBe(1);
  });

  it('區間中點 —— 一半', () => {
    const mid = (UP_START + UP_END) / 2;
    expect(mobileUpFadeProgress(mid * VIEW, VIEW)).toBeCloseTo(0.5, 5);
  });

  it('單調遞增：頂緣沉得越深越暗', () => {
    const samples = [-300, -100, 0, 20, 50, 80, 100].map((top) =>
      mobileUpFadeProgress(top, VIEW)
    );
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it('改變方向進度自己退回去——與往下同一個性質', () => {
    expect(mobileUpFadeProgress(20, VIEW)).toBeLessThan(
      mobileUpFadeProgress(70, VIEW)
    );
  });

  /* 往上沒有畫面外的跑道，註定會看到一點接縫，只能讓那一段夠短 */
  it('觸發轉場時的露出量壓在 10% 以內', () => {
    const triggerTop =
      (UP_START + (UP_END - UP_START) * MOBILE_FADE_TRIGGER_PROGRESS) * VIEW;
    expect(mobileUpFadeProgress(triggerTop, VIEW)).toBeCloseTo(
      MOBILE_FADE_TRIGGER_PROGRESS,
      5
    );
    expect(triggerTop / VIEW).toBeLessThan(0.1);
  });

  it('視窗高度不同時比例一致', () => {
    expect(mobileUpFadeProgress(0.05 * 800, 800)).toBeCloseTo(
      mobileUpFadeProgress(0.05 * 1200, 1200),
      5
    );
  });
});
