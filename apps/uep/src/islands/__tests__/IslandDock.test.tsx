import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import IslandDock from '../IslandDock';
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
