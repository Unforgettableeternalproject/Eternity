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
                <button
                  className="um-btn um-btn--danger"
                  onClick={handleDelete}
                  disabled={saving}
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
