/**
 * DraggableIsland 生命週期階段機測試（S9-D）
 *
 * 只驗證外殼的階段轉換（entering/idle/leaving/hiding/hidden），
 * 不覆蓋拖曳定位邏輯（見 dragPosition.test.ts）。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireZoneEntryLock,
  resetZoneEntryLock,
} from '../../components/zone/zoneEntryLock';
import DraggableIsland from '../DraggableIsland';

const runtime = vi.hoisted(() => ({
  close: vi.fn(),
  focus: vi.fn(),
  setPosition: vi.fn(),
  zIndexOf: () => 2000,
}));

vi.mock('../islandRuntime', () => ({
  getIslandRuntime: () => runtime,
}));

vi.mock('../useIslands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../useIslands')>()),
  useIslandRuntimeState: () => ({
    windows: {
      history: {
        version: 2,
        open: true,
        position: null,
        updatedAt: '2026-07-26T00:00:00.000Z',
      },
    },
    focusOrder: ['history'],
  }),
}));

/** history 島 leaveMs=380（ISLAND_DEFINITIONS），保底計時器為 leaveMs+80 */
const HISTORY_LEAVE_MS = 380;

function renderIsland() {
  render(<DraggableIsland id="history">內容</DraggableIsland>);
  return screen.getByRole('dialog', { name: '旅程之書' });
}

/**
 * 觸發元素的 CSS 動畫結束事件。
 *
 * 這個測試環境（jsdom）沒有 `window.AnimationEvent`，而 React 會依
 * `'WebkitAnimation' in style` 偵測結果改聽 `webkitAnimationEnd`
 * 而非標準的 `animationend`——`fireEvent.animationEnd()` 送出的原生
 * 事件因此不會進到 React 的 onAnimationEnd handler（native listener
 * 收得到、React 收不到）。故意送這個廠商前綴事件名才吃得到。
 */
function fireAnimationEnd(element: Element) {
  fireEvent(element, new Event('webkitAnimationEnd', { bubbles: true }));
}

describe('DraggableIsland — 生命週期階段機', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetZoneEntryLock();
    runtime.close.mockClear();
    runtime.focus.mockClear();
    runtime.setPosition.mockClear();
  });

  afterEach(() => {
    resetZoneEntryLock();
    vi.useRealTimers();
  });

  it('mount 時掛 uep-island--entering，動畫結束後移除', () => {
    const root = renderIsland();
    expect(root).toHaveClass('uep-island--entering');

    fireAnimationEnd(root);
    expect(root).not.toHaveClass('uep-island--entering');
  });

  it('reduced-motion（animationend 不觸發）靠保底計時器移除 entering', () => {
    const root = renderIsland();
    expect(root).toHaveClass('uep-island--entering');

    act(() => {
      vi.advanceTimersByTime(HISTORY_LEAVE_MS + 80);
    });
    expect(root).not.toHaveClass('uep-island--entering');
  });

  it('acquireZoneEntryLock 後掛 leaving，動畫結束進 hidden；釋放鎖後回到 entering', () => {
    const root = renderIsland();
    // 先讓進場動畫結束，避免與轉場階段疊在一起混淆
    fireAnimationEnd(root);
    expect(root).not.toHaveClass('uep-island--entering');

    let release = () => {};
    act(() => {
      release = acquireZoneEntryLock();
    });
    expect(root).toHaveClass('uep-island--leaving');

    fireAnimationEnd(root);
    // hidden 用 visibility 而非 display:none（島是 fixed 不佔流；
    // display:none 會讓 offsetWidth 量成 0，轉場期間才 mount 的島
    // 會拿著 0×0 去算預設角落座標）
    expect(root).toHaveStyle({ visibility: 'hidden', pointerEvents: 'none' });

    act(() => {
      release();
    });
    expect(root).toHaveClass('uep-island--entering');
    expect(root).not.toHaveStyle({ visibility: 'hidden' });
  });

  it('轉場隱藏在 reduced-motion 下也靠保底計時器進 hidden', () => {
    const root = renderIsland();
    fireAnimationEnd(root);

    act(() => {
      acquireZoneEntryLock();
    });
    expect(root).toHaveClass('uep-island--leaving');

    act(() => {
      vi.advanceTimersByTime(HISTORY_LEAVE_MS + 80);
    });
    expect(root).toHaveStyle({ visibility: 'hidden', pointerEvents: 'none' });
  });

  it('轉場隱藏全程不會呼叫 runtime.close——島仍是展開狀態，只是讓位', () => {
    const root = renderIsland();
    fireAnimationEnd(root);

    act(() => {
      acquireZoneEntryLock();
    });
    fireAnimationEnd(root);

    expect(runtime.close).not.toHaveBeenCalled();
  });
});
