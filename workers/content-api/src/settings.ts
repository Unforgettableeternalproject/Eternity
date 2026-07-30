/**
 * 站台行為設定（uep_settings，S10-3b T-B3）
 *
 * key-value 表只收四項「一次性讀取」參數（D-2／D-4 定案）；每 tick 讀取的
 * 參數維持前端編譯期常數，不進這張表。
 *
 * 預設值的權威來源是 apps/uep 的程式碼常數（progress/types.ts 的
 * STORAGE_NOTE_MAX 等）——worker 無法跨 package import，這裡的複本只供
 * 「表為空時 GET 仍回完整四項」使用。改前端常數時要同步這份，否則 admin
 * 顯示的預設值會過期（前台行為不受影響——getSetting 的 fallback 用的是
 * 前端本地常數）。
 */

export type SettingKey =
  | 'protection.mode'
  | 'bookmark.baseChancePct'
  | 'note.max'
  | 'note.textMax';

export type SettingValue = string | number;

/** 預設值（權威來源見檔頭；protection.mode 的 'env' = 現行環境判斷邏輯） */
export const SETTING_DEFAULTS: Record<SettingKey, SettingValue> = {
  'protection.mode': 'env',
  'bookmark.baseChancePct': 20,
  'note.max': 30,
  'note.textMax': 200,
};

export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

const PROTECTION_MODES = ['always', 'never', 'env'];

export interface SettingsMap {
  [key: string]: SettingValue;
}

/**
 * 逐鍵驗證。設定值會直接進前台行為（便條上限、書籤機率），壞值的症狀是
 * 靜默的怪行為而不是報錯，寧可在寫入時擋下。
 */
export function validateSetting(
  key: string,
  value: unknown
): { ok: true; value: SettingValue } | { ok: false; error: string } {
  switch (key as SettingKey) {
    case 'protection.mode':
      if (typeof value !== 'string' || !PROTECTION_MODES.includes(value)) {
        return {
          ok: false,
          error: `protection.mode 必須是 ${PROTECTION_MODES.join(' / ')}`,
        };
      }
      return { ok: true, value };
    case 'bookmark.baseChancePct':
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100
      ) {
        return { ok: false, error: 'bookmark.baseChancePct 必須是 0–100' };
      }
      return { ok: true, value };
    // 上限對齊 apps/uep progress/types.ts 的 STORAGE_NOTE_HARD_MAX／
    // STORAGE_NOTE_TEXT_HARD_MAX——前台載入 sanitize 以硬上限截斷，
    // 這裡放行更大的值等於讓便條在下次載入時被砍掉
    case 'note.max':
      if (
        !Number.isInteger(value) ||
        (value as number) < 1 ||
        (value as number) > 60
      ) {
        return { ok: false, error: 'note.max 必須是 1–60 的整數' };
      }
      return { ok: true, value: value as number };
    case 'note.textMax':
      if (
        !Number.isInteger(value) ||
        (value as number) < 1 ||
        (value as number) > 400
      ) {
        return { ok: false, error: 'note.textMax 必須是 1–400 的整數' };
      }
      return { ok: true, value: value as number };
    default:
      return { ok: false, error: `未知的設定鍵：${key}` };
  }
}

/** 讀全部設定：表裡有的蓋掉預設值，缺列與壞值退回預設 */
export async function listSettings(db: D1Database): Promise<SettingsMap> {
  const { results } = await db
    .prepare('SELECT key, value FROM uep_settings')
    .all<{ key: string; value: string }>();

  const settings: SettingsMap = { ...SETTING_DEFAULTS };
  for (const row of results || []) {
    if (!(row.key in SETTING_DEFAULTS)) continue;
    try {
      const parsed = JSON.parse(row.value) as unknown;
      const check = validateSetting(row.key, parsed);
      if (check.ok) settings[row.key] = check.value;
    } catch {
      // 壞 JSON 靜默退回預設——設定表可被 sync/手動 SQL 動到，
      // 一列壞值不該讓整個端點 500
    }
  }
  return settings;
}

/**
 * 批次局部更新：只動帶到的鍵，其餘不變。全部鍵先驗證再寫入——
 * 部分成功會讓 admin 表單「存了但只存了一半」，寧可整批拒絕。
 */
export async function updateSettings(
  db: D1Database,
  patch: Record<string, unknown>
): Promise<{ ok: true; settings: SettingsMap } | { ok: false; error: string }> {
  const entries = Object.entries(patch);
  if (entries.length === 0) {
    return { ok: false, error: '沒有要更新的設定' };
  }

  const validated: Array<[string, SettingValue]> = [];
  for (const [key, value] of entries) {
    const check = validateSetting(key, value);
    if (!check.ok) return { ok: false, error: check.error };
    validated.push([key, check.value]);
  }

  const now = new Date().toISOString();
  await db.batch(
    validated.map(([key, value]) =>
      db
        .prepare(
          `INSERT INTO uep_settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        )
        .bind(key, JSON.stringify(value), now)
    )
  );

  return { ok: true, settings: await listSettings(db) };
}
