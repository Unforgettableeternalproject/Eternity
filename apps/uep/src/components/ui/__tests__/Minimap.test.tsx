/**
 * Minimap 轉場階段機測試（S10-0）
 *
 * 只驗證區域轉場的讓位行為與圖層歸屬，不覆蓋拖曳定位邏輯
 * （那份與浮島共用，見 islands/__tests__/dragPosition.test.ts）。
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ZONES } from '../../../data/zones';
import { MINIMAP_Z } from '../../../islands/types';
import {
  acquireZoneEntryLock,
  resetZoneEntryLock,
} from '../../zone/zoneEntryLock';
import Minimap from '../Minimap';

/** 必須與 Minimap.tsx 的 MINIMAP_LEAVE_MS 對齊 */
const LEAVE_MS = 280;

/**
 * 觸發 CSS 動畫結束事件。
 *
 * jsdom 沒有 `window.AnimationEvent`，React 會改聽 `webkitAnimationEnd`，
 * 所以 `fireEvent.animationEnd()` 送的標準事件進不到 onAnimationEnd
 * （native listener 收得到、React 收不到，且不報錯）。詳見
 * islands/__tests__/DraggableIsland.test.tsx 的同名輔助函式。
 */
function fireAnimationEnd(element: Element) {
  fireEvent(element, new Event('webkitAnimationEnd', { bubbles: true }));
}

function renderMinimap() {
  const { container } = render(<Minimap zones={ZONES} currentId="history" />);
  const el = container.querySelector('.uep-minimap');
  if (!el) throw new Error('Minimap 未渲染');
  return el as HTMLElement;
}

describe('Minimap 轉場階段機', () => {
  beforeEach(() => {
    resetZoneEntryLock();
    localStorage.clear();
  });

  afterEach(() => {
    resetZoneEntryLock();
    vi.useRealTimers();
  });

  it('常態下不帶轉場 class，圖層落在浮島層帶（不再是被內容蓋住的 300）', () => {
    const el = renderMinimap();
    expect(el.className).toBe('uep-minimap');
    expect(el.style.zIndex).toBe(String(MINIMAP_Z));
    expect(MINIMAP_Z).toBeGreaterThan(1899);
    expect(el.style.visibility).not.toBe('hidden');
  });

  it('轉場開始播離場動畫，動畫結束後讓位', () => {
    const el = renderMinimap();

    act(() => {
      acquireZoneEntryLock();
    });
    expect(el.className).toContain('uep-minimap--leaving');
    expect(el.style.visibility).not.toBe('hidden');

    act(() => {
      fireAnimationEnd(el);
    });
    expect(el.className).not.toContain('uep-minimap--leaving');
    expect(el.style.visibility).toBe('hidden');
    expect(el.style.pointerEvents).toBe('none');
  });

  it('轉場結束播進場動畫，動畫結束回到常態', () => {
    const el = renderMinimap();
    let release!: () => void;

    act(() => {
      release = acquireZoneEntryLock();
    });
    act(() => {
      fireAnimationEnd(el);
    });
    expect(el.style.visibility).toBe('hidden');

    act(() => {
      release();
    });
    expect(el.className).toContain('uep-minimap--entering');
    // 進場動畫期間就要重新現身，否則等於動畫播給沒人看
    expect(el.style.visibility).not.toBe('hidden');

    act(() => {
      fireAnimationEnd(el);
    });
    expect(el.className).toBe('uep-minimap');
  });

  it('reduced-motion 下 animationend 不會來，靠保底計時器推進', () => {
    vi.useFakeTimers();
    const el = renderMinimap();

    act(() => {
      acquireZoneEntryLock();
    });
    expect(el.className).toContain('uep-minimap--leaving');

    // 動畫事件刻意不送——模擬 animation 被 reduced-motion 整組關掉
    act(() => {
      vi.advanceTimersByTime(LEAVE_MS + 80);
    });
    expect(el.style.visibility).toBe('hidden');
  });

  it('轉場進行中掛載直接讓位，不播沒人看得到的動畫', () => {
    act(() => {
      acquireZoneEntryLock();
    });
    const el = renderMinimap();

    expect(el.style.visibility).toBe('hidden');
    expect(el.className).toBe('uep-minimap');
  });
});
