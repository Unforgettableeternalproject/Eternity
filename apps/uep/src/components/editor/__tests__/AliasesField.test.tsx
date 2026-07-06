/**
 * AliasesField / parseAliases 測試（Epic 2 S7-D-2）
 *
 * 涵蓋：
 * - parseAliases：頓號/全半形逗號分隔、trim、去空、去重
 * - 元件：輸入中保留分隔符（不吃頓號）、commit 解析後陣列、
 *   空值收斂 undefined、外部值切換（換條目）時同步顯示值
 */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { AliasesField, parseAliases } from '../ConceptsEditorBody';

describe('parseAliases', () => {
  it('頓號/全形逗號/半形逗號皆可分隔', () => {
    expect(parseAliases('小諾、Nov,阿諾，諾諾')).toEqual([
      '小諾',
      'Nov',
      '阿諾',
      '諾諾',
    ]);
  });

  it('trim + 去空 + 去重', () => {
    expect(parseAliases(' 小諾 、、 小諾 , ')).toEqual(['小諾']);
    expect(parseAliases('')).toEqual([]);
  });
});

describe('AliasesField', () => {
  function setup(value: string[] | undefined, onChange = vi.fn()) {
    const view = render(<AliasesField value={value} onChange={onChange} />);
    return {
      view,
      input: screen.getByPlaceholderText(/用、分隔/) as HTMLInputElement,
      onChange,
    };
  }

  it('顯示現有值（以頓號連接）', () => {
    const { input } = setup(['小諾', 'Nov']);
    expect(input).toHaveValue('小諾、Nov');
  });

  it('輸入中保留尾端分隔符，commit 解析後陣列', () => {
    const { input, onChange } = setup(undefined);
    fireEvent.change(input, { target: { value: '小諾、' } });
    // 顯示值保留頓號（分類路徑欄位的吃字毛病不得復現）
    expect(input).toHaveValue('小諾、');
    expect(onChange).toHaveBeenLastCalledWith(['小諾']);
    fireEvent.change(input, { target: { value: '小諾、Nov' } });
    expect(onChange).toHaveBeenLastCalledWith(['小諾', 'Nov']);
  });

  it('清空輸入收斂為 undefined', () => {
    const { input, onChange } = setup(['小諾']);
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('外部值切換（換條目）時同步顯示值', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AliasesField value={['小諾']} onChange={onChange} />
    );
    const input = screen.getByPlaceholderText(/用、分隔/);
    expect(input).toHaveValue('小諾');
    rerender(<AliasesField value={['主人', 'Risco']} onChange={onChange} />);
    expect(input).toHaveValue('主人、Risco');
    rerender(<AliasesField value={undefined} onChange={onChange} />);
    expect(input).toHaveValue('');
  });
});
