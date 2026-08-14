/**
 * GateConditionEditor 測試（E 步驟：progressPage toggle 相關）
 *
 * 涵蓋新加的 UI 行為：
 * - progressPage toggle 只在 onProgressPageChange 提供時顯示（向後相容）
 * - isProgressPage=true → 「需先讀完」picker 完全收起
 * - toggle 切換觸發 onProgressPageChange
 * - 進度頁模式下自訂旗標與純潔者限定仍可用（T-A6 起自訂旗標走 FlagPicker）
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
    expect(screen.queryByText('progress page')).not.toBeInTheDocument();
    // 「requires completion」按鈕仍存在
    expect(screen.getByText(/requires completion/)).toBeInTheDocument();
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
    expect(screen.getByText('progress page')).toBeInTheDocument();
  });

  it('isProgressPage=true 時 picker 仍顯示（與鏈條件聯集），並顯示提示文字', () => {
    const { container } = render(
      <GateConditionEditor
        value={null}
        onChange={() => {}}
        isProgressPage={true}
        onProgressPageChange={() => {}}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    // picker 觸發按鈕存在——可同時是進度頁又指定特定頁面
    const pickerButton = container.querySelector('.ned-gate-add-page');
    expect(pickerButton).toBeInTheDocument();
    expect(pickerButton?.textContent).toMatch(/requires completion/);
    // 提示文字顯示
    expect(
      screen.getByText(/進度頁：解鎖倚賴同層前一個進度頁完成/)
    ).toBeInTheDocument();
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
      .getByText('progress page')
      .parentElement?.querySelector('input[type="checkbox"]');
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle!);
    expect(onProgressPageChange).toHaveBeenCalledWith(true);
  });

  /**
   * 四維條件是聯集，進度頁模式下自訂旗標區塊不可消失。
   *
   * T-A6 起這一欄是 FlagPicker（只能選註冊表裡的旗標），不再是自由輸入——
   * 原本這個測試打 `met:novia` 按 Enter 直接加入，那條路已刻意移除。
   */
  it('進度頁模式下自訂旗標 picker 仍可用', async () => {
    const onChange = vi.fn();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: { flags: [{ name: 'novia-met', label: null, category: null }] },
      }),
    })) as unknown as typeof fetch;

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
    fireEvent.focus(screen.getByPlaceholderText(/custom flag/));
    fireEvent.click(await screen.findByText('novia-met'));
    expect(onChange).toHaveBeenCalledWith({ requiresFlags: ['novia-met'] });
    vi.restoreAllMocks();
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
      .getByText('pristine only')
      .parentElement?.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    expect(onChange).toHaveBeenCalledWith({ pristineOnly: true });
  });

  it('現有旗標無論是否進度頁模式都顯示', () => {
    render(
      <GateConditionEditor
        value={{ requiresFlags: ['completed:history/1-1', 'met:novia'] }}
        onChange={() => {}}
        isProgressPage={true}
        onProgressPageChange={() => {}}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    expect(screen.getByText('completed:history/1-1')).toBeInTheDocument();
    expect(screen.getByText('met:novia')).toBeInTheDocument();
  });
});

describe('GateConditionEditor — gateExempt 豁免 toggle', () => {
  it('未提供 onGateExemptChange 時不顯示 toggle（向後相容）', () => {
    render(
      <GateConditionEditor
        value={null}
        onChange={() => {}}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    expect(screen.queryByText('exempt from container')).not.toBeInTheDocument();
  });

  it('切換 toggle 觸發 onGateExemptChange，勾選時顯示豁免提示', () => {
    const onGateExemptChange = vi.fn();
    const { rerender } = render(
      <GateConditionEditor
        value={null}
        onChange={() => {}}
        isGateExempt={false}
        onGateExemptChange={onGateExemptChange}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    const toggle = screen
      .getByText('exempt from container')
      .parentElement?.querySelector('input[type="checkbox"]');
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle!);
    expect(onGateExemptChange).toHaveBeenCalledWith(true);

    rerender(
      <GateConditionEditor
        value={null}
        onChange={() => {}}
        isGateExempt={true}
        onGateExemptChange={onGateExemptChange}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    expect(
      screen.getByText(/豁免：本頁與其底下子頁不再等待父容器/)
    ).toBeInTheDocument();
  });

  it('豁免與進度頁 toggle 可同時存在（語意正交）', () => {
    render(
      <GateConditionEditor
        value={null}
        onChange={() => {}}
        isProgressPage={true}
        onProgressPageChange={() => {}}
        isGateExempt={true}
        onGateExemptChange={() => {}}
        apiBase="http://localhost"
        accent="#000"
      />
    );
    expect(screen.getByText('progress page')).toBeInTheDocument();
    expect(screen.getByText('exempt from container')).toBeInTheDocument();
  });
});

/**
 * 「被別人當成 completed 依賴、卻勾了豁免」的誤設提醒（S10-4 D 段）。
 *
 * 這個組合幾乎必是誤設——2026-07-06 的浮島計數診斷就是踩到它——但在此之前
 * 沒有任何防呆。它是提醒不是驗證：查詢失敗或沒有依賴時完全不出現，也不擋存檔。
 */
describe('GateConditionEditor — gateExempt 誤設提醒', () => {
  function mockAudit(flags: unknown[]) {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, data: { flags } }),
    })) as unknown as typeof fetch;
  }

  const baseProps = {
    value: null,
    onChange: () => {},
    onGateExemptChange: () => {},
    apiBase: 'http://localhost',
    accent: '#000',
  };

  it('有其他頁把本頁列為需先讀完時提醒', async () => {
    mockAudit([
      {
        name: 'completed:history/a',
        requiredBy: [{ id: 'history/b', title: '第二章' }],
      },
    ]);
    render(
      <GateConditionEditor
        {...baseProps}
        isGateExempt={true}
        pageId="history/a"
      />
    );
    expect(await screen.findByText(/第二章/)).toBeInTheDocument();
  });

  it('沒有依賴者時不提醒', async () => {
    mockAudit([{ name: 'completed:history/a', requiredBy: [] }]);
    render(
      <GateConditionEditor
        {...baseProps}
        isGateExempt={true}
        pageId="history/a"
      />
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/通常是誤設/)).not.toBeInTheDocument();
  });

  it('沒勾豁免時根本不查——只有這個組合才有問題', async () => {
    mockAudit([
      {
        name: 'completed:history/a',
        requiredBy: [{ id: 'history/b', title: '第二章' }],
      },
    ]);
    render(
      <GateConditionEditor
        {...baseProps}
        isGateExempt={false}
        pageId="history/a"
      />
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/通常是誤設/)).not.toBeInTheDocument();
  });

  it('換頁時先清掉上一頁的結果——新查詢失敗不該留著舊警告', async () => {
    mockAudit([
      {
        name: 'completed:history/a',
        requiredBy: [{ id: 'history/b', title: '第二章' }],
      },
    ]);
    const { rerender } = render(
      <GateConditionEditor
        {...baseProps}
        isGateExempt={true}
        pageId="history/a"
      />
    );
    expect(await screen.findByText(/第二章/)).toBeInTheDocument();

    // 換到另一頁，而這次查詢失敗
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    rerender(
      <GateConditionEditor
        {...baseProps}
        isGateExempt={true}
        pageId="history/z"
      />
    );
    await new Promise((r) => setTimeout(r, 0));

    // 舊頁的依賴清單留在畫面上，就是對著毫不相干的頁面發警告
    expect(screen.queryByText(/第二章/)).not.toBeInTheDocument();
  });

  it('查詢失敗時靜默——提醒缺席比誤報好，也不該擋住編輯', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    render(
      <GateConditionEditor
        {...baseProps}
        isGateExempt={true}
        pageId="history/a"
      />
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/通常是誤設/)).not.toBeInTheDocument();
    expect(screen.getByText('exempt from container')).toBeInTheDocument();
  });
});
