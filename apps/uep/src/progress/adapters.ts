/**
 * UEP 進度系統 — 儲存 Adapter
 *
 * S1：LocalStorageAdapter（未登入探索者的預設儲存）
 * S5：ServerAdapter（登入後接管，D1 progress 表；伺服器優先）
 *
 * Adapter 模式讓 UI 與儲存機制解耦——登入系統完成後只需替換 adapter，
 * progressStore 與所有消費端完全不用改。
 */

import type { ProgressAdapter, ProgressState } from './types';
import { PROGRESS_SCHEMA_VERSION, createInitialState } from './types';

/** localStorage key，含 schema 版本以利未來遷移 */
export const PROGRESS_STORAGE_KEY = 'uep.progress.v1';

/** 驗證並正規化從儲存層讀回的資料，欄位缺漏時以初始值補齊 */
export function normalizeState(raw: unknown): ProgressState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Partial<ProgressState>;
  const base = createInitialState();
  const view = obj.view === 'observer' ? 'observer' : 'explorer';
  return {
    version:
      typeof obj.version === 'number' ? obj.version : PROGRESS_SCHEMA_VERSION,
    view,
    // 不變量：處於觀測者視角必然有印記（防止外部資料破壞不變量）
    observerEver: obj.observerEver === true || view === 'observer',
    flags: Array.isArray(obj.flags)
      ? obj.flags.filter((f) => typeof f === 'string')
      : base.flags,
    completedPageIds: Array.isArray(obj.completedPageIds)
      ? obj.completedPageIds.filter((id) => typeof id === 'string')
      : base.completedPageIds,
    islandsUnlocked: Array.isArray(obj.islandsUnlocked)
      ? obj.islandsUnlocked.filter((id) => typeof id === 'string')
      : base.islandsUnlocked,
    // S6 新增欄位：舊 blob 沒有此欄位時補空陣列
    islandsDisabled: Array.isArray(obj.islandsDisabled)
      ? obj.islandsDisabled.filter((id) => typeof id === 'string')
      : base.islandsDisabled,
    pageMarkers:
      typeof obj.pageMarkers === 'object' && obj.pageMarkers !== null
        ? obj.pageMarkers
        : base.pageMarkers,
    // S6 新增欄位：舊 blob 沒有時補初始值；totalMs 防禦非有限數值
    readingStats:
      typeof obj.readingStats === 'object' &&
      obj.readingStats !== null &&
      typeof obj.readingStats.totalMs === 'number' &&
      Number.isFinite(obj.readingStats.totalMs)
        ? { totalMs: Math.max(0, obj.readingStats.totalMs) }
        : base.readingStats,
    updatedAt:
      typeof obj.updatedAt === 'string' ? obj.updatedAt : base.updatedAt,
  };
}

/** 未登入探索者的預設儲存：localStorage */
export class LocalStorageAdapter implements ProgressAdapter {
  /** 同步讀取（store 初始化時避免 first paint 閃爍） */
  loadSync(): ProgressState | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
      if (!raw) return null;
      return normalizeState(JSON.parse(raw));
    } catch {
      // 資料毀損時放棄舊資料，回到初始狀態
      return null;
    }
  }

  load(): Promise<ProgressState | null> {
    return Promise.resolve(this.loadSync());
  }

  save(state: ProgressState): Promise<void> {
    if (typeof window === 'undefined' || !window.localStorage)
      return Promise.resolve();
    try {
      window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage 滿載或被禁用時靜默失敗——進度系統不應阻斷閱讀
    }
    return Promise.resolve();
  }
}
