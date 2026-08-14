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

  const table = (container: HTMLElement) =>
    container.querySelector('.tt-table')?.getAttribute('src') ?? '';

  it('從沒見過她的人走進來，這裡就只是一張桌子', () => {
    const { container } = render(<TeatimePage />);

    expect(uep()).toBeNull();
    expect(screen.getByText(/其他什麼都沒有/)).toBeTruthy();
    // 她不在的時候連茶壺都不該在桌上
    expect(table(container)).toContain('teatime-table-empty');
  });

  it('見過她之後再回來，敘述才會提到她不在', () => {
    getProgressManager().grantFlags([TEATIME_FLAG]);
    render(<TeatimePage />);

    expect(uep()).toBeNull();
    expect(screen.getByText(/她不在/)).toBeTruthy();
  });

  it('第一次被邀請進來不算「以前見過」——授旗不能早於判讀', () => {
    markTeatimeInvited();
    const first = render(<TeatimePage />);
    expect(screen.getByText(/也倒了一杯/)).toBeTruthy();
    first.unmount();

    // 這一次見過了，所以下一次的空景才輪到「她不在」
    render(<TeatimePage />);
    expect(screen.getByText(/她不在/)).toBeTruthy();
  });

  it('帶著邀請旗標進來時她在桌邊，茶壺也回到桌上', () => {
    markTeatimeInvited();
    const { container } = render(<TeatimePage />);

    expect(uep()).toBeTruthy();
    expect(screen.getByText(/也倒了一杯/)).toBeTruthy();
    expect(table(container)).toContain('teatime-table.webp');
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
