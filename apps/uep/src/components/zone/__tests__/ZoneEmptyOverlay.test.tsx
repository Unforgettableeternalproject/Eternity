/**
 * ZoneEmptyOverlay 渲染測試
 *
 * 三種施工變體與 sealed 都必須同時呈現圖、標題與說明文字；
 * 底層主內容保留在 DOM 中但不可互動。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ZoneEmptyOverlay } from '../ZoneEmptyOverlay';
import {
  CONSTRUCTION_COPY,
  CONSTRUCTION_VARIANTS,
  EMPTY_STATE_ART,
  pickConstructionVariant,
  pickSealedCopy,
} from '../zoneEmptyState';
import type { ConstructionVariant } from '../zoneEmptyState';

function seedFor(variant: ConstructionVariant): string {
  for (let i = 0; i < 500; i++) {
    const seed = `visuals:subcat-${i}`;
    if (pickConstructionVariant(seed) === variant) return seed;
  }
  throw new Error(`找不到對應 ${variant} 的 seed`);
}

describe('ZoneEmptyOverlay', () => {
  it.each(CONSTRUCTION_VARIANTS)(
    '建設中變體 %s：圖、標題與說明一起渲染',
    (variant) => {
      const { container } = render(
        <ZoneEmptyOverlay kind="construction" seed={seedFor(variant)} />
      );
      const copy = CONSTRUCTION_COPY[variant];
      expect(screen.getByText(copy.title)).toBeTruthy();
      expect(screen.getByText(copy.subtitle)).toBeTruthy();
      expect(screen.getByText(/建設中/)).toBeTruthy();
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBe(EMPTY_STATE_ART[variant]);
    }
  );

  it('sealed：Exera 圖與親民文案', () => {
    const seed = 'echoes:echoes/stories/a';
    const { container } = render(
      <ZoneEmptyOverlay kind="sealed" seed={seed} />
    );
    const copy = pickSealedCopy(seed);
    expect(screen.getByText(copy.title)).toBeTruthy();
    expect(screen.getByText(copy.subtitle)).toBeTruthy();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      EMPTY_STATE_ART.sealed
    );
  });

  it('底層主內容保留但設為 inert / aria-hidden', () => {
    const { container } = render(
      <ZoneEmptyOverlay kind="construction" seed="concepts:x">
        <p>原本的介紹文</p>
      </ZoneEmptyOverlay>
    );
    const under = container.querySelector('.zone-empty__under');
    expect(under?.textContent).toContain('原本的介紹文');
    expect(under?.hasAttribute('inert')).toBe(true);
    expect(under?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('kind 為 null 時原樣渲染、不加任何包裝', () => {
    const { container } = render(
      <ZoneEmptyOverlay kind={null} seed="storage:x">
        <p>可見內容</p>
      </ZoneEmptyOverlay>
    );
    expect(container.querySelector('.zone-empty')).toBeNull();
    expect(container.innerHTML).toBe('<p>可見內容</p>');
  });
});
