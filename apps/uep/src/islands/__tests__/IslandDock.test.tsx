import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import IslandDock from '../IslandDock';
import { clearAllChipPulses, flashChip } from '../chipAttention';
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
      name: '展開流浪回聲（有回聲等待插播）',
    });
    expect(chip).toHaveClass('is-attn-waiting');

    act(() => setEchoSpotWaiting(false));
    expect(chip).not.toHaveClass('is-attn-waiting');
  });
});

describe('IslandDock — 瞬時 pulse 樣式與 chip 屬性（S9-D.6）', () => {
  beforeEach(() => {
    open.mockClear();
    clearAllChipPulses();
    setEchoSpotWaiting(false);
  });

  afterEach(() => {
    clearAllChipPulses();
    setEchoSpotWaiting(false);
  });

  it('瞬時 pulse 套用 is-attn-pulse class，chip 帶 data-island 屬性', () => {
    flashChip('echoes', '閱讀進度已更新');
    render(<IslandDock unlockedIds={['echoes']} />);

    const chip = screen.getByRole('button', {
      name: '展開流浪回聲（閱讀進度已更新）',
    });
    expect(chip).toHaveClass('is-attn-pulse');
    expect(chip).not.toHaveClass('is-attn-waiting');
    expect(chip).toHaveAttribute('data-island', 'echoes');
  });

  it('同一座島 waiting 與 pulse 同時成立時，只顯示 waiting 樣式', () => {
    setEchoSpotWaiting(true);
    flashChip('echoes', '剛剛有東西動了');
    render(<IslandDock unlockedIds={['echoes']} />);

    const chip = screen.getByRole('button', {
      name: '展開流浪回聲（有回聲等待插播）',
    });
    expect(chip).toHaveClass('is-attn-waiting');
    expect(chip).not.toHaveClass('is-attn-pulse');
  });

  it('沒有任何提示時 chip 不帶 is-attn-* class，仍帶 data-island 屬性', () => {
    render(<IslandDock unlockedIds={['echoes']} />);

    const chip = screen.getByRole('button', { name: '展開流浪回聲' });
    expect(chip.className).not.toMatch(/is-attn-/);
    expect(chip).toHaveAttribute('data-island', 'echoes');
  });
});
