/**
 * 自訂旗標選擇器（共用）
 *
 * 兩處呼叫端：FlagMarker bubble 的授予端、GateConditionEditor 的需求端。
 *
 * ⚠️ **刻意不留自由輸入逃生口**（D-1 強制註冊）。只能選已註冊的旗標，或就地
 * 新建一個（先 `POST /api/flags` 註冊，再選取）。授予端打錯一個字，需求端就
 * 永遠等不到，而且沒有任何錯誤訊息——只會靜默地永遠鎖著，這是強制註冊要防的
 * 唯一一件事。
 *
 * 走同源 SSR proxy（`/api/flags`）：那個端點全段 admin only，而 admin JWT 是
 * httpOnly cookie，瀏覽器端讀不到，必須由 proxy 在 server 端補 Bearer header。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

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
  accent?: string;
  placeholder?: string;
}

export default function FlagPicker({
  value,
  onChange,
  showSelected = true,
  accent,
  placeholder = '搜尋已註冊的旗標…',
}: FlagPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<FlagOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  /* 就地新建 */
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

  // 只在展開時載入：註冊表隨時會被 /admin/keys 或另一個 picker 改動，
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
    setQuery('');
    setCreating(false);
    setCreateError(null);
  }

  const needle = query.trim().toLowerCase();
  const available = options.filter((option) => !value.includes(option.name));
  const matched = needle
    ? available.filter(
        (option) =>
          option.name.toLowerCase().includes(needle) ||
          (option.label || '').toLowerCase().includes(needle)
      )
    : available;

  const select = (name: string) => {
    if (!value.includes(name)) onChange([...value, name]);
    setQuery('');
    setCreating(false);
    setCreateError(null);
  };

  const remove = (name: string) => {
    onChange(value.filter((flag) => flag !== name));
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
      {showSelected && value.length > 0 && (
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
        value={query}
        placeholder={placeholder}
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closePanel();
            return;
          }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          // Enter 選第一個匹配項；沒有匹配就開新建表單並預填。
          // 絕不直接把輸入字串當旗標加進去——那就是逃生口
          if (matched.length > 0) select(matched[0].name);
          else if (query.trim()) openCreate();
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
                    : needle
                      ? '沒有符合的旗標'
                      : '已經全部選取'}
                </div>
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
                <button
                  type="button"
                  className="ned-flagpicker-new"
                  style={accent ? { color: accent } : undefined}
                  onClick={openCreate}
                >
                  ＋ 新建旗標{query.trim() ? `「${query.trim()}」` : ''}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
