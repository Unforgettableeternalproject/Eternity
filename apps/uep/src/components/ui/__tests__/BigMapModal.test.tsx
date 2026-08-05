/**
 * BigMapModal 盤面尺寸測試（S11 A-2）
 *
 * 只釘一件事：**第一次 render 就要是正確尺寸**。
 * 原本初始值寫死 520 再靠 effect 修正，手機上第一幀是一個溢出畫面的
 * 盤面、第二幀才縮回去——那一幀使用者看得見。
 */
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ZONES } from '../../../data/zones';
import BigMapModal from '../BigMapModal';

/** PieMap3D 有 canvas/3D 計算，測尺寸不需要它真的畫出來 */
vi.mock('../../map/PieMap3D', () => ({
  default: ({ size }: { size: number }) => (
    <div data-testid="pie-map" data-size={size} />
  ),
}));

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    configurable: true,
  });
}

afterEach(() => {
  setViewport(originalWidth, originalHeight);
});

function renderAndReadSize(): number {
  const { getByTestId } = render(
    <BigMapModal zones={ZONES} onClose={() => {}} />
  );
  return Number(getByTestId('pie-map').getAttribute('data-size'));
}

describe('BigMapModal 盤面尺寸', () => {
  it('手機寬度下首次 render 即受限於視窗寬度，不是先畫 520', () => {
    setViewport(390, 844);
    // 390 - 36 = 354；高度側 844 - 170 = 674 不是瓶頸
    expect(renderAndReadSize()).toBe(354);
  });

  it('矮視窗由高度側決定，兩軸取較小者', () => {
    setViewport(1200, 500);
    // 高度側 500 - 170 = 330 勝出
    expect(renderAndReadSize()).toBe(330);
  });

  it('桌面寬視窗維持 520 上限', () => {
    setViewport(1920, 1080);
    expect(renderAndReadSize()).toBe(520);
  });

  it('極窄視窗仍保有 260 下限', () => {
    setViewport(240, 300);
    expect(renderAndReadSize()).toBe(260);
  });
});
