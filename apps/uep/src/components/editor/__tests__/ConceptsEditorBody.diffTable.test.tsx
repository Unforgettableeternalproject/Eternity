/**
 * DiffEditor — 值欄位標籤與詞條表格
 *
 * diff 降格為純對照表後，值不再是匿名陣列：欄位標籤定義在 section 層，
 * 各詞條的 values 依序對位。編輯主戰場從「右欄逐值填」改成「表格逐格填」。
 *
 * 既有資料沒有 valueLabels，欄數必須改由實際值數推導，否則舊頁面
 * 一開就被裁成單欄。
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ConceptsEditorData } from '../ConceptsEditorBody';
import ConceptsEditorBody from '../ConceptsEditorBody';
import type { DiffContent } from '../../concepts/types';

// 刪除欄位／詞條走 getDialog().confirm，測試中直接放行
beforeEach(() => {
  (
    window as unknown as {
      __uepDialogManager: { confirm: () => Promise<boolean> };
    }
  ).__uepDialogManager = { confirm: vi.fn().mockResolvedValue(true) };
});

function labelled(): DiffContent {
  return {
    subcategories: [
      {
        label: '概念名詞',
        sections: [
          {
            label: '',
            valueLabels: ['英文', '日文'],
            entries: [
              { term: '區間界', values: ['Interbarrier', '境界結界'] },
              { term: '舊會議', values: ['Treffen', '旧会議'] },
            ],
          },
        ],
      },
    ],
  };
}

function renderDiff(data: DiffContent) {
  const onDataChange = vi.fn();
  render(
    <ConceptsEditorBody
      accent="#2d6a4f"
      stackStyle="diff"
      initialData={{
        stackStyle: 'diff',
        contentBlockType: 'diff_table',
        data,
      }}
      onDataChange={onDataChange}
      onDirty={vi.fn()}
    />
  );
  /** 取最後一次回傳的 diff 內容 */
  const latest = (): DiffContent => {
    const calls = onDataChange.mock.calls;
    return (calls[calls.length - 1][0] as ConceptsEditorData)
      .data as DiffContent;
  };
  return { onDataChange, latest };
}

/** 該 section 第一個 section 的 entries */
const entriesOf = (d: DiffContent) => d.subcategories[0].sections[0].entries;
const labelsOf = (d: DiffContent) => d.subcategories[0].sections[0].valueLabels;

describe('DiffEditor — 值欄位標籤', () => {
  it('表頭顯示欄位標籤，每個詞條依序對位一格', () => {
    renderDiff(labelled());

    // 表頭是純文字（欄位管理列則是 input，用 displayValue 區分）
    expect(screen.getByText('英文')).toBeInTheDocument();
    expect(screen.getByText('日文')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Interbarrier')).toBeInTheDocument();
    expect(screen.getByDisplayValue('旧会議')).toBeInTheDocument();
  });

  it('格內編輯寫回對應欄位，不影響同列其他值', async () => {
    const { latest } = renderDiff(labelled());

    fireEvent.change(screen.getByDisplayValue('Interbarrier'), {
      target: { value: 'Zone Lock' },
    });

    await waitFor(() => {
      const entry = entriesOf(latest())[0];
      expect(entry.values).toEqual(['Zone Lock', '境界結界']);
    });
  });

  it('新增欄位後表格多一欄，既有值不動', async () => {
    const { latest } = renderDiff(labelled());

    fireEvent.click(screen.getByText('+ 欄位'));

    await waitFor(() => {
      expect(labelsOf(latest())).toEqual(['英文', '日文', '']);
      expect(entriesOf(latest())[0].values).toEqual([
        'Interbarrier',
        '境界結界',
      ]);
    });
  });

  it('刪除欄位一併移除所有詞條的該欄值', async () => {
    const { latest } = renderDiff(labelled());

    // 第一欄的刪除鈕（欄位管理列 chip 內）
    fireEvent.click(screen.getAllByTitle('刪除此欄位')[0]);

    await waitFor(() => {
      expect(labelsOf(latest())).toEqual(['日文']);
      expect(entriesOf(latest())[0].values).toEqual(['境界結界']);
      expect(entriesOf(latest())[1].values).toEqual(['旧会議']);
    });
  });

  it('欄位名稱全部清空時 valueLabels 寫回 undefined（閱讀器退回無表頭）', async () => {
    const { latest } = renderDiff({
      subcategories: [
        {
          label: 'A',
          sections: [
            {
              label: '',
              valueLabels: ['英文'],
              entries: [{ term: '甲', values: ['Alpha'] }],
            },
          ],
        },
      ],
    });

    fireEvent.change(screen.getByDisplayValue('英文'), {
      target: { value: '' },
    });

    await waitFor(() => expect(labelsOf(latest())).toBeUndefined());
  });
});

describe('DiffEditor — 未定義標籤的既有資料', () => {
  it('欄數由實際值數推導，不會被裁成單欄', () => {
    renderDiff({
      subcategories: [
        {
          label: '舊資料',
          sections: [
            {
              label: '',
              entries: [{ term: '壁蜘蛛', values: ['Abyssilks', '奈落蜘蛛'] }],
            },
          ],
        },
      ],
    });

    // 無標籤時表頭退回「值 N」，兩個值欄都在
    expect(screen.getByText('值 1')).toBeInTheDocument();
    expect(screen.getByText('值 2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('奈落蜘蛛')).toBeInTheDocument();
  });

  it('值數多於標籤數時取大者，多出的值不被截掉', () => {
    renderDiff({
      subcategories: [
        {
          label: '混合',
          sections: [
            {
              label: '',
              valueLabels: ['英文'],
              entries: [{ term: '甲', values: ['Alpha', 'アルファ', '第三'] }],
            },
          ],
        },
      ],
    });

    expect(screen.getByDisplayValue('第三')).toBeInTheDocument();
    expect(screen.getByText('值 3')).toBeInTheDocument();
  });

  it('新詞條的值依現有欄數補齊', async () => {
    const { latest } = renderDiff(labelled());

    fireEvent.click(screen.getByText('+ 新增詞條'));

    await waitFor(() => {
      const added = entriesOf(latest())[2];
      expect(added.term).toBe('');
      expect(added.values).toEqual(['', '']);
    });
  });
});
