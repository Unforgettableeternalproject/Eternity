/**
 * 使用者管理元件（Admin 後台）
 *
 * 提供 uep_users 的 CRUD 操作：列表、搜尋、編輯、軟刪除/復原、admin 備註。
 * 透過同源 SSR proxy（/api/uep-admin/users/*）操作——
 * admin JWT 存於 httpOnly cookie，瀏覽器端讀不到，由 proxy 在 server 端轉發
 * （與媒體庫的 /api/assets proxy 模式一致）。
 */
/* global RequestInit */
import { useState, useEffect, useCallback, useRef } from 'react';

import { getDialog, getToast } from './editorHelpers';
import './UserManager.css';

// ===== 型別 =====

interface UepUser {
  id: number;
  username: string;
  alias: string;
  email: string | null;
  observerEver: boolean;
  hasProgress: boolean;
  isActive: boolean;
  adminNote: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ===== API 工具 =====

/** 呼叫同源 SSR proxy，認證由 proxy 從 httpOnly cookie 轉發 */
async function apiFetch<T>(
  url: string,
  opts?: RequestInit
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    });
    const json = await res.json();
    return json as { ok: boolean; data?: T; error?: string };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ===== 工具函式 =====

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  return new Date(dateStr).toLocaleDateString('zh-TW');
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ===== 元件 =====

export default function UserManager() {
  const [users, setUsers] = useState<UepUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [selected, setSelected] = useState<UepUser | null>(null);
  const [editNote, setEditNote] = useState('');
  const [editAlias, setEditAlias] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  /* ── 進度編輯（S7 驗收加碼）：結構化欄位 + JSON 進階區 ── */
  const [progressData, setProgressData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressDirty, setProgressDirty] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState(false);
  const [newFlag, setNewFlag] = useState('');
  const [newPage, setNewPage] = useState('');

  // 載入使用者清單
  const loadUsers = useCallback(
    async (searchQuery = '') => {
      setLoading(true);
      const params = new URLSearchParams();
      if (showDeleted) params.set('include_deleted', 'true');
      if (searchQuery) params.set('search', searchQuery);
      const qs = params.toString();
      const res = await apiFetch<UepUser[]>(
        `/api/uep-admin/users${qs ? '?' + qs : ''}`
      );
      if (res.ok && res.data) {
        setUsers(res.data);
      } else if (!res.ok) {
        getToast().error(`載入使用者失敗: ${res.error || '未知錯誤'}`);
      }
      setLoading(false);
    },
    [showDeleted]
  );

  useEffect(() => {
    loadUsers(search);
  }, [loadUsers, search]);

  // 搜尋 debounce
  const handleSearchChange = (val: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 300);
  };

  // 選取使用者
  const selectUser = (user: UepUser) => {
    setSelected(user);
    setEditNote(user.adminNote || '');
    setEditAlias(user.alias);
    setEditEmail(user.email || '');
    void loadProgress(user.id);
  };

  /* ── 進度編輯 ── */

  const loadProgress = async (userId: number) => {
    setProgressLoading(true);
    setProgressDirty(false);
    setJsonOpen(false);
    setJsonError(false);
    const res = await apiFetch<Record<string, unknown> | null>(
      `/api/uep-admin/users/${userId}/progress`
    );
    setProgressData(res.ok ? (res.data ?? null) : null);
    setProgressLoading(false);
  };

  /** 更新進度草稿（結構化欄位 → draft；JSON 區開著時同步文字） */
  const updateProgress = (patch: Record<string, unknown>) => {
    setProgressData((prev) => {
      const next = { ...(prev ?? {}), ...patch };
      if (jsonOpen) setJsonText(JSON.stringify(next, null, 2));
      return next;
    });
    setProgressDirty(true);
  };

  /** 進度的字串陣列欄位（flags / completedPageIds 防禦性讀取） */
  const progressList = (key: string): string[] => {
    const raw = progressData?.[key];
    return Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === 'string')
      : [];
  };

  const saveProgress = async () => {
    if (!selected || !progressData) return;
    setSaving(true);
    const res = await apiFetch<UepUser>(`/api/uep-admin/users/${selected.id}`, {
      method: 'PUT',
      body: JSON.stringify({ progress: progressData }),
    });
    if (res.ok && res.data) {
      setSelected(res.data);
      setProgressDirty(false);
      getToast().success('進度已儲存');
      // blob 內 observerEver 由 server 鏡射欄位同步——重抓對齊
      void loadProgress(res.data.id);
      loadUsers(search);
    } else {
      getToast().error(res.error || '進度儲存失敗');
    }
    setSaving(false);
  };

  const resetProgress = async () => {
    if (!selected) return;
    const ok = await getDialog().confirm(
      `確定要清空「${selected.alias}」的全部進度嗎？旗標、完成頁、閱讀統計都會歸零，此操作無法復原。`,
      { title: '重置進度', confirmText: '清空', cancelText: '取消' }
    );
    if (!ok) return;
    setSaving(true);
    const res = await apiFetch<UepUser>(`/api/uep-admin/users/${selected.id}`, {
      method: 'PUT',
      body: JSON.stringify({ progress: null }),
    });
    if (res.ok && res.data) {
      setSelected(res.data);
      setProgressData(null);
      setProgressDirty(false);
      getToast().success('進度已清空');
      loadUsers(search);
    } else {
      getToast().error(res.error || '操作失敗');
    }
    setSaving(false);
  };

  /** 印記 toggle（admin 雙向：取消印記＝恢復純潔者） */
  const toggleObserver = async () => {
    if (!selected) return;
    const granting = !selected.observerEver;
    const ok = await getDialog().confirm(
      granting
        ? `要為「${selected.alias}」烙下觀測者印記嗎？`
        : `要清除「${selected.alias}」的觀測者印記、恢復純潔者身分嗎？\n（讀者端規則印記是單向的——這是管理員覆寫）`,
      {
        title: granting ? '授予印記' : '清除印記',
        confirmText: granting ? '烙下' : '清除',
        cancelText: '取消',
      }
    );
    if (!ok) return;
    setSaving(true);
    const res = await apiFetch<UepUser>(`/api/uep-admin/users/${selected.id}`, {
      method: 'PUT',
      body: JSON.stringify({ observerEver: granting }),
    });
    if (res.ok && res.data) {
      setSelected(res.data);
      getToast().success(granting ? '印記已烙下' : '印記已清除');
      // blob 內 observerEver 已由 server 同步——重抓草稿對齊
      void loadProgress(res.data.id);
      loadUsers(search);
    } else {
      getToast().error(res.error || '操作失敗');
    }
    setSaving(false);
  };

  // 儲存修改
  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);

    const body: Record<string, unknown> = {};
    if (editNote !== (selected.adminNote || ''))
      body.adminNote = editNote || null;
    if (editAlias !== selected.alias && editAlias.trim())
      body.alias = editAlias;
    if (editEmail !== (selected.email || '')) body.email = editEmail || null;

    if (Object.keys(body).length === 0) {
      getToast().info('沒有變更');
      setSaving(false);
      return;
    }

    const res = await apiFetch<UepUser>(`/api/uep-admin/users/${selected.id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (res.ok && res.data) {
      setSelected(res.data);
      setEditNote(res.data.adminNote || '');
      setEditAlias(res.data.alias);
      setEditEmail(res.data.email || '');
      getToast().success('已儲存');
      loadUsers(search);
    } else {
      getToast().error(res.error || '儲存失敗');
    }
    setSaving(false);
  };

  // 停用/啟用
  const toggleActive = async () => {
    if (!selected) return;
    setSaving(true);
    const res = await apiFetch<UepUser>(`/api/uep-admin/users/${selected.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isActive: !selected.isActive }),
    });
    if (res.ok && res.data) {
      setSelected(res.data);
      getToast().success(res.data.isActive ? '已啟用' : '已停用');
      loadUsers(search);
    } else {
      getToast().error(res.error || '操作失敗');
    }
    setSaving(false);
  };

  // 軟刪除
  const handleDelete = async () => {
    if (!selected) return;
    const ok = await getDialog().confirm(
      `確定要刪除使用者「${selected.alias}」嗎？（可復原）`
    );
    if (!ok) return;
    setSaving(true);
    const res = await apiFetch(`/api/uep-admin/users/${selected.id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      getToast().success('已刪除');
      setSelected(null);
      loadUsers(search);
    } else {
      getToast().error(res.error || '刪除失敗');
    }
    setSaving(false);
  };

  // 復原
  const handleRestore = async () => {
    if (!selected) return;
    setSaving(true);
    const res = await apiFetch(`/api/uep-admin/users/${selected.id}/restore`, {
      method: 'POST',
    });
    if (res.ok) {
      getToast().success('已復原');
      setSelected(null);
      loadUsers(search);
    } else {
      getToast().error(res.error || '復原失敗');
    }
    setSaving(false);
  };

  const isDirty =
    selected &&
    (editNote !== (selected.adminNote || '') ||
      editAlias !== selected.alias ||
      editEmail !== (selected.email || ''));

  /** 進度的字串清單欄位（旗標/完成頁）——chips + 新增輸入 */
  const renderListField = (
    key: 'flags' | 'completedPageIds',
    label: string,
    inputVal: string,
    setInputVal: (v: string) => void,
    placeholder: string
  ) => {
    const items = progressList(key);
    const add = () => {
      const v = inputVal.trim();
      if (!v || items.includes(v)) return;
      updateProgress({ [key]: [...items, v] });
      setInputVal('');
    };
    return (
      <div className="um-field">
        <label className="um-field-label">
          {label}（{items.length}）
        </label>
        <div className="um-chips">
          {items.map((item) => (
            <span className="um-chip" key={item}>
              <span>{item}</span>
              <button
                type="button"
                aria-label={`移除 ${item}`}
                onClick={() =>
                  updateProgress({ [key]: items.filter((i) => i !== item) })
                }
              >
                ×
              </button>
            </span>
          ))}
          {items.length === 0 && <span className="um-chips-empty">（無）</span>}
        </div>
        <div className="um-chip-add">
          <input
            className="um-field-input"
            value={inputVal}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button
            type="button"
            className="um-btn um-btn--sm"
            onClick={add}
            disabled={!inputVal.trim()}
          >
            ＋
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="um">
      {/* 左側：使用者清單 */}
      <div className="um-list">
        <div className="um-list-header">
          <div className="um-list-title">使用者</div>
          <div className="um-list-count">
            {loading ? '…' : `${users.length} 位`}
          </div>
        </div>

        <div className="um-search-bar">
          <input
            type="text"
            placeholder="搜尋帳號、代稱、信箱…"
            className="um-search-input"
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        <label className="um-filter-check">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          <span>顯示已刪除</span>
        </label>

        <div className="um-list-scroll">
          {users.map((u) => (
            <button
              key={u.id}
              className={`um-user-row ${selected?.id === u.id ? 'active' : ''} ${u.deletedAt ? 'deleted' : ''} ${!u.isActive ? 'inactive' : ''}`}
              onClick={() => selectUser(u)}
            >
              <div className="um-user-avatar">{u.observerEver ? '◉' : '◈'}</div>
              <div className="um-user-info">
                <div className="um-user-alias">
                  {u.observerEver && (
                    <span className="um-witnessed">已見證的</span>
                  )}
                  {u.alias}
                </div>
                <div className="um-user-meta">
                  @{u.username}
                  {u.deletedAt && (
                    <span className="um-badge um-badge--del">已刪除</span>
                  )}
                  {!u.isActive && !u.deletedAt && (
                    <span className="um-badge um-badge--off">停用</span>
                  )}
                  {u.adminNote && (
                    <span className="um-badge um-badge--note">📝</span>
                  )}
                </div>
              </div>
              <div className="um-user-time">{timeAgo(u.createdAt)}</div>
            </button>
          ))}
          {!loading && users.length === 0 && (
            <div className="um-empty">沒有符合條件的使用者</div>
          )}
        </div>
      </div>

      {/* 右側：詳情/編輯面板 */}
      <div className="um-detail">
        {selected ? (
          <>
            <div className="um-detail-header">
              <div className="um-detail-avatar">
                {selected.observerEver ? '◉' : '◈'}
              </div>
              <div className="um-detail-title">
                <div className="um-detail-alias">
                  {selected.observerEver && (
                    <span className="um-witnessed">已見證的</span>
                  )}
                  {selected.alias}
                </div>
                <div className="um-detail-username">@{selected.username}</div>
              </div>
              <div className="um-detail-badges">
                {selected.deletedAt && (
                  <span className="um-badge um-badge--del">已刪除</span>
                )}
                {!selected.isActive && !selected.deletedAt && (
                  <span className="um-badge um-badge--off">停用中</span>
                )}
                {selected.hasProgress && (
                  <span className="um-badge um-badge--prog">有進度</span>
                )}
              </div>
            </div>

            <div className="um-detail-stats">
              <div className="um-stat">
                <span className="um-stat-label">ID</span>
                <span className="um-stat-value">{selected.id}</span>
              </div>
              <div className="um-stat">
                <span className="um-stat-label">註冊</span>
                <span className="um-stat-value">
                  {formatDate(selected.createdAt)}
                </span>
              </div>
              <div className="um-stat">
                <span className="um-stat-label">更新</span>
                <span className="um-stat-value">
                  {formatDate(selected.updatedAt)}
                </span>
              </div>
              <div className="um-stat">
                <span className="um-stat-label">觀測者印記</span>
                <span className="um-stat-value">
                  {selected.observerEver ? '✓ 有印記' : '✗ 未沾染'}
                  {!selected.deletedAt && (
                    <button
                      type="button"
                      className="um-mark-btn"
                      onClick={toggleObserver}
                      disabled={saving}
                      title={
                        selected.observerEver
                          ? '清除印記（恢復純潔者——管理員覆寫）'
                          : '烙下觀測者印記'
                      }
                    >
                      {selected.observerEver ? '清除' : '烙下'}
                    </button>
                  )}
                </span>
              </div>
            </div>

            <div className="um-detail-form">
              <div className="um-field">
                <label className="um-field-label">代稱</label>
                <input
                  type="text"
                  className="um-field-input"
                  value={editAlias}
                  onChange={(e) => setEditAlias(e.target.value)}
                />
              </div>
              <div className="um-field">
                <label className="um-field-label">Email</label>
                <input
                  type="email"
                  className="um-field-input"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="（未填寫）"
                />
              </div>
              <div className="um-field">
                <label className="um-field-label">管理員備註</label>
                <textarea
                  className="um-field-textarea"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="寫些關於這位使用者的備註…"
                  rows={4}
                />
              </div>
            </div>

            {/* 進度編輯（S7 驗收加碼）：結構化欄位 + JSON 進階區 */}
            {!selected.deletedAt && (
              <div className="um-progress">
                <div className="um-progress-header">
                  <span className="um-progress-title">進度資料</span>
                  {progressData !== null && (
                    <>
                      <button
                        type="button"
                        className="um-btn um-btn--sm um-btn--save"
                        onClick={saveProgress}
                        disabled={saving || !progressDirty || jsonError}
                      >
                        儲存進度
                      </button>
                      <button
                        type="button"
                        className="um-btn um-btn--sm um-btn--danger"
                        onClick={resetProgress}
                        disabled={saving}
                      >
                        重置
                      </button>
                    </>
                  )}
                </div>

                {progressLoading ? (
                  <div className="um-progress-empty">載入中…</div>
                ) : progressData === null ? (
                  <div className="um-progress-empty">
                    無進度資料——使用者尚未同步過進度。
                  </div>
                ) : (
                  <>
                    <div className="um-field">
                      <label className="um-field-label">視角</label>
                      <select
                        className="um-field-input"
                        value={
                          progressData.view === 'observer'
                            ? 'observer'
                            : 'explorer'
                        }
                        onChange={(e) =>
                          updateProgress({ view: e.target.value })
                        }
                      >
                        <option value="explorer">◈ 探索者</option>
                        <option value="observer">◉ 觀測者</option>
                      </select>
                    </div>
                    {progressData.view === 'observer' &&
                      !selected.observerEver && (
                        <div className="um-hint">
                          ⚠ 視角為觀測者但無印記——讀者端載入時 normalize
                          會強制補上印記（不變量）
                        </div>
                      )}

                    {renderListField(
                      'flags',
                      '旗標',
                      newFlag,
                      setNewFlag,
                      '如 met:xavier-colsono、zone:visited:history'
                    )}
                    {renderListField(
                      'completedPageIds',
                      '完成頁',
                      newPage,
                      setNewPage,
                      '如 history/u/1/1/1'
                    )}

                    <button
                      type="button"
                      className="um-json-toggle"
                      onClick={() =>
                        setJsonOpen((v) => {
                          const next = !v;
                          if (next) {
                            setJsonText(JSON.stringify(progressData, null, 2));
                            setJsonError(false);
                          }
                          return next;
                        })
                      }
                    >
                      {jsonOpen ? '▾ 收起 JSON' : '▸ JSON 進階編輯（完整欄位）'}
                    </button>
                    {jsonOpen && (
                      <>
                        <textarea
                          className={`um-field-textarea um-json${jsonError ? ' um-json--error' : ''}`}
                          rows={12}
                          spellCheck={false}
                          value={jsonText}
                          onChange={(e) => {
                            const t = e.target.value;
                            setJsonText(t);
                            try {
                              const parsed = JSON.parse(t) as unknown;
                              if (
                                parsed &&
                                typeof parsed === 'object' &&
                                !Array.isArray(parsed)
                              ) {
                                setProgressData(
                                  parsed as Record<string, unknown>
                                );
                                setProgressDirty(true);
                                setJsonError(false);
                              } else {
                                setJsonError(true);
                              }
                            } catch {
                              setJsonError(true);
                            }
                          }}
                        />
                        {jsonError && (
                          <div className="um-hint um-hint--error">
                            不是合法 JSON 物件——修正前保留上次合法值
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="um-detail-actions">
              <button
                className="um-btn um-btn--save"
                onClick={handleSave}
                disabled={saving || !isDirty}
              >
                {saving ? '儲存中…' : '儲存變更'}
              </button>

              {!selected.deletedAt && (
                <button
                  className={`um-btn ${selected.isActive ? 'um-btn--warn' : 'um-btn--ok'}`}
                  onClick={toggleActive}
                  disabled={saving}
                >
                  {selected.isActive ? '停用帳號' : '啟用帳號'}
                </button>
              )}

              {selected.deletedAt ? (
                <button
                  className="um-btn um-btn--ok"
                  onClick={handleRestore}
                  disabled={saving}
                >
                  復原使用者
                </button>
              ) : (
                /* 只有已停用的帳號能刪。刪除是這個面板上最容易點錯的一格，
                   「先停用、確認沒事再刪」讓誤刪需要兩個刻意的動作。
                   停用中的帳號還登得進 admin 面板看，停用本身可直接復原。
                   Worker 端同樣擋著（回 409），這裡只是不讓人白按。 */
                <button
                  className="um-btn um-btn--danger"
                  onClick={handleDelete}
                  disabled={saving || selected.isActive}
                  title={
                    selected.isActive ? '請先停用這個紀錄，才能刪除' : undefined
                  }
                >
                  刪除使用者
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="um-detail-empty">
            <div className="um-detail-empty-icon">◈</div>
            <div className="um-detail-empty-text">
              選擇左側的使用者以查看詳情
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
