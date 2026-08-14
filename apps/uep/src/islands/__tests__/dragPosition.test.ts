import { beforeEach, describe, expect, it } from 'vitest';

import { resolveCornerPosition } from '../dragPosition';

describe('resolveCornerPosition', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    });
  });

  it('左右中央錨點會垂直置中並保留固定邊距', () => {
    expect(resolveCornerPosition('center-left', 300, 200)).toEqual({
      left: 20,
      top: 300,
    });
    expect(resolveCornerPosition('center-right', 300, 200)).toEqual({
      left: 880,
      top: 300,
    });
  });

  it('內容比 viewport 高時會 clamp，不從螢幕上方溢出', () => {
    expect(resolveCornerPosition('bottom-right', 300, 900)).toEqual({
      left: 880,
      top: 8,
    });
  });
});
