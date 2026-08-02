/**
 * 站台行為設定（/admin/settings 的「站台」分頁）
 *
 * 「一次性讀取」參數的表單（D-2／D-4 定案）：內容保護模式、四座島的解鎖
 * 儀式參數、便條上限、閱讀節奏。每 tick 讀取的參數（迷霧推進速率、掃描線
 * 視窗比例、rush 門檻）刻意不在這裡——它們維持編譯期常數，不進 uep_settings。
 *
 * 機率一律以整數百分比呈現與存放，即使前端常數是 0–1 的小數；換算在各自的
 * 消費端做（見 `phantomEnterChance()` 等）。
 *
 * 走同源 SSR proxy（/api/settings），儲存採批次 PUT 只帶改過的鍵；
 * worker 端整批驗證，不會寫入一半。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { clearUepSettingsCache } from '../../lib/uepSettings';

import { apiFetch, getToast } from './editorHelpers';
import './SiteSettingsPanel.css';

type SettingsMap = Record<string, string | number>;

const PROTECTION_OPTIONS = [
  {
    value: 'env',
    label: '跟隨環境',
    hint: '正式站恆開；dev／test 模式需在 DevTools 手動開啟（現行行為）',
  },
  {
    value: 'always',
    label: '恆開',
    hint: '所有環境一律啟用內容保護',
  },
  {
    value: 'never',
    label: '恆關',
    hint: '所有環境一律停用——只用於除錯，正式站請勿長期停留在這裡',
  },
] as const;

const IDLE_NUDGE_OPTIONS = [
  {
    value: 'enabled',
    label: '顯示',
    hint: '閒置超過閾值時，Reader 中央淡入一張低調提示卡，任何動作即消失',
  },
  {
    value: 'disabled',
    label: '不顯示',
    hint: '只關掉提示卡。閒置量測照常運作——閱讀時數與休息提醒仍會扣除掛機時間',
  },
] as const;

/**
 * 所有數字欄位——清空時暫存 NaN，儲存前要一起擋。
 * 漏列的鍵會讓空欄位以 NaN 送出，worker 端擋下但錯誤訊息指向那個鍵而不是
 * 「你有欄位沒填」，所以新增欄位時務必同步這份。
 *
 * ⚠️ 只列數字鍵。`reader.idleNudgeMode` 是字串 enum，列進來會讓
 * `Number.isInteger` 檢查對它恆為 false 之外還誤導後續維護者。
 */
const NUMERIC_KEYS = [
  'bookmark.baseChancePct',
  'bookmark.stepChancePct',
  'echoes.lostOrbChancePct',
  'visuals.phantomEnterChancePct',
  'visuals.phantomSwitchChancePct',
  'storage.loneNoteDustSteps',
  'note.max',
  'note.textMax',
  'reader.activityIdleThresholdSec',
  'reader.restActiveMinutes',
  'reader.restPageCount',
  'reader.restWindowMinutes',
  'reader.restCooldownMinutes',
];

export default function SiteSettingsPanel() {
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [draft, setDraft] = useState<SettingsMap>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ settings: SettingsMap }>('/api/settings');
    if (res.ok && res.data?.settings) {
      setSettings(res.data.settings);
      setDraft(res.data.settings);
    } else {
      getToast().error(`載入設定失敗：${res.error || '未知錯誤'}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 只有改過的鍵要送——PUT 是局部更新，送整份會把沒動的鍵也蓋一次時間戳 */
  const dirtyKeys = useMemo(() => {
    if (!settings) return [];
    return Object.keys(draft).filter((key) => draft[key] !== settings[key]);
  }, [draft, settings]);

  const setNumber = (key: string, raw: string) => {
    // 空字串暫存為 NaN，儲存前擋下——直接還原成舊值會讓輸入框沒辦法清空重打
    const value = raw === '' ? Number.NaN : Number(raw);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  /**
   * 空欄位（NaN）與小數都擋在儲存前。
   *
   * 小數在瀏覽器端只有 `step=1` 的軟性提示，貼上或用鍵盤仍打得進去；
   * worker 會整批拒絕，但那時錯誤訊息指向某個鍵，不如在按鈕上就停住。
   */
  const hasInvalidNumber = useMemo(
    () =>
      NUMERIC_KEYS.some((key) => {
        const value = draft[key];
        return typeof value === 'number' && !Number.isInteger(value);
      }),
    [draft]
  );

  const save = async () => {
    if (dirtyKeys.length === 0 || hasInvalidNumber) return;
    setSaving(true);
    const patch: Record<string, unknown> = {};
    for (const key of dirtyKeys) patch[key] = draft[key];
    const res = await apiFetch<{ settings: SettingsMap }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    setSaving(false);
    if (res.ok && res.data?.settings) {
      setSettings(res.data.settings);
      setDraft(res.data.settings);
      // 前台讀的是 sessionStorage 快取（`uep-settings-v1`），不清的話同一
      // session 後續導航仍吃舊值，「下一次頁面載入生效」的契約要等關掉分頁
      // 才成立。admin 與前台同源，這裡清掉即可
      clearUepSettingsCache();
      getToast().success('設定已儲存');
    } else {
      getToast().error(`儲存失敗：${res.error || '未知錯誤'}`);
    }
  };

  if (settings === null) {
    return <div className="ssp-empty">載入中…</div>;
  }

  const numberField = (
    key: string,
    label: string,
    hint: string,
    opts?: { min?: number; max?: number }
  ) => (
    <div className="ssp-field">
      <label className="ssp-label" htmlFor={`ssp-${key}`}>
        {label}
      </label>
      <input
        id={`ssp-${key}`}
        type="number"
        className="ssp-number"
        value={Number.isNaN(draft[key]) ? '' : String(draft[key] ?? '')}
        min={opts?.min}
        max={opts?.max}
        // 現有的設定值全部是整數（機率是整數百分比、上限與次數是計數），
        // 沒有小數欄位；worker 端也一律 Number.isInteger
        step={1}
        onChange={(e) => setNumber(key, e.target.value)}
      />
      <div className="ssp-hint">{hint}</div>
    </div>
  );

  return (
    <div className="ssp">
      <div className="ssp-body">
        <section className="ssp-section">
          <div className="ssp-section-title">內容保護</div>
          <div
            className="ssp-radio-group"
            role="radiogroup"
            aria-label="內容保護模式"
          >
            {PROTECTION_OPTIONS.map((opt) => (
              <label key={opt.value} className="ssp-radio">
                <input
                  type="radio"
                  name="protection-mode"
                  value={opt.value}
                  checked={draft['protection.mode'] === opt.value}
                  onChange={() =>
                    setDraft((d) => ({ ...d, 'protection.mode': opt.value }))
                  }
                />
                <span className="ssp-radio-label">{opt.label}</span>
                <span className="ssp-hint">{opt.hint}</span>
              </label>
            ))}
          </div>
        </section>

        {/* 四座島的解鎖儀式。Concepts 的「斷線的終端」是純條件式，沒有
            可調參數，所以只有四段。 */}
        <section className="ssp-section">
          <div className="ssp-section-title">遺落的書籤（History 島）</div>
          {numberField(
            'bookmark.baseChancePct',
            '基礎出現機率（%）',
            '讀完一篇文章時 roll 書籤的基礎機率，0–100',
            { min: 0, max: 100 }
          )}
          {numberField(
            'bookmark.stepChancePct',
            '每次沒中的加碼（%）',
            '沒中一次就往上加這麼多，累到 100% 必中。設 0 = 關掉保底，機率恆為基礎值',
            { min: 0, max: 100 }
          )}
        </section>

        <section className="ssp-section">
          <div className="ssp-section-title">迷失的回聲（Echoes 島）</div>
          {numberField(
            'echoes.lostOrbChancePct',
            '灰球出現機率（%）',
            '播放中每次生成球體擲一次骰（約 2~4.5 秒一次），無保底。預設 6 約等於播放 50 秒浮現一顆',
            { min: 0, max: 100 }
          )}
        </section>

        <section className="ssp-section">
          <div className="ssp-section-title">浮動幻影（Visuals 島）</div>
          {numberField(
            'visuals.phantomEnterChancePct',
            '進入區塊時的機率（%）',
            '剛進來或換到別的 subcat 時擲一次，0–100',
            { min: 0, max: 100 }
          )}
          {numberField(
            'visuals.phantomSwitchChancePct',
            '切換分類標籤時的機率（%）',
            '在同一區塊內換標籤時擲一次。刻意比進入時高——那是使用者主動翻找的時機',
            { min: 0, max: 100 }
          )}
        </section>

        <section className="ssp-section">
          <div className="ssp-section-title">孤零零的紙條（Storage 島）</div>
          {numberField(
            'storage.loneNoteDustSteps',
            '要拍幾下才乾淨',
            '非機率制。進度不落地，離開 boxes 頁就從頭來，1–50',
            { min: 1, max: 50 }
          )}
        </section>

        <section className="ssp-section">
          <div className="ssp-section-title">便條</div>
          {numberField(
            'note.max',
            '數量上限',
            '便條島最多可釘的便條數，1–60（上限對齊進度 blob 的載入防禦）',
            { min: 1, max: 60 }
          )}
          {numberField(
            'note.textMax',
            '單張字數上限',
            '超過的輸入會被擋下，不影響既有便條，1–400',
            { min: 1, max: 400 }
          )}
        </section>

        <section className="ssp-section">
          <div className="ssp-section-title">閱讀節奏</div>
          {numberField(
            'reader.activityIdleThresholdSec',
            '判定閒置的秒數',
            '無任何動作超過這個秒數即視為離開。閱讀時數統計與休息提醒都以此為準，沒有停用值，30–3600',
            { min: 30, max: 3600 }
          )}
          <div
            className="ssp-radio-group"
            role="radiogroup"
            aria-label="閒置提示"
          >
            {IDLE_NUDGE_OPTIONS.map((opt) => (
              <label key={opt.value} className="ssp-radio">
                <input
                  type="radio"
                  name="idle-nudge-mode"
                  value={opt.value}
                  checked={draft['reader.idleNudgeMode'] === opt.value}
                  onChange={() =>
                    setDraft((d) => ({
                      ...d,
                      'reader.idleNudgeMode': opt.value,
                    }))
                  }
                />
                <span className="ssp-radio-label">閒置提示：{opt.label}</span>
                <span className="ssp-hint">{opt.hint}</span>
              </label>
            ))}
          </div>
        </section>

        {/* 休息提醒只在 History 生效——「獲得很多進度」只有 History 有具體
            定義（完成頁數、掃描線、迷霧線），其餘四區的停留形態套不上。 */}
        <section className="ssp-section">
          <div className="ssp-section-title">休息提醒（僅 History）</div>
          {numberField(
            'reader.restActiveMinutes',
            '累積活躍幾分鐘後提醒',
            '不是牆鐘時間——閒置的時間不算。按下「知道了」後重新累積。0 = 停用這條線，0–480',
            { min: 0, max: 480 }
          )}
          {numberField(
            'reader.restPageCount',
            '視窗內完成幾頁後提醒',
            '兩條線先到先觸發：只看時長會漏掉快速掃完多篇短文的人。0 = 停用這條線，0–100',
            { min: 0, max: 100 }
          )}
          {numberField(
            'reader.restWindowMinutes',
            '頁數判準的視窗長度（分鐘）',
            '滾動視窗，更早的完成紀錄會被剔除，1–240',
            { min: 1, max: 240 }
          )}
          {numberField(
            'reader.restCooldownMinutes',
            '確認後的冷卻（分鐘）',
            '從按下「知道了」起算，不是從卡片出現起算，1–1440',
            { min: 1, max: 1440 }
          )}
        </section>
      </div>

      <div className="ssp-footer">
        <span className="ssp-footer-note">
          {dirtyKeys.length > 0
            ? `${dirtyKeys.length} 項未儲存`
            : '所有變更已儲存'}
        </span>
        <button
          type="button"
          className="ssp-save"
          disabled={dirtyKeys.length === 0 || hasInvalidNumber || saving}
          onClick={() => void save()}
        >
          {saving ? '儲存中…' : '儲存'}
        </button>
      </div>
    </div>
  );
}
