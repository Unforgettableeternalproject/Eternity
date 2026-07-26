/**
 * entity 拖曳來源 hook 測試（S10-1 T-H2）
 *
 * 重點在三條規則的落地：
 * 1. 收合／未掛載的便條島**完全不接**——連 ghost 都不出現
 * 2. dossier 查不到 canonical name 的 key 不可拖
 * 3. 門檻內的位移還是一次點擊（條目卡本來的 click 不能被吃掉）
 *
 * bridge 與索引載入都 mock 掉：純函式部分已在 entityDropBridge.test.ts
 * 覆蓋，這裡測的是 pointer 狀態機。
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMock = vi.hoisted(() => ({
  expanded: true,
  overIsland: true,
  canonical: null as string | null,
  drop: vi.fn(() => true),
}));
vi.mock('../entityDropBridge', () => ({
  isStorageIslandOpenAndExpanded: () => bridgeMock.expanded,
  isEntityDropTarget: () => bridgeMock.overIsland,
  findCanonicalEntityName: () => bridgeMock.canonical,
  dropEntityText: bridgeMock.drop,
}));

vi.mock('../../concepts/terminalCore', () => ({
  loadEntityIndex: () => Promise.resolve([]),
}));

vi.mock('../../islandRuntime', () => ({
  shouldMountIsland: () => true,
}));

import { useEntityDragSource } from '../useEntityDragSource';

function Harness({ onClick }: { onClick?: () => void }) {
  const drag = useEntityDragSource();
  return (
    <div data-testid="zone" {...drag.handlers}>
      <button type="button" data-entity-key="xavier-colsono" onClick={onClick}>
        艾斯維爾
      </button>
      {drag.ghost}
    </div>
  );
}

const START = { clientX: 100, clientY: 100, pointerId: 1 };
const FAR = { clientX: 180, clientY: 160, pointerId: 1 };

function dragTo(el: HTMLElement, to: typeof FAR) {
  fireEvent.pointerDown(el, START);
  fireEvent.pointerMove(el, to);
  fireEvent.pointerUp(el, to);
}

const toastMock = { success: vi.fn(), info: vi.fn() };

beforeEach(() => {
  bridgeMock.expanded = true;
  bridgeMock.overIsland = true;
  bridgeMock.canonical = '艾斯維爾·科索諾';
  bridgeMock.drop.mockReset().mockReturnValue(true);
  toastMock.success.mockReset();
  toastMock.info.mockReset();
  window.__uepToastManager = toastMock as never;
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => false;
  }
});

afterEach(() => {
  delete window.__uepToastManager;
});

describe('useEntityDragSource — 拖曳落地', () => {
  it('拖過門檻並放在島上 → 用 canonical name 建立便條', () => {
    render(<Harness />);
    dragTo(screen.getByRole('button'), FAR);
    expect(bridgeMock.drop).toHaveBeenCalledWith('艾斯維爾·科索諾');
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('放開時不在島上 → 不建立便條', () => {
    bridgeMock.overIsland = false;
    render(<Harness />);
    dragTo(screen.getByRole('button'), FAR);
    expect(bridgeMock.drop).not.toHaveBeenCalled();
  });

  it('便條已滿（drop 回 false）→ 給提示而不是靜默', () => {
    bridgeMock.drop.mockReturnValue(false);
    render(<Harness />);
    dragTo(screen.getByRole('button'), FAR);
    expect(toastMock.info).toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe('useEntityDragSource — 不接拖曳的情況', () => {
  it('便條島收合／未掛載 → 連 ghost 都不出現，也不建立便條', () => {
    bridgeMock.expanded = false;
    const { container } = render(<Harness />);
    fireEvent.pointerDown(screen.getByRole('button'), START);
    fireEvent.pointerMove(screen.getByRole('button'), FAR);
    expect(container.querySelector('.uep-entity-drag')).toBeNull();
    fireEvent.pointerUp(screen.getByRole('button'), FAR);
    expect(bridgeMock.drop).not.toHaveBeenCalled();
  });

  it('dossier 查不到 canonical name → 不可拖', () => {
    bridgeMock.canonical = null;
    render(<Harness />);
    dragTo(screen.getByRole('button'), FAR);
    expect(bridgeMock.drop).not.toHaveBeenCalled();
  });

  it('落點不帶 entityKey（容器空白處）→ 不可拖', () => {
    render(<Harness />);
    dragTo(screen.getByTestId('zone'), FAR);
    expect(bridgeMock.drop).not.toHaveBeenCalled();
  });
});

describe('useEntityDragSource — 與點擊共存', () => {
  it('位移在門檻內 → 算點擊，條目卡的 onClick 照常發生', () => {
    const onClick = vi.fn();
    render(<Harness onClick={onClick} />);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn, START);
    fireEvent.pointerMove(btn, { clientX: 103, clientY: 102, pointerId: 1 });
    fireEvent.pointerUp(btn, { clientX: 103, clientY: 102, pointerId: 1 });
    fireEvent.click(btn);
    expect(bridgeMock.drop).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('拖曳中顯示 ghost 與連線，放開後收掉', () => {
    render(<Harness />);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn, START);
    fireEvent.pointerMove(btn, FAR);
    const ghost = document.querySelector('.uep-entity-drag__ghost');
    expect(ghost?.textContent).toBe('艾斯維爾·科索諾');
    expect(document.querySelector('.uep-entity-drag__line')).not.toBeNull();
    fireEvent.pointerUp(btn, FAR);
    expect(document.querySelector('.uep-entity-drag')).toBeNull();
  });

  it('pointercancel（手勢被系統接管）→ 收掉 ghost，不建立便條', () => {
    render(<Harness />);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn, START);
    fireEvent.pointerMove(btn, FAR);
    fireEvent.pointerCancel(btn, FAR);
    expect(document.querySelector('.uep-entity-drag')).toBeNull();
    expect(bridgeMock.drop).not.toHaveBeenCalled();
  });

  it('另一根手指的 pointerup 不會誤觸落地，也不會把進行中的拖曳打斷', () => {
    render(<Harness />);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn, START);
    fireEvent.pointerMove(btn, FAR);
    fireEvent.pointerUp(btn, { ...FAR, pointerId: 2 });
    expect(bridgeMock.drop).not.toHaveBeenCalled();
    // 原本那根還在拖：ghost 仍在，放開時才落地
    expect(document.querySelector('.uep-entity-drag')).not.toBeNull();
    fireEvent.pointerUp(btn, FAR);
    expect(bridgeMock.drop).toHaveBeenCalledWith('艾斯維爾·科索諾');
  });
});
