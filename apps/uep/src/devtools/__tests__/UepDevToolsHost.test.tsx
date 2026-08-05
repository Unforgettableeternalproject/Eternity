/**
 * DevTools 掛載守門測試（S11 A-1）
 *
 * 手機不該出現 DevTools：面板是三欄命令列表，390px 上不可用，
 * FAB 還會擋住右下角。守門必須在**渲染**層而不只是 CSS 隱藏——
 * 藏起來的按鈕仍然可以被 tab 聚焦。
 */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/apiBase', () => ({
  isTestMode: () => true,
  getApiBase: () => 'https://example.test',
}));

vi.mock('../actions', () => ({ registerAllActions: () => {} }));

let desktop = true;
vi.mock('../../islands', () => ({
  useDesktopIslandViewport: () => desktop,
}));

import UepDevToolsHost from '../UepDevTools';

beforeEach(() => {
  desktop = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DevTools 掛載守門', () => {
  it('桌面寬度掛載 FAB', () => {
    desktop = true;
    render(<UepDevToolsHost />);
    expect(document.querySelector('.uep-devtools-fab')).not.toBeNull();
  });

  it('手機寬度完全不渲染——不是靠 CSS 藏起來', () => {
    desktop = false;
    render(<UepDevToolsHost />);
    expect(document.querySelector('.uep-devtools-fab')).toBeNull();
    expect(document.querySelector('.uep-devtools-panel')).toBeNull();
  });
});
