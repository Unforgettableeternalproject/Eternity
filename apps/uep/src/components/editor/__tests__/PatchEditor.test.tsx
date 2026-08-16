/**
 * PatchEditor 測試（Epic 2 S7-B）
 *
 * 涵蓋：
 * - inferFieldKind：已知欄位走定義、chrono items 路徑、值形狀推斷
 * - set 欄位增刪與寫回（text/number/boolean/stringlist/keyvalue）
 * - remove 路徑列表增刪
 * - 空 set/remove 收斂為 undefined（序列化乾淨）
 * - JSON 自訂值：非法 JSON 不寫回
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { RevisionPatch } from '../../concepts/types';
import PatchEditor, { inferFieldKind } from '../PatchEditor';

beforeEach(() => {
  (
    window as unknown as {
      __uepDialogManager: { prompt: () => Promise<string | null> };
    }
  ).__uepDialogManager = { prompt: vi.fn().mockResolvedValue(null) };
});

describe('inferFieldKind', () => {
  it('已知欄位走 stack 定義', () => {
    expect(inferFieldKind('dossier', 'content_html', '')).toBe('html');
    expect(inferFieldKind('dossier', 'aliases', [])).toBe('stringlist');
    expect(inferFieldKind('browser', 'placeholder', false)).toBe('boolean');
    expect(inferFieldKind('browser', 'categories', [])).toBe('stringlist');
    expect(inferFieldKind('browser', 'basic', {})).toBe('keyvalue');
    expect(inferFieldKind('browser', 'sections', [])).toBe('sections');
    expect(inferFieldKind('diff', 'values', [])).toBe('stringlist');
  });

  it('chrono 的 fields.{id}.items 路徑推斷為 stringlist', () => {
    expect(inferFieldKind('chrono', 'fields.main.items', ['a'])).toBe(
      'stringlist'
    );
    // groups 路徑不匹配 items pattern，帶 group 物件時依形狀落到 json
    expect(
      inferFieldKind('chrono', 'fields.regional.groups', [
        { label: '三區', items: ['事件'] },
      ])
    ).toBe('json');
  });

  it('未知路徑依值形狀推斷', () => {
    expect(inferFieldKind('dossier', 'alias', 'x')).toBe('text');
    expect(inferFieldKind('dossier', 'weight', 3)).toBe('number');
    expect(inferFieldKind('dossier', 'flag', true)).toBe('boolean');
    expect(inferFieldKind('dossier', 'tags', ['a', 'b'])).toBe('stringlist');
    expect(
      inferFieldKind('dossier', 'custom', [{ label: 'x', content_html: '' }])
    ).toBe('sections');
    expect(inferFieldKind('dossier', 'meta', { a: 'b' })).toBe('keyvalue');
    expect(inferFieldKind('dossier', 'complex', { a: 1 })).toBe('json');
    expect(inferFieldKind('dossier', 'nothing', null)).toBe('json');
  });
});

function setup(patch: RevisionPatch, stackStyle = 'dossier' as const) {
  const onChange = vi.fn();
  render(
    <PatchEditor
      stackStyle={stackStyle}
      patch={patch}
      onChange={onChange}
      accent="#2d6a4f"
    />
  );
  return { onChange };
}

describe('PatchEditor — chrono 事件列下拉選擇（S7 驗收 #7）', () => {
  const fieldDefs = [
    { id: 'main', icon: '◆', label: '主線事件', style: 'flat' as const },
    { id: 'regional', icon: '▧', label: '區域動態', style: 'grouped' as const },
  ];

  function setupChrono(patch: RevisionPatch) {
    const onChange = vi.fn();
    render(
      <PatchEditor
        stackStyle="chrono"
        patch={patch}
        onChange={onChange}
        chronoFieldDefs={fieldDefs}
        accent="#2d6a4f"
      />
    );
    return { onChange };
  }

  it('有 fieldDefs 時顯示下拉（不再是 prompt 按鈕）', () => {
    setupChrono({});
    expect(screen.getByText('+ 事件列…')).toBeInTheDocument();
    expect(screen.queryByText('+ 事件列')).not.toBeInTheDocument();
    expect(screen.getByText('◆ 主線事件（main）')).toBeInTheDocument();
    expect(screen.getByText('▧ 區域動態（regional）')).toBeInTheDocument();
  });

  it('選 flat 欄位 → fields.{id}.items 帶預設值', () => {
    const { onChange } = setupChrono({});
    const selects = screen.getAllByRole('combobox');
    // 事件列下拉是含「+ 事件列…」選項的那個
    const eventSelect = selects.find((s) =>
      Array.from(s.querySelectorAll('option')).some(
        (o) => o.textContent === '+ 事件列…'
      )
    )!;
    fireEvent.change(eventSelect, { target: { value: 'main' } });
    expect(onChange).toHaveBeenCalledWith({
      set: { 'fields.main.items': [''] },
    });
  });

  it('選 grouped 欄位 → fields.{id}.groups 帶空陣列', () => {
    const { onChange } = setupChrono({});
    const selects = screen.getAllByRole('combobox');
    const eventSelect = selects.find((s) =>
      Array.from(s.querySelectorAll('option')).some(
        (o) => o.textContent === '+ 事件列…'
      )
    )!;
    fireEvent.change(eventSelect, { target: { value: 'regional' } });
    expect(onChange).toHaveBeenCalledWith({
      set: { 'fields.regional.groups': [] },
    });
  });

  it('已在 set 的欄位不再出現於下拉', () => {
    setupChrono({ set: { 'fields.main.items': ['x'] } });
    expect(screen.queryByText('◆ 主線事件（main）')).not.toBeInTheDocument();
    expect(screen.getByText('▧ 區域動態（regional）')).toBeInTheDocument();
  });

  it('無 fieldDefs 時退回 prompt 按鈕（向後相容）', () => {
    const onChange = vi.fn();
    render(
      <PatchEditor
        stackStyle="chrono"
        patch={{}}
        onChange={onChange}
        accent="#2d6a4f"
      />
    );
    expect(screen.getByText('+ 事件列')).toBeInTheDocument();
  });
});

describe('PatchEditor — set 欄位', () => {
  it('空 patch 顯示引導提示', () => {
    setup({});
    expect(screen.getByText(/尚無 set 操作/)).toBeInTheDocument();
  });

  it('下拉新增已知欄位帶預設值', () => {
    const { onChange } = setup({});
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'name' } });
    expect(onChange).toHaveBeenCalledWith({ set: { name: '' } });
  });

  it('已在 set 中的欄位不再出現於下拉', () => {
    setup({ set: { name: 'x' } });
    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option')).map(
      (o) => o.getAttribute('value') || ''
    );
    expect(options).not.toContain('name');
    expect(options).toContain('content_html');
  });

  it('text 欄位編輯寫回', () => {
    const { onChange } = setup({ set: { name: '舊名' } });
    const input = screen.getByDisplayValue('舊名');
    fireEvent.change(input, { target: { value: '新名' } });
    expect(onChange).toHaveBeenCalledWith({ set: { name: '新名' } });
  });

  it('boolean 欄位切換寫回', () => {
    const { onChange } = setup(
      { set: { placeholder: true } },
      'browser' as never
    );
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ set: { placeholder: false } });
  });

  it('stringlist 新增項目寫回', () => {
    const { onChange } = setup({ set: { values: ['甲'] } }, 'diff' as never);
    fireEvent.click(screen.getByText('+ 項目'));
    expect(onChange).toHaveBeenCalledWith({ set: { values: ['甲', ''] } });
  });

  it('移除最後一個 set 欄位收斂為 undefined', () => {
    const { onChange } = setup({ set: { name: 'x' } });
    fireEvent.click(screen.getByTitle('移除此欄位'));
    expect(onChange).toHaveBeenCalledWith({ set: undefined });
  });
});

describe('PatchEditor — remove 路徑', () => {
  it('輸入路徑按 Enter 加入 remove 列表', () => {
    const { onChange } = setup({});
    const input = screen.getByPlaceholderText(/欄位路徑/);
    fireEvent.change(input, { target: { value: 'spoiler' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ remove: ['spoiler'] });
  });

  it('重複路徑不重複加入', () => {
    const { onChange } = setup({ remove: ['spoiler'] });
    const input = screen.getByPlaceholderText(/欄位路徑/);
    fireEvent.change(input, { target: { value: 'spoiler' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('移除最後一個 remove 路徑收斂為 undefined', () => {
    const { onChange } = setup({ remove: ['spoiler'] });
    fireEvent.click(screen.getByLabelText('取消移除 spoiler'));
    expect(onChange).toHaveBeenCalledWith({ remove: undefined });
  });
});

describe('PatchEditor — JSON 自訂值', () => {
  it('合法 JSON 寫回解析後的值', () => {
    const { onChange } = setup({ set: { 'basic.種族': null } });
    const textarea = screen.getByPlaceholderText(/JSON 值/);
    fireEvent.change(textarea, { target: { value: '"人類"' } });
    expect(onChange).toHaveBeenCalledWith({ set: { 'basic.種族': '人類' } });
  });

  it('非法 JSON 顯示錯誤且不寫回', () => {
    const { onChange } = setup({ set: { 'basic.種族': null } });
    const textarea = screen.getByPlaceholderText(/JSON 值/);
    fireEvent.change(textarea, { target: { value: '人類' } });
    expect(screen.getByText(/不是合法 JSON/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

/**
 * entity 一對多綁定 picker（T-5，2026-08-15 定案）
 *
 * 值是字串，若沒有 STACK_PATCH_FIELDS 的顯式定義就會被 inferFieldKind
 * 依值形狀猜成 'text'（純文字框）——那條路徑正是本組測試要鎖住的。
 */
describe('bindings picker 欄位', () => {
  it('bindings.echoes / bindings.visuals 不被推斷成純文字框', () => {
    expect(inferFieldKind('dossier', 'bindings.echoes', 'echoes/a/b')).toBe(
      'entity-picker'
    );
    expect(inferFieldKind('dossier', 'bindings.visuals', 'visuals/a/b')).toBe(
      'entity-picker'
    );
    expect(inferFieldKind('browser', 'bindings.echoes', 'echoes/a/b')).toBe(
      'entity-picker'
    );
  });

  it('未定義的 bindings 子路徑仍走一般字串推斷（不誤擴大）', () => {
    expect(inferFieldKind('dossier', 'bindings.storage', 'x')).toBe('text');
  });

  it('chrono / diff 沒有綁定欄位（實體身分只由 dossier 與 browser 承擔）', () => {
    expect(inferFieldKind('chrono', 'bindings.echoes', 'echoes/a/b')).toBe(
      'text'
    );
    expect(inferFieldKind('diff', 'bindings.echoes', 'echoes/a/b')).toBe(
      'text'
    );
  });
});
