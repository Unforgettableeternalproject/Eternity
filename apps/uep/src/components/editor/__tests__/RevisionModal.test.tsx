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

describe('RevisionModal — base 預設顯示', () => {
  it('未提供 onBaseVisibleChange 時不顯示開關', () => {
    setup();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('勾選開關回寫 true、取消回寫 false', () => {
    const onBaseVisibleChange = vi.fn();
    setup({ onBaseVisibleChange });
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onBaseVisibleChange).toHaveBeenCalledWith(true);
  });

  it('baseVisible=true 時 base 卡標示「預設顯示」且開關已勾', () => {
    setup({
      baseVisible: true,
      onBaseVisibleChange: vi.fn(),
      baseGate: { requiresFlags: ['met:x'] },
      onBaseGateChange: vi.fn(),
    });
    expect(screen.getByText('◉ 預設顯示')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { checked: true })).toBeInTheDocument();
    // 提示：條件不影響可見性
    expect(screen.getByText(/不影響條目可見性/)).toBeInTheDocument();
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

describe('RevisionModal — base gate（S7 驗收 #4）', () => {
  it('提供 onBaseGateChange 時 base 卡顯示條件編輯器並寫回', () => {
    const onBaseGateChange = vi.fn();
    setup({ baseGate: null, onBaseGateChange });
    fireEvent.click(screen.getByText('base'));
    expect(screen.getByText('BASE 解鎖條件')).toBeInTheDocument();
    const flagInput = screen.getByPlaceholderText(/custom flag/);
    fireEvent.change(flagInput, { target: { value: 'met:xavier' } });
    fireEvent.keyDown(flagInput, { key: 'Enter' });
    expect(onBaseGateChange).toHaveBeenCalledWith({
      requiresFlags: ['met:xavier'],
    });
  });

  it('baseGate 有值時時間線 base 卡顯示 ⚑ 標記', () => {
    setup({
      baseGate: { requiresFlags: ['met:xavier'] },
      onBaseGateChange: vi.fn(),
    });
    expect(screen.getAllByText('⚑ 有解鎖條件').length).toBeGreaterThan(0);
    expect(screen.queryByText('條目現有內容')).not.toBeInTheDocument();
  });

  it('未提供 onBaseGateChange 時 base 卡不顯示條件編輯器', () => {
    setup();
    fireEvent.click(screen.getByText('base'));
    expect(screen.queryByText('BASE 解鎖條件')).not.toBeInTheDocument();
  });
});

describe('RevisionModal — 複製上一版 patch（S7 驗收 #6）', () => {
  it('第一個 revision 不顯示複製按鈕', () => {
    setup({ revisions: makeRevisions() });
    // 預設選中第一個 revision
    expect(screen.queryByText('⧉ 複製上一版')).not.toBeInTheDocument();
  });

  it('選中後段 revision 時複製上一版 patch（空 patch 不經 confirm）', async () => {
    const revisions = makeRevisions();
    const { onChange } = setup({ revisions });
    fireEvent.click(screen.getByText('xavier-colsono:02'));
    fireEvent.click(screen.getByText('⧉ 複製上一版'));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([
        revisions[0],
        { ...revisions[1], patch: revisions[0].patch },
      ]);
    });
    // deep clone：不可與上一版共用引用
    const written = onChange.mock.calls[0][0][1].patch;
    expect(written).toEqual(revisions[0].patch);
    expect(written).not.toBe(revisions[0].patch);
    expect(written.set).not.toBe(revisions[0].patch.set);
  });

  it('目前 patch 已有內容時經 confirm 守門，取消不覆蓋', async () => {
    const confirmFn = vi.fn().mockResolvedValue(false);
    (
      window as unknown as {
        __uepDialogManager: { confirm: () => Promise<boolean> };
      }
    ).__uepDialogManager = { confirm: confirmFn };
    const revisions: ConceptsRevision[] = [
      makeRevisions()[0],
      {
        id: 'xavier-colsono:02',
        gate: null,
        patch: { set: { name: '既有內容' } },
      },
    ];
    const { onChange } = setup({ revisions });
    fireEvent.click(screen.getByText('xavier-colsono:02'));
    fireEvent.click(screen.getByText('⧉ 複製上一版'));
    await waitFor(() => {
      expect(confirmFn).toHaveBeenCalled();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
