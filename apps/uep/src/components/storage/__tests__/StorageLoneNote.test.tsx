/**
 * 「一張孤零零的紙條」測試（S9-B 解鎖儀式）
 *
 * 抖落計數、漸進回色、拖曳與點擊的分辨、進度不落地。
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StorageLoneNote from '../StorageLoneNote';

const NOTE = /孤零零的紙條/;

/** 完整一次點擊（沒有位移 → 應判定為點擊而非拖曳） */
function tap(el: HTMLElement) {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 });
}

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom 沒有實作 pointer capture
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => false;
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('抖落灰塵', () => {
  it('初始是塵封狀態，還要拍十下', () => {
    render(<StorageLoneNote onCleaned={vi.fn()} />);
    expect(
      screen.getByLabelText(/還要再拍 10 下/, { selector: '[role="button"]' })
    ).toBeTruthy();
  });

  it('每點一下少一下', () => {
    render(<StorageLoneNote onCleaned={vi.fn()} />);
    const note = screen.getByRole('button', { name: NOTE });

    tap(note);
    expect(note.getAttribute('aria-label')).toContain('還要再拍 9 下');
    tap(note);
    tap(note);
    expect(note.getAttribute('aria-label')).toContain('還要再拍 7 下');
  });

  it('點一下就噴灰塵', () => {
    const { container } = render(<StorageLoneNote onCleaned={vi.fn()} />);
    expect(container.querySelectorAll('.sto-lone-dust-mote')).toHaveLength(0);

    tap(screen.getByRole('button', { name: NOTE }));
    expect(
      container.querySelectorAll('.sto-lone-dust-mote').length
    ).toBeGreaterThan(0);
  });

  it('紙色隨進度往暖黃回', () => {
    render(<StorageLoneNote onCleaned={vi.fn()} />);
    const note = screen.getByRole('button', { name: NOTE });
    const dusty = note.style.getPropertyValue('--sto-lone-paper');

    for (let i = 0; i < 5; i++) tap(note);
    const halfway = note.style.getPropertyValue('--sto-lone-paper');

    expect(halfway).not.toBe(dusty);
    // 灰塵濃度同步下降
    expect(Number(note.style.getPropertyValue('--sto-lone-dust'))).toBeCloseTo(
      0.5
    );
  });

  it('滿十下 → 播完收束動畫才解鎖', () => {
    const onCleaned = vi.fn();
    render(<StorageLoneNote onCleaned={onCleaned} />);
    const note = screen.getByRole('button', { name: NOTE });

    for (let i = 0; i < 10; i++) tap(note);
    // 收束動畫進行中，還沒解鎖
    expect(onCleaned).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onCleaned).toHaveBeenCalledTimes(1);
  });

  it('收束期間繼續點也只解鎖一次', () => {
    const onCleaned = vi.fn();
    render(<StorageLoneNote onCleaned={onCleaned} />);
    const note = screen.getByRole('button', { name: NOTE });

    for (let i = 0; i < 15; i++) tap(note);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onCleaned).toHaveBeenCalledTimes(1);
  });

  it('卸載會取消收束，不回頭解鎖', () => {
    const onCleaned = vi.fn();
    const { unmount } = render(<StorageLoneNote onCleaned={onCleaned} />);
    const note = screen.getByRole('button', { name: NOTE });

    for (let i = 0; i < 10; i++) tap(note);
    unmount();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onCleaned).not.toHaveBeenCalled();
  });

  it('鍵盤 Enter 同樣能拍（純滑鼠互動會擋掉鍵盤使用者）', () => {
    render(<StorageLoneNote onCleaned={vi.fn()} />);
    const note = screen.getByRole('button', { name: NOTE });

    fireEvent.keyDown(note, { key: 'Enter' });
    expect(note.getAttribute('aria-label')).toContain('還要再拍 9 下');
  });
});

describe('拖曳', () => {
  it('超過門檻的位移算拖曳，不算抖落', () => {
    render(<StorageLoneNote onCleaned={vi.fn()} />);
    const note = screen.getByRole('button', { name: NOTE });

    fireEvent.pointerDown(note, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 160, clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 160, clientY: 140, pointerId: 1 });

    expect(note.getAttribute('aria-label')).toContain('還要再拍 10 下');
  });

  it('門檻內的微小抖動仍算點擊', () => {
    render(<StorageLoneNote onCleaned={vi.fn()} />);
    const note = screen.getByRole('button', { name: NOTE });

    fireEvent.pointerDown(note, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 103, clientY: 102, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 103, clientY: 102, pointerId: 1 });

    expect(note.getAttribute('aria-label')).toContain('還要再拍 9 下');
  });

  it('拖曳會改變位置（但不寫進任何持久層）', () => {
    render(<StorageLoneNote onCleaned={vi.fn()} />);
    const note = screen.getByRole('button', { name: NOTE });
    expect(note.style.left).toBe('');

    fireEvent.pointerDown(note, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 200, clientY: 180, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 200, clientY: 180, pointerId: 1 });

    expect(note.style.left).not.toBe('');
    // localStorage 完全沒被碰過——這張紙條不是真便條
    expect(window.localStorage.length).toBe(0);
  });
});
