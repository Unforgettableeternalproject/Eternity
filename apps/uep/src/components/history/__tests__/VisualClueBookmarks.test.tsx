import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('VisualClueBookmarks — 退場', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('移除的插卡先留下播退場動畫，計時器到才卸載', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <VisualClueBookmarks clues={[clue()]} onClueClick={vi.fn()} />
    );
    rerender(<VisualClueBookmarks clues={[]} onClueClick={vi.fn()} />);

    const leaving = container.querySelector('.uep-clue-card.is-leaving');
    expect(leaving).not.toBeNull();
    // 退場中的卡片不可再被點擊或聚焦
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(container.querySelector('.uep-clue-rail')).toBeNull();
  });

  it('回捲重新進入區間時取消退場，不會同時存在兩份同一張卡', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <VisualClueBookmarks clues={[clue()]} onClueClick={vi.fn()} />
    );
    rerender(<VisualClueBookmarks clues={[]} onClueClick={vi.fn()} />);
    rerender(<VisualClueBookmarks clues={[clue()]} onClueClick={vi.fn()} />);

    expect(container.querySelectorAll('.uep-clue-card')).toHaveLength(1);
    expect(container.querySelector('.uep-clue-card.is-leaving')).toBeNull();

    // 取消後不應被稍晚的計時器再度移除
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(container.querySelectorAll('.uep-clue-card')).toHaveLength(1);
  });
});
