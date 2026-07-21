import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import VisualClueBookmarks from '../VisualClueBookmarks';
import type { VisualClueEntry } from '../useVisualClues';

vi.mock('../../../lib/apiBase', () => ({
  getApiBase: () => 'http://localhost:8788',
}));

function clue(patch: Partial<VisualClueEntry> = {}): VisualClueEntry {
  return {
    clueId: 'clue-1',
    targetType: 'entity',
    targetKey: 'hero',
    galleryId: 'visuals/profiles/hero',
    title: '測試畫廊',
    imageId: 'portrait',
    imageTitle: '角色肖像',
    imageFile: 'images/profiles/hero/portrait one.png',
    startEl: document.createElement('div'),
    endEl: document.createElement('div'),
    ...patch,
  };
}

describe('VisualClueBookmarks — Gallery 預設圖片縮圖', () => {
  it('書籤顯示預設圖片的 R2 縮圖，不使用 placeholder', () => {
    const { container } = render(
      <VisualClueBookmarks clues={[clue()]} onClueClick={vi.fn()} />
    );
    const image = container.querySelector('.uep-clue-card__thumb img');
    expect(image).toHaveAttribute(
      'src',
      'http://localhost:8788/api/assets/images/profiles/hero/portrait%20one.png'
    );
    expect(container.querySelector('.uep-clue-card__glyph')).toBeNull();
  });

  it('點擊仍回傳 Gallery Clue 本身，Image Gate 不產生額外書籤', () => {
    const onClueClick = vi.fn();
    render(<VisualClueBookmarks clues={[clue()]} onClueClick={onClueClick} />);
    screen.getByRole('button', { name: '檢視插圖：測試畫廊' }).click();
    expect(onClueClick).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
