/**
 * 茶會頁（S11 彩蛋）
 *
 * 要釘的是「有人／沒人」這條分岔，以及旗標消費即清——後者一旦漏掉，
 * 沒被邀請的人也會看到她，那時症狀是彩蛋壞掉而不是彩蛋。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { markTeatimeInvited, TEATIME_FLAG } from '../../../lib/teatime';
import { getProgressManager } from '../../../progress';
import TeatimePage from '../TeatimePage';

const uep = () => screen.queryByAltText('U.E.P 舉起茶杯');

describe('TeatimePage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    getProgressManager().revokeFlags([TEATIME_FLAG]);
  });

  it('沒有旗標時只有桌子與「這裡沒有人」的敘述', () => {
    render(<TeatimePage />);

    expect(uep()).toBeNull();
    expect(screen.getByText(/只有一張桌子/)).toBeTruthy();
  });

  it('帶著邀請旗標進來時她在桌邊', () => {
    markTeatimeInvited();
    render(<TeatimePage />);

    expect(uep()).toBeTruthy();
    expect(screen.getByText(/也倒了一杯/)).toBeTruthy();
  });

  it('旗標消費即清：重新進來就退回空景', () => {
    markTeatimeInvited();
    const first = render(<TeatimePage />);
    expect(uep()).toBeTruthy();
    first.unmount();

    render(<TeatimePage />);
    expect(uep()).toBeNull();
  });

  it('見到她時留下 uep:teatime 旗標', () => {
    markTeatimeInvited();
    render(<TeatimePage />);

    expect(getProgressManager().hasFlag(TEATIME_FLAG)).toBe(true);
  });

  it('空景不授旗——那一次什麼都沒發生過', () => {
    render(<TeatimePage />);

    expect(getProgressManager().hasFlag(TEATIME_FLAG)).toBe(false);
  });

  it('兩幀都在 DOM 裡——切換是 CSS 動畫的事，不是條件渲染', () => {
    markTeatimeInvited();
    const { container } = render(<TeatimePage />);

    expect(container.querySelectorAll('.tt-frame')).toHaveLength(2);
  });
});
