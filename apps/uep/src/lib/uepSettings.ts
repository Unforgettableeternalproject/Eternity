/**
 * 站台行為設定的前台讀取（S10-3b T-B4）
 *
 * `/admin/settings` 站台分頁調整的四項參數（uep_settings 表）在前台的
 * 消費入口。DesignLayout 掛載時呼叫 `initUepSettings()`：
 *
 *   sessionStorage 有快取 → 同步寫入 window.__uepSettings（同一 session
 *   不重取，之後每頁都是零延遲）；沒有 → 匿名 fetch /api/settings/public
 *   一次並落快取。
 *
 * 消費點一律走 `getSetting(key, fallback)`：settings 未載入（首訪第一頁、
 * fetch 失敗、worker 掛掉）都退回程式碼常數——uep 是 MPA，每頁重新
 * mount，沒有 fallback 的話相關功能會用 undefined 算數。也因此設定值的
 * 生效時機是「下一次頁面載入」，不保證首訪第一頁。
 *
 * ⚠️ 只放「一次性讀取」的參數。需要在 scroll／IO 回呼裡讀的參數不該進
 * uep_settings（D-2 定案），維持編譯期常數。
 */

import { getApiBase } from './apiBase';

type SettingsMap = Record<string, string | number>;

declare global {
  interface Window {
    __uepSettings?: SettingsMap;
  }
}

const STORAGE_KEY = 'uep-settings-v1';

/**
 * 讀一項設定，型別不符（含未載入）即退回 fallback。
 * 以 fallback 的型別當契約——worker 端驗證過型別，這裡再擋一次是防
 * sessionStorage 被手動改壞。
 */
export function getSetting<T extends string | number>(
  key: string,
  fallback: T
): T {
  if (typeof window === 'undefined') return fallback;
  const value = window.__uepSettings?.[key];
  return typeof value === typeof fallback ? (value as T) : fallback;
}

/** 快取寫入失敗（隱私模式等）不致命——下一頁會再 fetch 一次 */
function readCache(): SettingsMap | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as SettingsMap;
  } catch {
    return null;
  }
}

function writeCache(settings: SettingsMap): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 寫不進就每頁重抓，行為仍正確
  }
}

/**
 * 供 admin／DevTools 在調整設定後讓當前 session 立刻重抓
 * （否則要關閉分頁才會過期）。
 */
export function clearUepSettingsCache(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 清不掉就等 session 結束
  }
}

export async function initUepSettings(): Promise<void> {
  if (typeof window === 'undefined') return;

  const cached = readCache();
  if (cached) {
    window.__uepSettings = cached;
    return;
  }

  try {
    const res = await fetch(`${getApiBase()}/api/settings/public`);
    const json = (await res.json()) as {
      ok?: boolean;
      data?: { settings?: SettingsMap };
    };
    if (json?.ok && json.data?.settings) {
      window.__uepSettings = json.data.settings;
      writeCache(json.data.settings);
    }
  } catch {
    // fetch 失敗 → 消費點全數退回常數，這一頁維持預設行為
  }
}
