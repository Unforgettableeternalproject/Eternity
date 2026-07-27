import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import IslandDock from '../IslandDock';
import { clearAllChipAttention, markChipAttention } from '../chipAttention';
import { setEchoSpotWaiting } from '../echoes/echoPreview';

const open = vi.hoisted(() => vi.fn());

vi.mock('../islandRuntime', () => ({
  getIslandRuntime: () => ({ open }),
}));

vi.mock('../useIslands', () => ({
  useIslandRuntimeState: () => ({
    windows: { echoes: { open: false } },
    focusOrder: [],
  }),
  useZoneEntryActive: () => false,
}));

vi.mock('../concepts/useTerminalUnread', () => ({
  useTerminalUnread: () => 0,
}));

describe('IslandDock — Echo Spot 等待提示', () => {
  beforeEach(() => {
    open.mockClear();
    setEchoSpotWaiting(false);
  });

  it('收合期間有 pending Echo Spot 時，Echoes chip 閃爍並提供語意標籤', () => {
    setEchoSpotWaiting(true);
    render(<IslandDock unlockedIds={['echoes']} />);

    const chip = screen.getByRole('button', {
      name: '展開流浪回聲（有回聲等待中）',
    });
    expect(chip).toHaveClass('is-attn-waiting');

    act(() => setEchoSpotWaiting(false));
    expect(chip).not.toHaveClass('is-attn-waiting');
  });
});

describe('IslandDock — 標記式提示樣式與 chip 屬性（S9-D）', () => {
  beforeEach(() => {
    open.mockClear();
    clearAllChipAttention();
    setEchoSpotWaiting(false);
  });

  afterEach(() => {
    clearAllChipAttention();
    setEchoSpotWaiting(false);
  });

  it('標記式提示套用 is-attn-waiting class，chip 帶 data-island 屬性', () => {
    markChipAttention('echoes', '閱讀進度已更新');
    render(<IslandDock unlockedIds={['echoes']} />);

    const chip = screen.getByRole('button', {
      name: '展開流浪回聲（閱讀進度已更新）',
    });
    expect(chip).toHaveClass('is-attn-waiting');
    expect(chip).toHaveAttribute('data-island', 'echoes');
  });

  it('標記不會自己過期，chip 持續帶著提示', () => {
    vi.useFakeTimers();
    markChipAttention('echoes', '閱讀進度已更新');
    render(<IslandDock unlockedIds={['echoes']} />);

    const chip = screen.getByRole('button', {
      name: '展開流浪回聲（閱讀進度已更新）',
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(chip).toHaveClass('is-attn-waiting');
    vi.useRealTimers();
  });

  it('衍生型與標記型同時成立時，說明取衍生型的', () => {
    setEchoSpotWaiting(true);
    markChipAttention('echoes', '剛剛有東西動了');
    render(<IslandDock unlockedIds={['echoes']} />);

    const chip = screen.getByRole('button', {
      name: '展開流浪回聲（有回聲等待中）',
    });
    expect(chip).toHaveClass('is-attn-waiting');
  });

  it('沒有任何提示時 chip 不帶 is-attn-* class，仍帶 data-island 屬性', () => {
    render(<IslandDock unlockedIds={['echoes']} />);

    const chip = screen.getByRole('button', { name: '展開流浪回聲' });
    expect(chip.className).not.toMatch(/is-attn-/);
    expect(chip).toHaveAttribute('data-island', 'echoes');
  });
});
