/**
 * 404 頁面測試
 *
 * 重點在兩個變體的互斥與擲骰時機：文字版是 SSR 產出的那一份，立繪版只在
 * mount 後才可能換上。兩者同時在場等於把同一件事講兩次（見遮罩的設計註解）。
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import NotFoundPage from '../NotFoundPage';

const rollMock = vi.hoisted(() => vi.fn(() => 'text'));

vi.mock('../../../scripts/content-protection', () => ({
  PROTECT_ART: '/uep/art/protect-no.webp',
  PROTECT_ART_SIZE: { width: 1200, height: 1187 },
  rollProtectionVariant: rollMock,
}));

beforeEach(() => {
  rollMock.mockReturnValue('text');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotFoundPage', () => {
  it('文字版：顯示觀測失效字樣，不出現立繪', () => {
    const { container } = render(<NotFoundPage />);
    expect(screen.getByText('觀測失效')).toBeInTheDocument();
    expect(screen.getByText('Observation Failed')).toBeInTheDocument();
    expect(container.querySelector('.uep-nf__art')).toBeNull();
  });

  it('立繪版：擲中時字樣讓位給立繪', () => {
    rollMock.mockReturnValue('art');
    const { container } = render(<NotFoundPage />);
    expect(container.querySelector('.uep-nf__art img')).toHaveAttribute(
      'src',
      '/uep/art/protect-no.webp'
    );
    expect(screen.queryByText('觀測失效')).not.toBeInTheDocument();
  });

  it('無論哪一種變體都留著返回入口——這頁是死路，沒有出口就是把讀者關在裡面', () => {
    rollMock.mockReturnValue('art');
    render(<NotFoundPage />);
    expect(screen.getByText('返回入口')).toHaveAttribute('href', '/');
  });
});
