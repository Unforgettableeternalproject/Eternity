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
    expect(inferFieldKind('dossier', 'spoiler', 0)).toBe('number');
    expect(inferFieldKind('browser', 'placeholder', false)).toBe('boolean');
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
