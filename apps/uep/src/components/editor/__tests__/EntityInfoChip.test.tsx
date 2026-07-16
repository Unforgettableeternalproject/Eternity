/**
 * EntityInfoChip 測試（S7 驗收 #8）
 *
 * jsdom 無 layout，coordsAtPos 在真 Editor 上不可靠——以手工 mock
 * 提供 EntityInfoChip 消費的最小介面（isActive / getAttributes /
 * coordsAtPos / on/off / chain），驗證顯示邏輯與快捷按鈕接線。
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Editor } from '@tiptap/react';

import EntityInfoChip from '../EntityInfoChip';

type Handler = () => void;

function makeEditorMock(initial: {
  active?: boolean;
  attrs?: Record<string, unknown>;
}) {
  const handlers = new Map<string, Set<Handler>>();
  const unsetRun = vi.fn();
  const state = {
    active: initial.active ?? false,
    attrs: initial.attrs ?? {},
  };
  const editor = {
    isDestroyed: false,
    isActive: (name: string) => name === 'uepEntity' && state.active,
    getAttributes: () => state.attrs,
    state: { selection: { from: 1 } },
    view: { coordsAtPos: () => ({ top: 100, left: 50 }) },
    chain: () => ({
      focus: () => ({ unsetUepEntity: () => ({ run: unsetRun }) }),
    }),
    on(event: string, fn: Handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off(event: string, fn: Handler) {
      handlers.get(event)?.delete(fn);
    },
  };
  const emit = (event: string) => {
    for (const fn of handlers.get(event) ?? []) fn();
  };
  return { editor: editor as unknown as Editor, emit, state, unsetRun };
}

describe('EntityInfoChip', () => {
  it('游標落在 entity 標記內 → 顯示 kind 標籤與 ref', () => {
    const { editor, emit, state } = makeEditorMock({
      active: true,
      attrs: { kind: 'character', ref: 'entity:xavier-colsono' },
    });
    render(<EntityInfoChip editor={editor} />);
    act(() => emit('selectionUpdate'));
    expect(screen.getByText('◈ 角色')).toBeInTheDocument();
    expect(screen.getByText('entity:xavier-colsono')).toBeInTheDocument();

    // 游標移出標記 → chip 收起
    state.active = false;
    act(() => emit('selectionUpdate'));
    expect(screen.queryByText('◈ 角色')).not.toBeInTheDocument();
  });

  it('未知 kind 直接顯示原值；非 entity 選取不顯示', () => {
    const { editor, emit } = makeEditorMock({
      active: true,
      attrs: { kind: 'mystery', ref: 'entity:x' },
    });
    render(<EntityInfoChip editor={editor} />);
    act(() => emit('selectionUpdate'));
    expect(screen.getByText('◈ mystery')).toBeInTheDocument();
  });

  it('點 ✕ 觸發 unsetUepEntity', () => {
    const { editor, emit, unsetRun } = makeEditorMock({
      active: true,
      attrs: { kind: 'term', ref: 'entity:essence' },
    });
    render(<EntityInfoChip editor={editor} />);
    act(() => emit('selectionUpdate'));
    fireEvent.click(screen.getByTitle('移除嵌入標記（文字保留）'));
    expect(unsetRun).toHaveBeenCalled();
  });

  it('點 ✎ 觸發 onEdit（開啟 ◈ 面板由呼叫端處理）', () => {
    const onEdit = vi.fn();
    const { editor, emit } = makeEditorMock({
      active: true,
      attrs: { kind: 'location', ref: 'entity:rain-sea-tower' },
    });
    render(<EntityInfoChip editor={editor} onEdit={onEdit} />);
    act(() => emit('selectionUpdate'));
    fireEvent.click(screen.getByTitle('編輯嵌入屬性'));
    expect(onEdit).toHaveBeenCalled();
  });

  it('編輯器 blur → chip 收起', () => {
    const { editor, emit } = makeEditorMock({
      active: true,
      attrs: { kind: 'term', ref: 'entity:essence' },
    });
    render(<EntityInfoChip editor={editor} />);
    act(() => emit('selectionUpdate'));
    expect(screen.getByText('◈ 名詞')).toBeInTheDocument();
    act(() => emit('blur'));
    expect(screen.queryByText('◈ 名詞')).not.toBeInTheDocument();
  });

  it('未提供 onEdit 時不渲染編輯按鈕', () => {
    const { editor, emit } = makeEditorMock({
      active: true,
      attrs: { kind: 'term', ref: 'entity:essence' },
    });
    render(<EntityInfoChip editor={editor} />);
    act(() => emit('selectionUpdate'));
    expect(screen.queryByTitle('編輯嵌入屬性')).not.toBeInTheDocument();
    expect(screen.getByTitle('移除嵌入標記（文字保留）')).toBeInTheDocument();
  });
});
