/**
 * UEP 浮島系統 — 視窗狀態持久化
 *
 * 每座浮島一把 key：`uep.islands.v1.{id}`（含 schema 版本以利未來遷移）。
 * 只存視窗狀態（開合/位置），解鎖狀態在 ProgressState（跨裝置同步）。
 * localStorage 失敗一律靜默——浮島是輔助工具，不應阻斷閱讀。
 */

import type { IslandId, IslandWindowState } from './types';
import {
  ISLAND_IDS,
  ISLAND_SCHEMA_VERSION,
  createInitialWindowState,
} from './types';

/** localStorage key 前綴（版本進 key，schema 大改時直接換代） */
export const ISLAND_STORAGE_PREFIX = 'uep.islands.v1.';

/** 取得指定浮島的 localStorage key */
export function islandStorageKey(id: IslandId): string {
  return `${ISLAND_STORAGE_PREFIX}${id}`;
}

/** 驗證並正規化從儲存層讀回的資料，欄位缺漏時以初始值補齊 */
export function normalizeWindowState(raw: unknown): IslandWindowState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Partial<IslandWindowState>;
  const base = createInitialWindowState();
  const isCurrentSchema = obj.version === ISLAND_SCHEMA_VERSION;

  let position: IslandWindowState['position'] = null;
  if (
    isCurrentSchema &&
    typeof obj.position === 'object' &&
    obj.position !== null &&
    typeof obj.position.left === 'number' &&
    typeof obj.position.top === 'number' &&
    Number.isFinite(obj.position.left) &&
    Number.isFinite(obj.position.top)
  ) {
    position = { left: obj.position.left, top: obj.position.top };
  }

  return {
    version: ISLAND_SCHEMA_VERSION,
    open: obj.open === true,
    position,
    updatedAt:
      typeof obj.updatedAt === 'string' ? obj.updatedAt : base.updatedAt,
  };
}

/** 讀取浮島視窗狀態；不存在或毀損時回傳 null */
export function loadWindowState(id: IslandId): IslandWindowState | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(islandStorageKey(id));
    if (!raw) return null;
    return normalizeWindowState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 寫入浮島視窗狀態（靜默失敗） */
export function saveWindowState(id: IslandId, state: IslandWindowState): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(islandStorageKey(id), JSON.stringify(state));
  } catch {
    // localStorage 滿載或被禁用時靜默失敗
  }
}

/** 清除所有浮島視窗狀態（登出/進度重置用——S7 驗收 #9/#13） */
export function clearAllWindowStates(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  for (const id of ISLAND_IDS) {
    try {
      window.localStorage.removeItem(islandStorageKey(id));
    } catch {
      // 靜默失敗
    }
  }
}
