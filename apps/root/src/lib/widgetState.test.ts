import { describe, it, expect, beforeEach } from 'vitest';
import {
  getWidgetState,
  setWidgetState,
  resetWidgetState,
  toggleWidgetMode,
  toggleWidgetPinned,
  updateWidgetPosition,
  ALL_WIDGETS,
  WIDGET_META,
} from './widgetState';
import type { WidgetState, WidgetId } from './widgetState';

// 每個測試前清除 localStorage
beforeEach(() => {
  localStorage.clear();
});

describe('getWidgetState', () => {
  it('localStorage 為空時回傳預設狀態', () => {
    const state = getWidgetState();
    expect(state.mode).toBe('edge-tabs');
    expect(state.order).toEqual(ALL_WIDGETS);
    // 所有 widget 預設啟用
    for (const id of ALL_WIDGETS) {
      expect(state.enabled[id]).toBe(true);
    }
    // 所有 widget 預設未 pin
    for (const id of ALL_WIDGETS) {
      expect(state.pinned[id]).toBe(false);
    }
    expect(state.positions).toEqual({});
  });

  it('能讀取 localStorage 中的已儲存狀態', () => {
    const saved: WidgetState = {
      mode: 'toolbox',
      enabled: {
        music: false,
        visitor: true,
        quote: true,
        portal: false,
        status: true,
        uep: true,
      },
      pinned: {
        music: true,
        visitor: false,
        quote: false,
        portal: false,
        status: false,
        uep: false,
      },
      positions: { music: { x: 100, y: 200 } },
      order: ALL_WIDGETS,
    };
    localStorage.setItem('root-widget-state', JSON.stringify(saved));

    const state = getWidgetState();
    expect(state.mode).toBe('toolbox');
    expect(state.enabled.music).toBe(false);
    expect(state.pinned.music).toBe(true);
    expect(state.positions.music).toEqual({ x: 100, y: 200 });
  });

  it('部分欄位缺失時用預設值補上', () => {
    // 只存了 mode，其他欄位缺失
    localStorage.setItem(
      'root-widget-state',
      JSON.stringify({ mode: 'toolbox' })
    );

    const state = getWidgetState();
    expect(state.mode).toBe('toolbox');
    // 缺失的 enabled 用預設值補上
    for (const id of ALL_WIDGETS) {
      expect(state.enabled[id]).toBe(true);
    }
    expect(state.order).toEqual(ALL_WIDGETS);
  });

  it('localStorage 中 JSON 損壞時回傳預設狀態', () => {
    localStorage.setItem('root-widget-state', '{invalid json!!!');

    const state = getWidgetState();
    expect(state.mode).toBe('edge-tabs');
    expect(state.order).toEqual(ALL_WIDGETS);
  });

  it('order 長度不匹配時重置為預設順序', () => {
    localStorage.setItem(
      'root-widget-state',
      JSON.stringify({
        mode: 'toolbox',
        order: ['music', 'visitor'], // 太短
      })
    );

    const state = getWidgetState();
    expect(state.order).toEqual(ALL_WIDGETS);
  });
});

describe('setWidgetState', () => {
  it('能 partial merge 更新狀態', () => {
    setWidgetState({ mode: 'toolbox' });

    const state = getWidgetState();
    expect(state.mode).toBe('toolbox');
    // 其他欄位維持預設
    expect(state.enabled.music).toBe(true);
  });

  it('能更新單一 widget 的 enabled', () => {
    setWidgetState({ enabled: { music: false } as WidgetState['enabled'] });

    const state = getWidgetState();
    expect(state.enabled.music).toBe(false);
    // 其他 widget 不受影響
    expect(state.enabled.visitor).toBe(true);
  });

  it('能更新 pinned 而不影響其他欄位', () => {
    setWidgetState({ pinned: { quote: true } as WidgetState['pinned'] });

    const state = getWidgetState();
    expect(state.pinned.quote).toBe(true);
    expect(state.pinned.music).toBe(false);
    expect(state.mode).toBe('edge-tabs');
  });

  it('能更新 positions', () => {
    setWidgetState({ positions: { uep: { x: 50, y: 75 } } });

    const state = getWidgetState();
    expect(state.positions.uep).toEqual({ x: 50, y: 75 });
  });

  it('回傳更新後的完整狀態', () => {
    const result = setWidgetState({ mode: 'toolbox' });
    expect(result.mode).toBe('toolbox');
    expect(result.enabled).toBeDefined();
    expect(result.pinned).toBeDefined();
  });

  it('連續 partial merge 會累積', () => {
    setWidgetState({ mode: 'toolbox' });
    setWidgetState({ enabled: { music: false } as WidgetState['enabled'] });
    setWidgetState({ pinned: { visitor: true } as WidgetState['pinned'] });

    const state = getWidgetState();
    expect(state.mode).toBe('toolbox');
    expect(state.enabled.music).toBe(false);
    expect(state.pinned.visitor).toBe(true);
  });
});

describe('resetWidgetState', () => {
  it('重置後回傳預設狀態', () => {
    // 先修改一些值
    setWidgetState({ mode: 'toolbox' });
    setWidgetState({ enabled: { music: false } as WidgetState['enabled'] });

    const state = resetWidgetState();
    expect(state.mode).toBe('edge-tabs');
    expect(state.enabled.music).toBe(true);
  });

  it('重置後 localStorage 被清除', () => {
    setWidgetState({ mode: 'toolbox' });
    resetWidgetState();

    expect(localStorage.getItem('root-widget-state')).toBeNull();
  });

  it('重置後再 get 也是預設狀態', () => {
    setWidgetState({ mode: 'toolbox' });
    resetWidgetState();

    const state = getWidgetState();
    expect(state.mode).toBe('edge-tabs');
  });
});

describe('toggleWidgetMode', () => {
  it('預設 edge-tabs → 切換為 toolbox', () => {
    const mode = toggleWidgetMode();
    expect(mode).toBe('toolbox');
    expect(getWidgetState().mode).toBe('toolbox');
  });

  it('toolbox → 切換為 edge-tabs', () => {
    setWidgetState({ mode: 'toolbox' });
    const mode = toggleWidgetMode();
    expect(mode).toBe('edge-tabs');
    expect(getWidgetState().mode).toBe('edge-tabs');
  });

  it('連續切換來回', () => {
    expect(toggleWidgetMode()).toBe('toolbox');
    expect(toggleWidgetMode()).toBe('edge-tabs');
    expect(toggleWidgetMode()).toBe('toolbox');
  });
});

describe('toggleWidgetPinned', () => {
  it('預設 false → 切換為 true', () => {
    const result = toggleWidgetPinned('music');
    expect(result).toBe(true);
    expect(getWidgetState().pinned.music).toBe(true);
  });

  it('true → 切換為 false', () => {
    setWidgetState({ pinned: { music: true } as WidgetState['pinned'] });
    const result = toggleWidgetPinned('music');
    expect(result).toBe(false);
    expect(getWidgetState().pinned.music).toBe(false);
  });

  it('不影響其他 widget 的 pinned 狀態', () => {
    toggleWidgetPinned('music');
    expect(getWidgetState().pinned.visitor).toBe(false);
    expect(getWidgetState().pinned.quote).toBe(false);
  });
});

describe('updateWidgetPosition', () => {
  it('能設定 widget 位置', () => {
    updateWidgetPosition('music', { x: 100, y: 200 });
    expect(getWidgetState().positions.music).toEqual({ x: 100, y: 200 });
  });

  it('更新位置不影響其他 widget 的位置', () => {
    updateWidgetPosition('music', { x: 100, y: 200 });
    updateWidgetPosition('visitor', { x: 300, y: 400 });

    const state = getWidgetState();
    expect(state.positions.music).toEqual({ x: 100, y: 200 });
    expect(state.positions.visitor).toEqual({ x: 300, y: 400 });
  });

  it('能覆蓋已有的位置', () => {
    updateWidgetPosition('music', { x: 100, y: 200 });
    updateWidgetPosition('music', { x: 500, y: 600 });

    expect(getWidgetState().positions.music).toEqual({ x: 500, y: 600 });
  });
});

describe('ALL_WIDGETS 與 WIDGET_META', () => {
  it('ALL_WIDGETS 包含 6 個 widget', () => {
    expect(ALL_WIDGETS).toHaveLength(6);
  });

  it('每個 widget 都有 meta 定義', () => {
    for (const id of ALL_WIDGETS) {
      expect(WIDGET_META[id]).toBeDefined();
      expect(WIDGET_META[id].icon).toBeTruthy();
      expect(WIDGET_META[id].label).toBeTruthy();
      expect(WIDGET_META[id].labelEn).toBeTruthy();
    }
  });

  it('ALL_WIDGETS 的 id 和 WIDGET_META 的 key 一致', () => {
    const metaKeys = Object.keys(WIDGET_META) as WidgetId[];
    expect(metaKeys.sort()).toEqual([...ALL_WIDGETS].sort());
  });
});
