/**
 * Concepts 互聯觸發按鈕測試（S10-1 T-G3）
 *
 * 重點在「什麼時候不該出現」——按鈕是可見 UI，出現了就代表可用，
 * 島沒掛載時還渲染等於騙使用者按一顆不會有反應的鈕。
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const islandsMock = vi.hoisted(() => ({
  mounted: true,
  desktop: true,
  trigger: vi.fn(),
}));
vi.mock('../../../islands', () => ({
  shouldMountIsland: () => islandsMock.mounted,
  useDesktopIslandViewport: () => islandsMock.desktop,
  triggerHistoryRelated: islandsMock.trigger,
}));

const toastMock = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('../../ui/UepToast', () => ({ uepToast: { info: toastMock.info } }));

import InterlinkTriggerButton from '../InterlinkTriggerButton';

beforeEach(() => {
  islandsMock.mounted = true;
  islandsMock.desktop = true;
  islandsMock.trigger.mockReset().mockResolvedValue(true);
  toastMock.info.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InterlinkTriggerButton — 渲染守門', () => {
  it('條目沒有 entityKey → 不渲染', () => {
    const { container } = render(<InterlinkTriggerButton label="無名氏" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('entityKey 只有空白 → 視同沒有', () => {
    const { container } = render(
      <InterlinkTriggerButton entityKey="   " label="無名氏" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('History 島未掛載（觀測者／未解鎖／停用）→ 不渲染', () => {
    islandsMock.mounted = false;
    const { container } = render(
      <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('非桌面寬度 → 不渲染', () => {
    islandsMock.desktop = false;
    const { container } = render(
      <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('有 key 且島掛載 → 渲染可點按鈕', () => {
    render(
      <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
    );
    expect(
      screen.getByRole('button', { name: '查「艾斯維爾」在哪些段落出現過' })
    ).toBeTruthy();
  });
});

describe('InterlinkTriggerButton — 觸發', () => {
  it('點擊帶 entity 命名空間查詢，並傳條目名稱當標題', async () => {
    const user = userEvent.setup();
    render(
      <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
    );
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(islandsMock.trigger).toHaveBeenCalledTimes(1));
    expect(islandsMock.trigger.mock.calls[0][0]).toMatchObject({
      sourceZone: 'concepts',
      keyType: 'entity',
      key: 'xavier-colsono',
      label: '艾斯維爾',
    });
  });

  it('查無錨點 → 給 toast 回饋（手動觸發不能靜默）', async () => {
    islandsMock.trigger.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<InterlinkTriggerButton entityKey="nobody" label="沒人提過" />);
    await user.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(toastMock.info).toHaveBeenCalledWith('沒有段落提到「沒人提過」')
    );
  });

  it('查到錨點 → 不彈 toast（卡片本身就是回饋）', async () => {
    const user = userEvent.setup();
    render(
      <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
    );
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(islandsMock.trigger).toHaveBeenCalled());
    expect(toastMock.info).not.toHaveBeenCalled();
  });

  it('查詢期間停用按鈕，避免連點重複打端點', async () => {
    let release: (v: boolean) => void = () => {};
    islandsMock.trigger.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      })
    );
    const user = userEvent.setup();
    render(
      <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
    );
    const btn = screen.getByRole('button');
    await user.click(btn);
    await waitFor(() => expect(btn.hasAttribute('disabled')).toBe(true));
    release(true);
    await waitFor(() => expect(btn.hasAttribute('disabled')).toBe(false));
    expect(islandsMock.trigger).toHaveBeenCalledTimes(1);
  });

  it('點按鈕不連帶觸發條目卡本身的點擊', async () => {
    const onCardClick = vi.fn();
    const user = userEvent.setup();
    render(
      <div onClick={onCardClick}>
        <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
      </div>
    );
    await user.click(screen.getByRole('button'));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
