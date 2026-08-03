/**
 * IdleVeil 渲染層測試
 *
 * 視覺本身（霧的濃度、漂移、擦拭洞）jsdom 驗不了，但**結構**驗得了，
 * 而這些結構每一項都對應一個具體的視覺行為：
 *
 * - 兩層 fog：邊界要蠕動，單層是一個完美橢圓
 * - surge 掛 `key={stage}`：靠重新掛載重播湧入動畫，class 切換不會觸發
 * - `--ivl-c` 寫在 root：CSS 的 @property 靠它插值，寫錯位置就退回逐格硬跳
 * - **沒有獨立的擦拭圖層**：擦拭洞是每層霧遮罩的一部分（`--ivl-hole` +
 *   `mask-composite: subtract`）。曾經有一個 `.ivl-wipe` 元素想用
 *   `mix-blend-mode: destination-out` 擦霧——那不是合法的 blend mode 值，
 *   宣告被丟棄後它就把自己的黑色 gradient 畫成一顆大黑球。
 */
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  forceVeilStage,
  stopIdleVeil,
  startIdleVeil,
} from '../../../lib/idleVeil';
import { clearUepSettingsCache } from '../../../lib/uepSettings';
import IdleVeil from '../IdleVeil';

describe('IdleVeil', () => {
  beforeEach(() => {
    clearUepSettingsCache();
    delete window.__uepSettings;
    startIdleVeil();
  });

  afterEach(() => {
    stopIdleVeil();
    vi.restoreAllMocks();
  });

  it('沒有帷幕時什麼都不渲染', () => {
    const { container } = render(<IdleVeil />);
    expect(container.querySelector('.ivl')).toBeNull();
  });

  it('升起時渲染兩層霧、靜電與湧入波', () => {
    const { container } = render(<IdleVeil />);
    act(() => forceVeilStage(1));

    const root = container.querySelector('.ivl');
    expect(root).toBeTruthy();
    expect(container.querySelectorAll('.ivl-fog').length).toBe(2);
    expect(container.querySelector('.ivl-static')).toBeTruthy();
    expect(container.querySelector('.ivl-surge')).toBeTruthy();
  });

  it('擦拭洞是遮罩不是圖層——不存在會被畫出來的第四層', () => {
    const { container } = render(<IdleVeil />);
    act(() => forceVeilStage(3));

    // 這一條釘的是「大黑球」事故：任何獨立的擦拭 div 都會被直接畫在畫面上。
    // 列舉全部子層而不是數個數——之後多一層裝飾不該讓這個測試失敗，
    // 但多一層「擦拭」該讓它失敗
    const classes = [...(container.querySelector('.ivl')?.children ?? [])].map(
      (el) => el.className
    );
    expect(classes).toEqual([
      'ivl-fog ivl-fog--a',
      'ivl-fog ivl-fog--b',
      'ivl-static',
      'ivl-surge',
      'ivl-word',
    ]);
  });

  it('濃度寫成 root 的 --ivl-c（CSS 靠它插值）', () => {
    const { container } = render(<IdleVeil />);
    act(() => forceVeilStage(2));

    const root = container.querySelector('.ivl') as HTMLElement;
    const c = Number(root.style.getPropertyValue('--ivl-c'));
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(1);
  });

  it('階段標在 class 上，「空曠~」只在階段三出現', () => {
    const { container } = render(<IdleVeil />);

    act(() => forceVeilStage(1));
    expect(container.querySelector('.ivl--s1')).toBeTruthy();
    expect(container.querySelector('.ivl-word')).toBeNull();

    act(() => forceVeilStage(3));
    expect(container.querySelector('.ivl--s3')).toBeTruthy();
    expect(container.querySelector('.ivl-word')?.textContent).toBe('空曠~');
  });

  it('不吃互動——撥開帷幕的方式是動，不是點', () => {
    const { container } = render(<IdleVeil />);
    act(() => forceVeilStage(3));

    const root = container.querySelector('.ivl') as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    // pointer-events 在 CSS 裡，這裡只能確認沒有任何可互動元素混進來
    expect(root.querySelector('button, a, input')).toBeNull();
  });
});
