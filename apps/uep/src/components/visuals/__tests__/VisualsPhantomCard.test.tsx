/**
 * 「不在目錄中的畫廊」卡片測試（S9-B 解鎖儀式）
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import VisualsPhantomCard from '../VisualsPhantomCard';

const CARD = /不在目錄中的畫廊/;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('VisualsPhantomCard', () => {
  it('渲染成一張可點的卡片', () => {
    render(<VisualsPhantomCard onOpen={vi.fn()} />);
    const card = screen.getByRole('button', { name: CARD });
    expect(card).toBeTruthy();
    expect(card).not.toBeDisabled();
  });

  it('點擊 → 播完顯影動畫才通知呼叫端', () => {
    const onOpen = vi.fn();
    render(<VisualsPhantomCard onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: CARD }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText('正在顯影……')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('顯影中不能重複點擊', () => {
    const onOpen = vi.fn();
    render(<VisualsPhantomCard onOpen={onOpen} />);
    const card = screen.getByRole('button', { name: CARD });

    fireEvent.click(card);
    fireEvent.click(card);
    fireEvent.click(card);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('卸載會取消顯影，不回頭呼叫解鎖', () => {
    const onOpen = vi.fn();
    const { unmount } = render(<VisualsPhantomCard onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: CARD }));
    unmount();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
