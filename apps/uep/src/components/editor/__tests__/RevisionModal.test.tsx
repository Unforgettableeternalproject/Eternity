/**
 * RevisionModal 測試（Epic 2 S7-B）
 *
 * 涵蓋：
 * - base 虛擬項永遠顯示，無 revision 時顯示引導提示
 * - 新增 revision：預設 id 走旗標慣例（entityKey:NN）/ 無 entityKey 走 rev-N
 * - 刪除（confirm 守門）、上下移（宣告順序 = 劇情順序）
 * - gate 編輯透過 GateConditionEditor 寫回
 * - browser stack 顯示 placeholder 語意說明（設計定案 C）
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { ConceptsRevision } from '../../concepts/types';
import RevisionModal from '../RevisionModal';

// getDialog().confirm 走 window.__uepDialogManager——測試中直接放行
beforeEach(() => {
  (
    window as unknown as {
      __uepDialogManager: { confirm: () => Promise<boolean> };
    }
  ).__uepDialogManager = { confirm: vi.fn().mockResolvedValue(true) };
});

function makeRevisions(): ConceptsRevision[] {
  return [
    {
      id: 'xavier-colsono:01',
      gate: { requiresFlags: ['xavier-colsono:01'] },
      patch: { set: { content_html: '<p>更新</p>' } },
    },
    { id: 'xavier-colsono:02', gate: null, patch: {} },
  ];
}

function setup(
  overrides: Partial<React.ComponentProps<typeof RevisionModal>> = {}
) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <RevisionModal
      entryLabel="艾斯維爾"
      stackStyle="dossier"
      entityKey="xavier-colsono"
      baseEntry={{ name: '艾斯維爾' }}
      revisions={[]}
      onChange={onChange}
      onClose={onClose}
      accent="#2d6a4f"
      {...overrides}
    />
  );
  return { onChange, onClose };
}

describe('RevisionModal — 基本結構', () => {
  it('顯示條目名稱與 base 虛擬項', () => {
    setup();
    expect(screen.getByText('艾斯維爾')).toBeInTheDocument();
    expect(screen.getByText('base')).toBeInTheDocument();
    expect(screen.getByText('條目現有內容')).toBeInTheDocument();
  });

  it('無 revision 時顯示引導提示', () => {
    setup();
    expect(screen.getByText(/尚無 revision/)).toBeInTheDocument();
  });

  it('有 revision 時預設選中第一個 revision', () => {
    setup({ revisions: makeRevisions() });
    // 右欄顯示 revision id 輸入
    expect(screen.getByDisplayValue('xavier-colsono:01')).toBeInTheDocument();
  });

  it('browser stack 顯示 placeholder 語意說明', () => {
    setup({ stackStyle: 'browser' });
    expect(screen.getByText(/placeholder/)).toBeInTheDocument();
  });

  it('點 ✕ 觸發 onClose', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByText('✕'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('RevisionModal — 增刪排序', () => {
  it('新增 revision：有 entityKey 走旗標慣例預設 id', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByText('+ 新增 Revision'));
    expect(onChange).toHaveBeenCalledWith([
      { id: 'xavier-colsono:01', gate: null, patch: {} },
    ]);
  });

  it('新增 revision：無 entityKey 走 rev-N', () => {
    const { onChange } = setup({ entityKey: undefined });
    fireEvent.click(screen.getByText('+ 新增 Revision'));
    expect(onChange).toHaveBeenCalledWith([
      { id: 'rev-1', gate: null, patch: {} },
    ]);
  });

  it('刪除 revision 經過 confirm 守門後寫回', async () => {
    const revisions = makeRevisions();
    const { onChange } = setup({ revisions });
    const delButtons = screen.getAllByTitle('刪除');
    fireEvent.click(delButtons[0]);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([revisions[1]]);
    });
  });

  it('confirm 取消時不刪除', async () => {
    (
      window as unknown as {
        __uepDialogManager: { confirm: () => Promise<boolean> };
      }
    ).__uepDialogManager = { confirm: vi.fn().mockResolvedValue(false) };
    const { onChange } = setup({ revisions: makeRevisions() });
    fireEvent.click(screen.getAllByTitle('刪除')[0]);
    await waitFor(() => {
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it('下移交換宣告順序', () => {
    const revisions = makeRevisions();
    const { onChange } = setup({ revisions });
    const downButtons = screen.getAllByTitle('下移');
    fireEvent.click(downButtons[0]);
    expect(onChange).toHaveBeenCalledWith([revisions[1], revisions[0]]);
  });

  it('第一個 revision 的上移按鈕禁用、最後一個的下移按鈕禁用', () => {
    setup({ revisions: makeRevisions() });
    const upButtons = screen.getAllByTitle('上移');
    const downButtons = screen.getAllByTitle('下移');
    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[downButtons.length - 1]).toBeDisabled();
  });
});

describe('RevisionModal — 編輯', () => {
  it('修改 revision id 寫回', () => {
    const revisions = makeRevisions();
    const { onChange } = setup({ revisions });
    const input = screen.getByDisplayValue('xavier-colsono:01');
    fireEvent.change(input, { target: { value: 'xavier-colsono:03' } });
    expect(onChange).toHaveBeenCalledWith([
      { ...revisions[0], id: 'xavier-colsono:03' },
      revisions[1],
    ]);
  });

  it('gate 編輯透過 GateConditionEditor 寫回', () => {
    const revisions = makeRevisions();
    const { onChange } = setup({ revisions });
    // 選中第二個 revision（gate: null）
    fireEvent.click(screen.getByText('xavier-colsono:02'));
    const flagInput = screen.getByPlaceholderText(/custom flag/);
    fireEvent.change(flagInput, {
      target: { value: 'xavier-colsono:02' },
    });
    fireEvent.keyDown(flagInput, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([
      revisions[0],
      {
        ...revisions[1],
        gate: { requiresFlags: ['xavier-colsono:02'] },
      },
    ]);
  });

  it('gate 為 null 的 revision 顯示無條件警告', () => {
    setup({ revisions: makeRevisions() });
    fireEvent.click(screen.getByText('xavier-colsono:02'));
    expect(
      screen.getByText(/無條件的 revision 會永遠套用/)
    ).toBeInTheDocument();
  });
});
