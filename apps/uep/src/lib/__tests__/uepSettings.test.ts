/**
 * uepSettings 測試
 *
 * 核心契約：getSetting 在任何失敗情境（未載入、fetch 掛掉、快取被改壞、
 * 型別不符）都退回 fallback 常數——uep 是 MPA，沒有 fallback 的話相關
 * 功能會用 undefined 算數。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getSetting,
  initUepSettings,
  clearUepSettingsCache,
} from '../uepSettings';

declare global {
  interface Window {
    __uepSettings?: Record<string, string | number>;
  }
}

const SETTINGS = {
  'protection.mode': 'never',
  'bookmark.baseChancePct': 55,
  'note.max': 12,
  'note.textMax': 100,
};

function mockFetch(payload: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    json: async () => payload,
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('uepSettings', () => {
  beforeEach(() => {
    delete window.__uepSettings;
    sessionStorage.clear();
    // initUepSettings 是模組級去重的，不重置的話前一個測試留下的
    // in-flight Promise 會讓後續測試的 init 直接短路
    clearUepSettingsCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('未載入時 getSetting 回 fallback', () => {
    expect(getSetting('note.max', 30)).toBe(30);
    expect(getSetting('protection.mode', 'env')).toBe('env');
  });

  it('init 後 getSetting 回 runtime 值，並落 sessionStorage 快取', async () => {
    mockFetch({ ok: true, data: { settings: SETTINGS } });
    await initUepSettings();

    expect(getSetting('note.max', 30)).toBe(12);
    expect(getSetting('protection.mode', 'env')).toBe('never');
    expect(
      JSON.parse(sessionStorage.getItem('uep-settings-v1') || '{}')
    ).toEqual(SETTINGS);
  });

  it('有快取時同步就緒，不再 fetch', async () => {
    sessionStorage.setItem('uep-settings-v1', JSON.stringify(SETTINGS));
    const fetchMock = mockFetch({ ok: true, data: { settings: {} } });
    await initUepSettings();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSetting('bookmark.baseChancePct', 20)).toBe(55);
  });

  it('fetch 失敗時不炸，消費點照常 fallback', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    await expect(initUepSettings()).resolves.toBeUndefined();
    expect(getSetting('note.max', 30)).toBe(30);
  });

  it('型別不符（快取被手動改壞）退回 fallback', async () => {
    window.__uepSettings = { 'note.max': '十二' as unknown as number };
    expect(getSetting('note.max', 30)).toBe(30);
  });

  it('壞 JSON 快取視同無快取，重新 fetch', async () => {
    sessionStorage.setItem('uep-settings-v1', '{broken');
    const fetchMock = mockFetch({ ok: true, data: { settings: SETTINGS } });
    await initUepSettings();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getSetting('note.max', 30)).toBe(12);
  });

  it('clearUepSettingsCache 讓下一次 init 重新 fetch', async () => {
    const fetchMock = mockFetch({ ok: true, data: { settings: SETTINGS } });
    await initUepSettings();
    clearUepSettingsCache();
    expect(sessionStorage.getItem('uep-settings-v1')).toBeNull();

    // 只清 sessionStorage 不夠——in-flight Promise 也要丟掉，
    // 否則「立刻重抓」會被去重短路成不抓
    await initUepSettings();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('並行呼叫只 fetch 一次（DesignLayout 與 activityWatch 各叫一次）', async () => {
    const fetchMock = mockFetch({ ok: true, data: { settings: SETTINGS } });

    await Promise.all([
      initUepSettings(),
      initUepSettings(),
      initUepSettings(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getSetting('note.max', 30)).toBe(12);
  });

  it('fetch 失敗後的重複呼叫仍 resolve，不重試也不 reject', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await initUepSettings();
    await expect(initUepSettings()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
