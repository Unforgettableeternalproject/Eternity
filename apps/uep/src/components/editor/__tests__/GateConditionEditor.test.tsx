/**
 * GateConditionEditor 測試（E 步驟：progressPage toggle 相關）
 *
 * 涵蓋新加的 UI 行為：
 * - progressPage toggle 只在 onProgressPageChange 提供時顯示（向後相容）
 * - isProgressPage=true → 「需先讀完」picker 完全收起
 * - toggle 切換觸發 onProgressPageChange
 * - 進度頁模式下自訂旗標與純潔者限定仍可用
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import GateConditionEditor from '../GateConditionEditor';

describe('GateConditionEditor — progressPage toggle', () => {
  it('未提供 onProgressPageChange 時不顯示 toggle（向後相容）', () => {
    render(
      <GateConditionEditor
        value={null}
        onChange={() => {}}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    expect(screen.queryByText('這是進度頁')).not.toBeInTheDocument();
    // 「需先讀完」按鈕仍存在
    expect(screen.getByText(/需先讀完/)).toBeInTheDocument();
  });

  it('提供 onProgressPageChange 時顯示 toggle', () => {
    render(
      <GateConditionEditor
        value={null}
        onChange={() => {}}
        isProgressPage={false}
        onProgressPageChange={() => {}}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    expect(screen.getByText('這是進度頁')).toBeInTheDocument();
  });

  it('isProgressPage=true → 「需先讀完」picker 完全收起', () => {
    render(
      <GateConditionEditor
        value={null}
        onChange={() => {}}
        isProgressPage={true}
        onProgressPageChange={() => {}}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    expect(screen.queryByText(/需先讀完/)).not.toBeInTheDocument();
    // 提示文字顯示
    expect(screen.getByText(/進度頁：解鎖倚賴同層前一個進度頁完成/)).toBeInTheDocument();
  });

  it('切換 toggle 觸發 onProgressPageChange', () => {
    const onProgressPageChange = vi.fn();
    render(
      <GateConditionEditor
        value={null}
        onChange={() => {}}
        isProgressPage={false}
        onProgressPageChange={onProgressPageChange}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    const toggle = screen
      .getByText('這是進度頁')
      .parentElement?.querySelector('input[type="checkbox"]');
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle!);
    expect(onProgressPageChange).toHaveBeenCalledWith(true);
  });

  it('進度頁模式下自訂旗標欄仍可用', () => {
    const onChange = vi.fn();
    render(
      <GateConditionEditor
        value={null}
        onChange={onChange}
        isProgressPage={true}
        onProgressPageChange={() => {}}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    const input = screen.getByPlaceholderText(/自訂旗標/);
    fireEvent.change(input, { target: { value: 'met:norvia' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ requiresFlags: ['met:norvia'] });
  });

  it('進度頁模式下純潔者限定 checkbox 仍可用', () => {
    const onChange = vi.fn();
    render(
      <GateConditionEditor
        value={null}
        onChange={onChange}
        isProgressPage={true}
        onProgressPageChange={() => {}}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    const checkbox = screen
      .getByText('純潔者限定')
      .parentElement?.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    expect(onChange).toHaveBeenCalledWith({ pristineOnly: true });
  });

  it('現有旗標無論是否進度頁模式都顯示', () => {
    render(
      <GateConditionEditor
        value={{ requiresFlags: ['completed:history/1-1', 'met:norvia'] }}
        onChange={() => {}}
        isProgressPage={true}
        onProgressPageChange={() => {}}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    expect(screen.getByText('completed:history/1-1')).toBeInTheDocument();
    expect(screen.getByText('met:norvia')).toBeInTheDocument();
  });
});
