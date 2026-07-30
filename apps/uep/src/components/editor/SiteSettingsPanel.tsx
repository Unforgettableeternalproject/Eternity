/**
 * 站台行為設定（/admin/settings 的「站台」分頁）
 *
 * 四項「一次性讀取」參數的表單（D-2／D-4 定案）：內容保護模式、遺落書籤
 * 基礎機率、便條數量上限、便條字數上限。每 tick 讀取的參數（迷霧、掃描線、
 * rush 門檻）刻意不在這裡——它們維持編譯期常數，不進 uep_settings。
 *
 * 走同源 SSR proxy（/api/settings），儲存採批次 PUT 只帶改過的鍵；
 * worker 端整批驗證，不會寫入一半。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

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

  const hasInvalidNumber = useMemo(
    () =>
      ['bookmark.baseChancePct', 'note.max', 'note.textMax'].some((key) =>
        Number.isNaN(draft[key])
      ),
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

        <section className="ssp-section">
          <div className="ssp-section-title">遺落的書籤</div>
          {numberField(
            'bookmark.baseChancePct',
            '基礎出現機率（%）',
            '讀完一篇文章時 roll 書籤的基礎機率，0–100',
            { min: 0, max: 100 }
          )}
        </section>

        <section className="ssp-section">
          <div className="ssp-section-title">便條</div>
          {numberField('note.max', '數量上限', '便條島最多可釘的便條數', {
            min: 1,
          })}
          {numberField(
            'note.textMax',
            '單張字數上限',
            '超過的輸入會被擋下，不影響既有便條',
            { min: 1 }
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
