/**
 * 自訂旗標選擇器（共用）
 *
 * 兩處呼叫端：FlagMarker bubble 的授予端、GateConditionEditor 的需求端。
 *
 * 註冊表是**建議清單不是白名單**（艾斯維爾 2026-07-30 定案，D-1 反轉）：
 * 可以從清單選，也可以直接打一個新名字，存檔時由 worker 自動補進註冊表——
 * 與 `entityKey`／`storyKey` 同一個模式（自由填 → 存檔建殼列 → 事後補說明）。
 *
 * 為什麼不再事前強制註冊：typo 已經被 T-A3 的巡查抓得到（打錯的那個標
 * unused、正確的那個標 orphan，一組同時出現幾乎只有 typo 一種成因），而事前
 * 擋會連帶關掉 derived 旗標的需求端——gate 想要求「聽過某首歌」時，那個旗標
 * 依設計不可註冊，於是永遠填不進去。
 *
 * 走同源 SSR proxy（`/api/flags`）：那個端點全段 admin only，而 admin JWT 是
 * httpOnly cookie，瀏覽器端讀不到，必須由 proxy 在 server 端補 Bearer header。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { validateFlagName } from '../../progress/markers';

/** `uep_flags` 的一列（只取 picker 要用的欄位） */
interface FlagOption {
  name: string;
  label: string | null;
  category: string | null;
}

interface FlagPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  /**
   * 已選 chip 是否由本元件呈現。
   * GateConditionEditor 有自己的 chip 區（要一併顯示 page picker 產生的
   * `completed:*`），傳 false 避免同一批旗標出現兩次。
   */
  showSelected?: boolean;
  /**
   * 單選模式：選新的會取代舊的。
   *
   * FlagMarker 是一個標記授予一個旗標（艾斯維爾 2026-07-30 確認語意）。
   * 資料層仍是陣列（`data-grants-flags` 的逗號格式與掃描器／改名／巡查都
   * 假設陣列），這裡只約束 UI，存進去就是長度 1。
   */
  single?: boolean;
  /**
   * 回報選中旗標在註冊表裡的既有標籤（`null` = 尚未註冊或沒有標籤）。
   * 呼叫端要顯示／編輯該旗標的標籤時用——picker 手上已經有整份清單，
   * 由它回報可以省掉呼叫端再查一次。
   */
  onSelectedLabel?: (label: string | null) => void;
  accent?: string;
  placeholder?: string;
}

export default function FlagPicker({
  value,
  onChange,
  showSelected = true,
  single = false,
  onSelectedLabel,
  accent,
  placeholder = '搜尋或輸入新旗標…',
}: FlagPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<FlagOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  /**
   * single 模式的輸入緩衝：名字不合法時輸入框要留著使用者打的字（才看得懂
   * 錯在哪），但那個值不能寫進 value。`null` = 沒有緩衝，顯示 value[0]。
   */
  const [rawInput, setRawInput] = useState<string | null>(null);

  /* 就地新建 */
  /** 使用者是否實際打過字（single 模式的過濾時機，見 filterNeedle） */
  const [typed, setTyped] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch('/api/flags');
      const json = (await res.json()) as {
        ok: boolean;
        data?: { flags: FlagOption[] };
      };
      if (json.ok && json.data) setOptions(json.data.flags);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // 只在展開時載入：註冊表隨時會被 /admin/settings 或另一個 picker 改動，
  // 每次展開重讀比維護一份會過期的快取簡單
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // 點外面收起（bubble menu 疊在內容上，不收起會擋住編輯區）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closePanel();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function closePanel() {
    setOpen(false);
    setTyped(false);
    if (!single) setQuery('');
    // 收起面板等於捨棄沒寫進 value 的壞名字，輸入框跳回實際生效的那個
    setRawInput(null);
    setCreating(false);
    setCreateError(null);
  }

  /**
   * single 模式的輸入框**就是**那個旗標名——打字即時寫回 value，不另外用
   * chip 呈現。只選一個的時候 chip 是多餘的一層（艾斯維爾 2026-07-30）。
   * 多選模式維持原樣：輸入框是搜尋欄，已選的用 chip 列在上面。
   */
  const inputText = single ? (rawInput ?? value[0] ?? '') : query;
  /** 原樣的輸入字串——旗標名大小寫有意義，比對才用小寫 */
  const needleRaw = inputText.trim();
  const needle = needleRaw.toLowerCase();
  /**
   * 名字帶了會破壞序列化的字元就只能在這裡擋——存檔後 worker 拿到的是
   * 已經被逗號拆開的結果，那時 `foo,bar` 與兩個獨立旗標無從分辨。
   */
  const nameError = needleRaw ? validateFlagName(needleRaw) : null;
  /**
   * single 模式下輸入框顯示的是已選旗標，剛聚焦時若拿它過濾，清單就只剩
   * 自己一項，換選反而要先清空欄位。實際打過字才開始過濾。
   */
  const filterNeedle = single && !typed ? '' : needle;
  /**
   * 「直接使用」只在多選模式才需要——single 打字已經即時寫進 value 了。
   * 已經是清單上的項目就該去點它（避免同一件事有兩個入口）。
   */
  const canUseRaw =
    !single &&
    !!needleRaw &&
    !nameError &&
    !value.includes(needleRaw) &&
    !options.some((option) => option.name === needleRaw);
  // single 不排除已選：換選時清單要完整，也才看得出目前選的是哪一個
  const available = single
    ? options
    : options.filter((option) => !value.includes(option.name));
  const matched = filterNeedle
    ? available.filter(
        (option) =>
          option.name.toLowerCase().includes(filterNeedle) ||
          (option.label || '').toLowerCase().includes(filterNeedle)
      )
    : available;

  /** 輸入框變動：single 直接改 value，多選只改搜尋字串 */
  const handleInput = (text: string) => {
    setTyped(true);
    setOpen(true);
    if (!single) {
      setQuery(text);
      return;
    }
    const trimmed = text.trim();
    setRawInput(text);
    // 不合法就只留在輸入框，value 維持上一個有效值——寫進去的話存檔時
    // 會裂成兩個旗標，而且錯誤已經無法回溯
    if (trimmed && validateFlagName(trimmed)) return;
    onChange(trimmed ? [trimmed] : []);
    if (!trimmed) onSelectedLabel?.(null);
  };

  const select = (name: string) => {
    setRawInput(null);
    if (single) onChange([name]);
    else if (!value.includes(name)) onChange([...value, name]);
    onSelectedLabel?.(
      options.find((option) => option.name === name)?.label ?? null
    );
    if (single) {
      // 選定就收起：輸入框已經顯示選中的名字，面板留著只會擋住下面的東西
      setOpen(false);
      setTyped(false);
    } else {
      setQuery('');
    }
    setCreating(false);
    setCreateError(null);
  };

  const remove = (name: string) => {
    const next = value.filter((flag) => flag !== name);
    onChange(next);
    if (next.length === 0) onSelectedLabel?.(null);
  };

  const openCreate = () => {
    setDraftName(query.trim());
    setDraftLabel('');
    setCreateError(null);
    setCreating(true);
  };

  const submitCreate = async () => {
    const name = draftName.trim();
    if (!name) return;
    // worker 端擋同一份規則，這裡先擋是為了省一次往返並就地指出問題
    const invalid = validateFlagName(name);
    if (invalid) {
      setCreateError(invalid);
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, label: draftLabel }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (json.ok) {
        await load();
        select(name);
        return;
      }
      // 409 代表這個名字已經註冊過，只是本地清單還沒重載——直接選它，
      // 逼使用者換名字才是錯的
      if (res.status === 409) {
        await load();
        select(name);
        return;
      }
      setCreateError(json.error || '註冊失敗');
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ned-flagpicker" ref={rootRef}>
      {/* single 模式不畫 chip：輸入框本身就是那個旗標 */}
      {!single && showSelected && value.length > 0 && (
        <div className="ned-flagpicker-chips">
          {value.map((flag) => (
            <span className="ned-gate-flag" key={flag} title={flag}>
              <span className="ned-gate-flag-name">{flag}</span>
              <button
                type="button"
                className="ned-gate-flag-remove"
                aria-label={`移除旗標 ${flag}`}
                onClick={() => remove(flag)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        className="ned-field ned-flagpicker-input"
        type="text"
        value={inputText}
        placeholder={placeholder}
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closePanel();
            return;
          }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          // Enter 選第一個匹配項；沒有匹配就直接採用輸入字串（存檔時由
          // worker 自動註冊）。single 打字已經即時寫進 value，只需收面板
          if (matched.length > 0) select(matched[0].name);
          else if (needleRaw && !single && !nameError) select(needleRaw);
          else if (!nameError) closePanel();
        }}
      />

      {open && (
        <div className="ned-flagpicker-panel">
          {loading ? (
            <div className="ned-flagpicker-empty">loading…</div>
          ) : loadError ? (
            <div className="ned-flagpicker-empty">無法載入旗標註冊表</div>
          ) : (
            <>
              {nameError && (
                <div className="ned-flagpicker-error" role="alert">
                  {nameError}
                </div>
              )}
              {matched.length > 0 && (
                <div className="ned-flagpicker-list">
                  {matched.map((option) => (
                    <button
                      type="button"
                      className="ned-flagpicker-item"
                      key={option.name}
                      onClick={() => select(option.name)}
                    >
                      <span className="ned-flagpicker-item-name">
                        {option.name}
                      </span>
                      {option.label && (
                        <span className="ned-flagpicker-item-label">
                          {option.label}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {matched.length === 0 && (
                <div className="ned-flagpicker-empty">
                  {options.length === 0
                    ? '註冊表還沒有任何自訂旗標'
                    : filterNeedle
                      ? single
                        ? '沒有同名的既有旗標——直接用這個名字'
                        : '沒有符合的旗標'
                      : '已經全部選取'}
                </div>
              )}

              {/* 直接採用輸入字串：註冊表是建議清單不是白名單，存檔時
                  worker 會自動把它補進註冊表 */}
              {canUseRaw && (
                <button
                  type="button"
                  className="ned-flagpicker-use"
                  style={accent ? { color: accent } : undefined}
                  onClick={() => select(needleRaw)}
                >
                  直接使用「{needleRaw}」
                  <span className="ned-flagpicker-use-note">
                    存檔時自動註冊
                  </span>
                </button>
              )}

              {creating ? (
                <div className="ned-flagpicker-create">
                  <input
                    className="ned-field"
                    type="text"
                    value={draftName}
                    placeholder="旗標名稱"
                    spellCheck={false}
                    aria-label="新旗標名稱"
                    onChange={(e) => setDraftName(e.target.value)}
                  />
                  <input
                    className="ned-field"
                    type="text"
                    value={draftLabel}
                    placeholder="標籤（給人看的短名稱，可留空）"
                    aria-label="新旗標標籤"
                    onChange={(e) => setDraftLabel(e.target.value)}
                  />
                  {createError && (
                    <div className="ned-flagpicker-error">{createError}</div>
                  )}
                  <div className="ned-flagpicker-create-actions">
                    <button
                      type="button"
                      className="ned-flagpicker-confirm"
                      style={accent ? { color: accent } : undefined}
                      disabled={!draftName.trim() || submitting}
                      onClick={submitCreate}
                    >
                      {submitting ? '註冊中…' : '註冊並選取'}
                    </button>
                    <button
                      type="button"
                      className="ned-flagpicker-cancel"
                      onClick={() => {
                        setCreating(false);
                        setCreateError(null);
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                // single 模式不需要這條路：呼叫端（marker bubble）自己就有
                // 標籤欄，而旗標名直接打在輸入框裡
                !single && (
                  <button
                    type="button"
                    className="ned-flagpicker-new"
                    style={accent ? { color: accent } : undefined}
                    onClick={openCreate}
                  >
                    ＋ 新建並填標籤{needleRaw ? `「${needleRaw}」` : ''}
                  </button>
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
