/**
 * RelatedEventChip 元件測試（S8 下半場 V-C）
 *
 * ISLAND_RELATED_EVENT 合約的第一個消費端：事件 → chip 呈現 →
 * 跳轉/關閉。navigateToHistoryPage mock 掉（避免 location 副作用）。
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ISLAND_RELATED_EVENT } from '../../types';
import type { IslandRelatedDetail } from '../../types';
import RelatedEventChip from '../RelatedEventChip';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('../historyIslandData', () => ({
  navigateToHistoryPage: navigateMock,
}));

function dispatchRelated(detail: IslandRelatedDetail) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent<IslandRelatedDetail>(ISLAND_RELATED_EVENT, { detail })
    );
  });
}

afterEach(() => {
  cleanup();
  navigateMock.mockClear();
});

describe('RelatedEventChip', () => {
  it('無事件時不渲染', () => {
    const { container } = render(<RelatedEventChip />);
    expect(container.firstChild).toBeNull();
  });

  it('收到事件後顯示來源島名稱與展示對象', () => {
    render(<RelatedEventChip />);
    dispatchRelated({
      sourceZone: 'visuals',
      historyPageIds: [],
      label: '黎明的場景',
    });
    expect(screen.getByText('浮動幻影的迴響')).toBeTruthy();
    expect(screen.getByText('黎明的場景')).toBeTruthy();
    // 無關聯頁時不出現跳轉鈕
    expect(screen.queryByText('翻至 ›')).toBeNull();
  });

  it('有關聯 History 頁時提供跳轉', () => {
    render(<RelatedEventChip />);
    dispatchRelated({
      sourceZone: 'visuals',
      historyPageIds: ['history/u/1-1'],
      label: '黎明的場景',
    });
    fireEvent.click(screen.getByText('翻至 ›'));
    expect(navigateMock).toHaveBeenCalledWith('history/u/1-1');
  });

  it('後到的事件覆蓋前者；× 關閉 chip', () => {
    render(<RelatedEventChip />);
    dispatchRelated({
      sourceZone: 'visuals',
      historyPageIds: [],
      label: '第一個展示',
    });
    dispatchRelated({
      sourceZone: 'visuals',
      historyPageIds: [],
      label: '第二個展示',
    });
    expect(screen.queryByText('第一個展示')).toBeNull();
    expect(screen.getByText('第二個展示')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('關閉關聯提示'));
    expect(screen.queryByText('第二個展示')).toBeNull();
  });
});
