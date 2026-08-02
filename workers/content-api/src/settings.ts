/**
 * 站台行為設定（uep_settings，S10-3b T-B3）
 *
 * key-value 表只收「一次性讀取」參數（D-2／D-4 定案）；每 tick 讀取的
 * 參數（迷霧推進速率、掃描線視窗比例、rush 門檻）維持前端編譯期常數，
 * 不進這張表。
 *
 * 收錄的判準是**讀取時機**不是重要性：擲一次骰／點一次才讀 = 可進；
 * 在 scroll／IntersectionObserver 回呼裡每幀讀 = 不可進。
 *
 * 預設值的權威來源是 apps/uep 的程式碼常數（progress/types.ts 的
 * STORAGE_NOTE_MAX 等）——worker 無法跨 package import，這裡的複本只供
 * 「表為空時 GET 仍回完整清單」使用。改前端常數時要同步這份，否則 admin
 * 顯示的預設值會過期（前台行為不受影響——getSetting 的 fallback 用的是
 * 前端本地常數）。
 *
 * ⚠️ 機率一律以**整數百分比**存放，即使前端常數是 0–1 的小數
 * （`LOST_ORB_CHANCE = 0.06` → `6`）。混用兩種尺度時，「這個 6 是 6% 還是
 * 600%」只能靠讀程式碼判斷，而寫錯的症狀是靜默的行為異常。換算在消費端做。
 */

export type SettingKey =
  | 'protection.mode'
  | 'bookmark.baseChancePct'
  | 'bookmark.stepChancePct'
  | 'echoes.lostOrbChancePct'
  | 'visuals.phantomEnterChancePct'
  | 'visuals.phantomSwitchChancePct'
  | 'storage.loneNoteDustSteps'
  | 'note.max'
  | 'note.textMax'
  | 'reader.activityIdleThresholdSec'
  | 'reader.idleNudgeMode'
  | 'reader.restActiveMinutes'
  | 'reader.restPageCount'
  | 'reader.restWindowMinutes'
  | 'reader.restCooldownMinutes';

export type SettingValue = string | number;

/** 預設值（權威來源見檔頭；protection.mode 的 'env' = 現行環境判斷邏輯） */
export const SETTING_DEFAULTS: Record<SettingKey, SettingValue> = {
  'protection.mode': 'env',
  'bookmark.baseChancePct': 20,
  'bookmark.stepChancePct': 20,
  'echoes.lostOrbChancePct': 6,
  'visuals.phantomEnterChancePct': 8,
  'visuals.phantomSwitchChancePct': 18,
  'storage.loneNoteDustSteps': 10,
  'note.max': 30,
  'note.textMax': 200,
  'reader.activityIdleThresholdSec': 180,
  'reader.idleNudgeMode': 'enabled',
  'reader.restActiveMinutes': 45,
  'reader.restPageCount': 5,
  'reader.restWindowMinutes': 30,
  'reader.restCooldownMinutes': 60,
};

export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

const PROTECTION_MODES = ['always', 'never', 'env'];

const IDLE_NUDGE_MODES = ['enabled', 'disabled'];

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
    // 五項機率共用 0–100 的**整數**檢查。0 = 永遠不出現（可用來整個關掉
    // 某座島的儀式），100 = 必中，兩端都是合法的營運選擇所以不另外收窄。
    //
    // ⚠️ 必須是整數：這幾個鍵的契約是「整數百分比」（前端常數是 0–1 的小數，
    // 6.5 這種值會被讀成 6.5% 但 UI 與說明都以整數呈現）。只擋 finite 的話
    // 小數寫得進去，而症狀是機率跟填的數字對不上，沒有錯誤訊息。
    case 'bookmark.baseChancePct':
    case 'bookmark.stepChancePct':
    case 'echoes.lostOrbChancePct':
    case 'visuals.phantomEnterChancePct':
    case 'visuals.phantomSwitchChancePct':
      if (
        !Number.isInteger(value) ||
        (value as number) < 0 ||
        (value as number) > 100
      ) {
        return { ok: false, error: `${key} 必須是 0–100 的整數` };
      }
      return { ok: true, value: value as number };
    // 抖幾下才解鎖便條島。下限 1（點一下就開）而非 0——0 等於一進 boxes 頁
    // 就自動解鎖，那不是儀式而是 bug 的長相
    case 'storage.loneNoteDustSteps':
      if (
        !Number.isInteger(value) ||
        (value as number) < 1 ||
        (value as number) > 50
      ) {
        return {
          ok: false,
          error: 'storage.loneNoteDustSteps 必須是 1–50 的整數',
        };
      }
      return { ok: true, value: value as number };
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
    // 無動作幾秒後封存活躍區間。這條是**活動量測本身**的閾值——閱讀時數統計
    // 與休息提醒都以它為事實來源，所以沒有「停用」值。要關掉 AFK 提示請改
    // reader.idleNudgeMode，那隻控制 UI 不影響量測；用閾值去關會讓統計一併
    // 失去排除掛機的依據
    case 'reader.activityIdleThresholdSec':
      if (
        !Number.isInteger(value) ||
        (value as number) < 30 ||
        (value as number) > 3600
      ) {
        return {
          ok: false,
          error: 'reader.activityIdleThresholdSec 必須是 30–3600 的整數',
        };
      }
      return { ok: true, value: value as number };
    case 'reader.idleNudgeMode':
      if (typeof value !== 'string' || !IDLE_NUDGE_MODES.includes(value)) {
        return {
          ok: false,
          error: `reader.idleNudgeMode 必須是 ${IDLE_NUDGE_MODES.join(' / ')}`,
        };
      }
      return { ok: true, value };
    // 休息提醒的兩條觸發線，各自 0 = 停用該條。兩條都設 0 等於整個關掉休息
    // 提醒——不另開布林開關（同機率鍵的 0 = 永不出現慣例）
    case 'reader.restActiveMinutes':
      if (
        !Number.isInteger(value) ||
        (value as number) < 0 ||
        (value as number) > 480
      ) {
        return {
          ok: false,
          error: 'reader.restActiveMinutes 必須是 0–480 的整數（0 = 停用）',
        };
      }
      return { ok: true, value: value as number };
    case 'reader.restPageCount':
      if (
        !Number.isInteger(value) ||
        (value as number) < 0 ||
        (value as number) > 100
      ) {
        return {
          ok: false,
          error: 'reader.restPageCount 必須是 0–100 的整數（0 = 停用）',
        };
      }
      return { ok: true, value: value as number };
    // 視窗與冷卻是「這條線怎麼算」的參數，不是開關，所以下限 1 不收 0
    case 'reader.restWindowMinutes':
      if (
        !Number.isInteger(value) ||
        (value as number) < 1 ||
        (value as number) > 240
      ) {
        return {
          ok: false,
          error: 'reader.restWindowMinutes 必須是 1–240 的整數',
        };
      }
      return { ok: true, value: value as number };
    case 'reader.restCooldownMinutes':
      if (
        !Number.isInteger(value) ||
        (value as number) < 1 ||
        (value as number) > 1440
      ) {
        return {
          ok: false,
          error: 'reader.restCooldownMinutes 必須是 1–1440 的整數',
        };
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
