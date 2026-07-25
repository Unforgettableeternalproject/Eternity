/**
 * EchoesRipple「迷失的回聲」測試（S9-B 解鎖儀式）
 *
 * 只驗灰球那條線——一般球群是純裝飾且靠 CSS 動畫事件回收，不在此涵蓋。
 * 機率靠 stub Math.random 控制（0 = 必中、1 = 必不中）。
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EchoesRipple from '../EchoesRipple';

/** 灰球的無障礙名稱（元件內 aria-label 的前綴） */
const LOST_ORB = /不合群的回聲/;

/** spawn 首次排程在 mount 後 800ms；擲骰就在那一刻 */
function advanceToFirstSpawn() {
  act(() => {
    vi.advanceTimersByTime(900);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('迷失的回聲 — 浮現條件', () => {
  it('播放中 + 有資格 + 擲骰中 → 浮現可點的灰球', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<EchoesRipple isPlaying unlockEligible />);
    advanceToFirstSpawn();
    expect(screen.getByRole('button', { name: LOST_ORB })).toBeTruthy();
  });

  it('擲骰沒中 → 不浮現', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    render(<EchoesRipple isPlaying unlockEligible />);
    advanceToFirstSpawn();
    expect(screen.queryByRole('button', { name: LOST_ORB })).toBeNull();
  });

  it('沒有資格 → 再怎麼擲都不浮現', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<EchoesRipple isPlaying unlockEligible={false} />);
    advanceToFirstSpawn();
    expect(screen.queryByRole('button', { name: LOST_ORB })).toBeNull();
  });

  it('未播放 → 不擲骰（灰球只在音樂響著時出現）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<EchoesRipple isPlaying={false} unlockEligible />);
    advanceToFirstSpawn();
    expect(screen.queryByRole('button', { name: LOST_ORB })).toBeNull();
  });

  it('已浮現時不會再生第二顆', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<EchoesRipple isPlaying unlockEligible />);
    advanceToFirstSpawn();
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(screen.getAllByRole('button', { name: LOST_ORB })).toHaveLength(1);
  });
});

describe('迷失的回聲 — 散去條件', () => {
  it('暫停 → 散去', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { rerender } = render(<EchoesRipple isPlaying unlockEligible />);
    advanceToFirstSpawn();
    expect(screen.getByRole('button', { name: LOST_ORB })).toBeTruthy();

    rerender(<EchoesRipple isPlaying={false} unlockEligible />);
    expect(screen.queryByRole('button', { name: LOST_ORB })).toBeNull();
  });

  it('失去資格（例如島已由別處解鎖）→ 散去', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { rerender } = render(<EchoesRipple isPlaying unlockEligible />);
    advanceToFirstSpawn();

    rerender(<EchoesRipple isPlaying unlockEligible={false} />);
    expect(screen.queryByRole('button', { name: LOST_ORB })).toBeNull();
  });
});

describe('迷失的回聲 — 捕捉', () => {
  it('點擊 → 播完收束動畫才通知呼叫端', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const onCatch = vi.fn();
    render(<EchoesRipple isPlaying unlockEligible onLostOrbCatch={onCatch} />);
    advanceToFirstSpawn();

    fireEvent.click(screen.getByRole('button', { name: LOST_ORB }));
    // 收束動畫進行中——還沒解鎖
    expect(onCatch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onCatch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: LOST_ORB })).toBeNull();
  });

  it('捕捉途中暫停不會奪走已抓到的球', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const onCatch = vi.fn();
    const { rerender } = render(
      <EchoesRipple isPlaying unlockEligible onLostOrbCatch={onCatch} />
    );
    advanceToFirstSpawn();

    fireEvent.click(screen.getByRole('button', { name: LOST_ORB }));
    rerender(
      <EchoesRipple isPlaying={false} unlockEligible onLostOrbCatch={onCatch} />
    );

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onCatch).toHaveBeenCalledTimes(1);
  });

  it('卸載會取消收束，不回頭呼叫解鎖', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const onCatch = vi.fn();
    const { unmount } = render(
      <EchoesRipple isPlaying unlockEligible onLostOrbCatch={onCatch} />
    );
    advanceToFirstSpawn();

    fireEvent.click(screen.getByRole('button', { name: LOST_ORB }));
    unmount();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onCatch).not.toHaveBeenCalled();
  });
});

describe('迷失的回聲 — 無障礙', () => {
  it('不在 aria-hidden 的裝飾層裡', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { container } = render(<EchoesRipple isPlaying unlockEligible />);
    advanceToFirstSpawn();

    const orb = screen.getByRole('button', { name: LOST_ORB });
    expect(orb.closest('[aria-hidden="true"]')).toBeNull();
    // 裝飾層仍該保持 aria-hidden
    expect(container.querySelector('.echoes-ripple')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });
});
