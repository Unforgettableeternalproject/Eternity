/**
 * UEP 進度系統 — 儲存 Adapter
 *
 * S1：LocalStorageAdapter（未登入探索者的預設儲存）
 * S5：ServerAdapter（登入後接管，D1 progress 表；伺服器優先）
 *
 * Adapter 模式讓 UI 與儲存機制解耦——登入系統完成後只需替換 adapter，
 * progressStore 與所有消費端完全不用改。
 */

import { isTestMode } from '../lib/apiBase';

import type {
  ProgressAdapter,
  ProgressState,
  StorageNote,
  StorageNoteLocationSnapshot,
} from './types';
import {
  LOST_BOOKMARK_BASE_PCT,
  LOST_BOOKMARK_MAX_MISS,
  LOST_BOOKMARK_MISS_HARD_MAX,
  LOST_BOOKMARK_STEP_PCT,
  PROGRESS_SCHEMA_VERSION,
  STORAGE_NOTE_LOCATION_LABEL_MAX,
  STORAGE_NOTE_HARD_MAX,
  STORAGE_NOTE_TEXT_HARD_MAX,
  createInitialState,
} from './types';

/**
 * 「遺落的書籤」狀態的讀取防禦與舊格式遷移。
 *
 * S10-3 之前存的是絕對機率 `chancePct`（初始 20，每次沒中 +20）。改存
 * pity 次數之後，舊 blob 要換算回來——否則已經 miss 過幾輪的讀者會被
 * 重置成新讀者。換算基準只能用常數 `LOST_BOOKMARK_BASE_PCT`：那個值就是
 * 舊格式寫入時的起點，與現在的站台設定無關。
 *
 * 認不出來的形狀回 null，由呼叫端補初始值。
 */
function normalizeLostBookmark(
  raw: unknown
): ProgressState['lostBookmark'] | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as { missCount?: unknown; chancePct?: unknown };
  const visible = (obj as { visible?: unknown }).visible === true;

  // 現行格式：夾在硬上限而非 pity 上限——步長可由站台設定調小，用 pity 上限
  // 夾會讓機率永遠到不了 100%
  if (typeof obj.missCount === 'number' && Number.isFinite(obj.missCount)) {
    return {
      missCount: Math.min(
        LOST_BOOKMARK_MISS_HARD_MAX,
        Math.max(0, Math.round(obj.missCount))
      ),
      visible,
    };
  }

  if (typeof obj.chancePct === 'number' && Number.isFinite(obj.chancePct)) {
    const missed = Math.round(
      (obj.chancePct - LOST_BOOKMARK_BASE_PCT) / LOST_BOOKMARK_STEP_PCT
    );
    return {
      missCount: Math.min(LOST_BOOKMARK_MAX_MISS, Math.max(0, missed)),
      visible,
    };
  }

  return null;
}

/**
 * 驗證便條「地點」小標快照（S10-1）。型別不符時回傳 undefined——
 * 只丟棄這個欄位，呼叫端負責保留便條本體，不整條便條作廢。
 */
function normalizeStorageNoteLocation(
  raw: unknown
): StorageNoteLocationSnapshot | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const loc = raw as Partial<StorageNoteLocationSnapshot>;
  if (typeof loc.zone !== 'string' || typeof loc.pageLabel !== 'string') {
    return undefined;
  }
  return {
    zone: loc.zone,
    pageLabel: loc.pageLabel.slice(0, STORAGE_NOTE_LOCATION_LABEL_MAX),
  };
}

/**
 * localStorage key，含 schema 版本以利未來遷移。
 *
 * Test Mode 下加 `:test` 後綴做環境隔離——同 origin 用 test-mode cookie
 * 切換正式／測試 API 時，進度不得跨環境殘留，也不得被 ServerAdapter
 * 「遠端空則上傳本地」的初始合併寫進另一環境的帳號。
 * mode 切換必伴隨 reload，module 載入時計算一次即可。
 */
export const PROGRESS_STORAGE_KEY = isTestMode()
  ? 'uep.progress.v1:test'
  : 'uep.progress.v1';

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
    // S10-4 新增欄位：已看過的浮島教學。空字串一併剔除——它不對應任何島，
    // 留著只會在 IslandHost 取交集時多繞一圈
    islandGuidesSeen: Array.isArray(obj.islandGuidesSeen)
      ? obj.islandGuidesSeen.filter((id) => typeof id === 'string' && id !== '')
      : base.islandGuidesSeen,
    pageMarkers:
      typeof obj.pageMarkers === 'object' && obj.pageMarkers !== null
        ? obj.pageMarkers
        : base.pageMarkers,
    // S10-2 新增欄位：迷霧線位置，舊 blob 沒有時補空表。
    // 逐項防禦（僅接受 0~1 的有限數），壞值直接剔除——迷霧位置錯誤
    // 會讓整篇內容被永久遮蔽或整篇解除保護，寧可退回未讀狀態
    fogRatio:
      typeof obj.fogRatio === 'object' && obj.fogRatio !== null
        ? Object.fromEntries(
            Object.entries(obj.fogRatio as Record<string, unknown>).filter(
              (pair): pair is [string, number] =>
                typeof pair[1] === 'number' &&
                Number.isFinite(pair[1]) &&
                pair[1] >= 0 &&
                pair[1] <= 1
            )
          )
        : base.fogRatio,
    // S6-2 新增欄位：舊 blob 沒有時補 null（deriveLastRead 會 fallback pageMarkers）
    lastVisitedPageId:
      typeof obj.lastVisitedPageId === 'string' ? obj.lastVisitedPageId : null,
    lastVisitedAt:
      typeof obj.lastVisitedAt === 'string' ? obj.lastVisitedAt : null,
    // S6-2 新增欄位：遺落的書籤機率狀態，舊 blob 沒有時回到初始
    // （S10-3 起存 pity 次數，舊的 chancePct 形狀在這裡換算）
    lostBookmark: normalizeLostBookmark(obj.lostBookmark) ?? base.lostBookmark,
    // S6 新增欄位：舊 blob 沒有時補初始值；totalMs 防禦非有限數值
    readingStats:
      typeof obj.readingStats === 'object' &&
      obj.readingStats !== null &&
      typeof obj.readingStats.totalMs === 'number' &&
      Number.isFinite(obj.readingStats.totalMs)
        ? { totalMs: Math.max(0, obj.readingStats.totalMs) }
        : base.readingStats,
    // S7-C 新增欄位：Terminal 已讀水位，舊 blob 沒有時補空表；
    // 值逐項防禦（僅接受非負有限數），壞值直接剔除
    conceptsReadLevel:
      typeof obj.conceptsReadLevel === 'object' &&
      obj.conceptsReadLevel !== null
        ? Object.fromEntries(
            Object.entries(
              obj.conceptsReadLevel as Record<string, unknown>
            ).filter(
              (pair): pair is [string, number] =>
                typeof pair[1] === 'number' &&
                Number.isFinite(pair[1]) &&
                pair[1] >= 0
            )
          )
        : base.conceptsReadLevel,
    // S9 新增欄位：便條島本體，舊 blob 沒有時補空陣列。
    // 逐筆驗證（欄位型別齊全才留），text 截斷、整體 cap 防外部塞超量。
    // S10-1：location/capturedAt 逐欄位容錯——型別不符只丟棄該欄位，
    // 不影響便條本體（同錨點失效退化的容錯哲學）。
    storageNotes: Array.isArray(obj.storageNotes)
      ? obj.storageNotes
          .filter(
            (n): n is StorageNote =>
              typeof n === 'object' &&
              n !== null &&
              typeof (n as StorageNote).id === 'string' &&
              typeof (n as StorageNote).text === 'string' &&
              typeof (n as StorageNote).tilt === 'number' &&
              Number.isFinite((n as StorageNote).tilt) &&
              typeof (n as StorageNote).createdAt === 'string' &&
              typeof (n as StorageNote).updatedAt === 'string'
          )
          // 載入 sanitize 用硬上限不用可調 cap：站台設定調高 note.max 後，
          // settings 未載入的首拍若以常數截斷會直接砍掉使用者的便條
          .slice(0, STORAGE_NOTE_HARD_MAX)
          .map((n) => ({
            ...n,
            text: n.text.slice(0, STORAGE_NOTE_TEXT_HARD_MAX),
            location: normalizeStorageNoteLocation(n.location),
            capturedAt:
              typeof n.capturedAt === 'string' ? n.capturedAt : undefined,
          }))
      : base.storageNotes,
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
