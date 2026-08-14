import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SongPreviewCard from '../SongPreviewCard';

const audioStore = vi.hoisted(() => ({
  play: vi.fn(() => Promise.resolve(true)),
  enqueue: vi.fn(),
}));

vi.mock('../../../audio', () => ({ getAudioStore: () => audioStore }));

const baseTrack = {
  source: 'spot' as const,
  songId: 'echoes/characters/x/theme',
  title: '角色主題曲',
  url: '/api/assets/audio/x.mp3',
  clusterId: 'characters',
  duration: 65,
};

describe('SongPreviewCard spoiler actions', () => {
  it('非 Spot 解鎖（unlock）提供播放與加入佇列入口', () => {
    render(
      <SongPreviewCard
        track={{ ...baseTrack, source: 'unlock', spoilerLevel: 0 }}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText(/已收錄一枚回聲/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /播放/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /加入佇列/ })).toBeEnabled();
  });

  it('插播成功（played）純告知：顯示曲名、無任何動作按鈕', () => {
    render(
      <SongPreviewCard
        track={{ ...baseTrack, source: 'played', spoilerLevel: 0 }}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText(/回聲插播中/)).toBeTruthy();
    expect(screen.getByText(baseTrack.title)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /播放/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /加入佇列/ })).toBeNull();
  });

  it('插播成功且同時新收藏 → 標頭改為已收錄，仍無動作按鈕', () => {
    render(
      <SongPreviewCard
        track={{
          ...baseTrack,
          source: 'played',
          spoilerLevel: 0,
          justCollected: true,
        }}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText(/已收錄一枚回聲 · 插播中/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /播放/ })).toBeNull();
  });

  it('L3 遮蔽標題並禁止播放與加入佇列', () => {
    render(
      <SongPreviewCard
        track={{ ...baseTrack, spoilerLevel: 3 }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.queryByText(baseTrack.title)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /播放/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /加入佇列/ })).toBeDisabled();
  });

  it('L0 可播放也可加入佇列，動作後關閉卡片', () => {
    const onDismiss = vi.fn();
    render(
      <SongPreviewCard
        track={{ ...baseTrack, spoilerLevel: 0 }}
        onDismiss={onDismiss}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /播放/ }));
    expect(audioStore.play).toHaveBeenCalledWith(
      baseTrack.songId,
      baseTrack.url,
      baseTrack.title,
      '#B86060'
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /加入佇列/ }));
    expect(audioStore.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ songId: baseTrack.songId })
    );
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
