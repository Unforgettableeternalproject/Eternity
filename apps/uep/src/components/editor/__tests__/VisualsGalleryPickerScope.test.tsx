import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import VisualsGalleryPicker from '../VisualsGalleryPicker';

const TREE = [
  {
    id: 'visuals/illustrations',
    title: '鑲框室',
    pageType: 'section',
    children: [
      {
        id: 'visuals/illustrations/dawn',
        title: '破曉',
        pageType: 'gallery',
        metadata: {
          storyKey: 'ill-dawn',
          images: [
            { id: 'img-1', file: 'images/dawn/1.png', caption: '破曉一' },
            { id: 'img-2', file: 'images/dawn/2.png', caption: '破曉二' },
          ],
        },
      },
      {
        id: 'visuals/illustrations/dusk',
        title: '黃昏',
        pageType: 'gallery',
        metadata: {
          storyKey: 'ill-dusk',
          images: [{ id: 'img-9', file: 'images/dusk/9.png', caption: '黃昏' }],
        },
      },
    ],
  },
];

function mockTreeFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, data: TREE }),
    }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VisualsGalleryPicker — 鎖定單一畫廊（切圖 Gate／預設圖片）', () => {
  it('只列出 clue 指定的畫廊，其他畫廊完全不出現', async () => {
    mockTreeFetch();
    render(
      <VisualsGalleryPicker
        apiBase="http://localhost:8788"
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        selectionMode="image"
        lockedGalleryId="visuals/illustrations/dawn"
      />
    );

    await waitFor(() => expect(screen.getByText('破曉')).toBeInTheDocument());
    expect(screen.queryByText('黃昏')).toBeNull();
    // 鎖定時搜尋框收起（沒有東西好搜）
    expect(screen.queryByPlaceholderText(/搜尋畫廊名稱/)).toBeNull();
  });

  it('未鎖定時維持整份清單', async () => {
    mockTreeFetch();
    render(
      <VisualsGalleryPicker
        apiBase="http://localhost:8788"
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        selectionMode="gallery"
      />
    );

    await waitFor(() => expect(screen.getByText('破曉')).toBeInTheDocument());
    expect(screen.getByText('黃昏')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/搜尋畫廊名稱/)).toBeInTheDocument();
  });

  it('指定的畫廊已不可引用時給出可行動的空狀態', async () => {
    mockTreeFetch();
    render(
      <VisualsGalleryPicker
        apiBase="http://localhost:8788"
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        selectionMode="image"
        lockedGalleryId="visuals/illustrations/gone"
      />
    );

    await waitFor(() =>
      expect(screen.getByText(/已不存在或不再可引用/)).toBeInTheDocument()
    );
  });
});
