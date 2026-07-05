/**
 * 浮島視窗狀態持久化測試
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  islandStorageKey,
  loadWindowState,
  normalizeWindowState,
  saveWindowState,
} from '../persistence';
import { ISLAND_SCHEMA_VERSION, createInitialWindowState } from '../types';

beforeEach(() => {
  window.localStorage.clear();
});

describe('islandStorageKey', () => {
  it('key 含版本前綴與島 id', () => {
    expect(islandStorageKey('history')).toBe('uep.islands.v1.history');
    expect(islandStorageKey('storage')).toBe('uep.islands.v1.storage');
  });
});

describe('normalizeWindowState', () => {
  it('非物件輸入回傳 null', () => {
    expect(normalizeWindowState(null)).toBeNull();
    expect(normalizeWindowState('str')).toBeNull();
    expect(normalizeWindowState(42)).toBeNull();
  });

  it('完整資料原樣通過', () => {
    const raw = {
      version: 1,
      open: true,
      position: { left: 100, top: 200 },
      updatedAt: '2026-07-05T00:00:00.000Z',
    };
    expect(normalizeWindowState(raw)).toEqual(raw);
  });

  it('欄位缺漏時以初始值補齊（open 預設 false、position 預設 null）', () => {
    const result = normalizeWindowState({});
    expect(result).not.toBeNull();
    expect(result!.version).toBe(ISLAND_SCHEMA_VERSION);
    expect(result!.open).toBe(false);
    expect(result!.position).toBeNull();
    expect(typeof result!.updatedAt).toBe('string');
  });

  it('position 座標非有限數值時退回 null', () => {
    expect(
      normalizeWindowState({ position: { left: NaN, top: 10 } })!.position
    ).toBeNull();
    expect(
      normalizeWindowState({ position: { left: Infinity, top: 10 } })!.position
    ).toBeNull();
    expect(
      normalizeWindowState({ position: { left: '10', top: 10 } })!.position
    ).toBeNull();
  });

  it('open 只認 boolean true', () => {
    expect(normalizeWindowState({ open: 'yes' })!.open).toBe(false);
    expect(normalizeWindowState({ open: 1 })!.open).toBe(false);
    expect(normalizeWindowState({ open: true })!.open).toBe(true);
  });
});

describe('load / save 往返', () => {
  it('save 後 load 還原相同狀態', () => {
    const state = {
      ...createInitialWindowState(),
      position: { left: 50, top: 60 },
    };
    saveWindowState('history', state);
    expect(loadWindowState('history')).toEqual(state);
  });

  it('不存在的 key 回傳 null', () => {
    expect(loadWindowState('echoes')).toBeNull();
  });

  it('毀損 JSON 回傳 null 而不噴錯', () => {
    window.localStorage.setItem(islandStorageKey('visuals'), '{broken!!');
    expect(loadWindowState('visuals')).toBeNull();
  });

  it('各島 key 互相隔離', () => {
    saveWindowState('history', createInitialWindowState());
    expect(loadWindowState('concepts')).toBeNull();
  });
});
