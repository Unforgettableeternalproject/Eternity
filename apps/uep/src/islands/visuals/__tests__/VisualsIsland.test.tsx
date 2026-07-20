/**
 * VisualsIsland 元件測試（S8 下半場 V-C 骨架）
 *
 * 重點驗證資料鏈：
 * - 無投射時顯示空狀態
 * - mount 讀回 window 目前投射（收合再展開續示）
 * - 展開中經 UEP_PHANTOM_SHOW_EVENT 即時切換
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import VisualsIsland from '../VisualsIsland';
import { clearPhantomGallery, pushPhantomGallery } from '../phantomBridge';
import type { PhantomGallery } from '../phantomBridge';

function makeGallery(overrides: Partial<PhantomGallery> = {}): PhantomGallery {
  return {
    id: 'visuals/profiles/cast/heroine',
    title: '女主角設定集',
    entityKey: 'heroine',
    divisionId: 'profiles',
    images: [
      { id: 'img-1', file: 'images/a.png', caption: '正面', sortOrder: 0 },
      { id: 'img-2', file: 'images/b.png', caption: '側面', sortOrder: 1 },
    ],
    source: 'mirror',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  clearPhantomGallery();
});

describe('VisualsIsland（骨架）', () => {
  it('無投射時顯示空狀態', () => {
    render(<VisualsIsland />);
    expect(screen.getByText(/畫框裡還是一片空白/)).toBeTruthy();
  });

  it('mount 時讀回 window 目前投射（收合後展開續示）', () => {
    pushPhantomGallery(makeGallery());
    render(<VisualsIsland />);
    expect(screen.getByText('女主角設定集')).toBeTruthy();
  });

  it('展開中 push 新投射即時切換', () => {
    pushPhantomGallery(makeGallery());
    render(<VisualsIsland />);
    act(() => {
      pushPhantomGallery(
        makeGallery({
          id: 'visuals/illustrations/scenes/dawn',
          title: '黎明的場景',
        })
      );
    });
    expect(screen.getByText('黎明的場景')).toBeTruthy();
  });
});
