import { useCallback, useEffect, useState } from 'react';

import type { uepDialog as UepDialogType } from '../ui/UepDialog';
import type { uepToast as UepToastType } from '../ui/UepToast';

import './MediaLibrary.css';

// ── 型別 ──

interface AssetItem {
  key: string;
  size: number;
  uploaded: string;
  contentType: string;
  originalName?: string;
  referenced: boolean;
  referencedBy: string[];
}

interface MediaLibraryProps {
  apiBase: string;
}

type TabFilter = 'all' | 'images' | 'audio';

// ── 工具函式 ──

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function getFilename(key: string): string {
  return key.split('/').pop() || key;
}

function getDisplayName(item: AssetItem): string {
  return item.originalName || getFilename(item.key);
}

function isImage(item: AssetItem): boolean {
  return (
    item.contentType.startsWith('image/') || item.key.startsWith('images/')
  );
}

function isAudio(item: AssetItem): boolean {
  return item.contentType.startsWith('audio/') || item.key.startsWith('audio/');
}

/** R2 key 可能含空白或特殊字元，每段需要 encode */
function encodeAssetKey(key: string): string {
  return key
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

function getDialog(): typeof UepDialogType | null {
  return typeof window !== 'undefined'
    ? (window.__uepDialogManager ?? null)
    : null;
}

function getToast(): typeof UepToastType | null {
  return typeof window !== 'undefined'
    ? (window.__uepToastManager ?? null)
    : null;
}

// ── 元件 ──

export default function MediaLibrary({ apiBase }: MediaLibraryProps) {
  const [items, setItems] = useState<AssetItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<AssetItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // ── 載入資產 ──

  const fetchAssets = useCallback(async (nextCursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (nextCursor) params.set('cursor', nextCursor);
      const res = await fetch(`/api/assets?${params}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          items: AssetItem[];
          cursor?: string;
          hasMore: boolean;
        };
        error?: string;
      };
      if (!json.ok) throw new Error(json.error || '載入失敗');
      const data = json.data!;
      setItems((prev) => (nextCursor ? [...prev, ...data.items] : data.items));
      setCursor(data.cursor);
      setHasMore(data.hasMore);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '未知錯誤';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // ── 衍生狀態 ──

  const searchLower = search.toLowerCase();
  const filtered = items.filter((item) => {
    if (tab === 'images' && !isImage(item)) return false;
    if (tab === 'audio' && !isAudio(item)) return false;
    if (searchLower) {
      const name = (item.originalName || item.key).toLowerCase();
      if (!name.includes(searchLower)) return false;
    }
    return true;
  });

  const totalSize = items.reduce((acc, i) => acc + i.size, 0);
  const orphanCount = items.filter((i) => !i.referenced).length;
  const imageCount = items.filter((i) => isImage(i)).length;
  const audioCount = items.filter((i) => isAudio(i)).length;

  // ── 選取操作 ──

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(filtered.map((i) => i.key)));
  };

  const clearSelection = () => setSelected(new Set());

  const selectOrphans = () => {
    setSelected(
      new Set(filtered.filter((i) => !i.referenced).map((i) => i.key))
    );
  };

  // ── 刪除操作 ──

  const confirmDelete = async (message: string): Promise<boolean> => {
    const dialog = getDialog();
    if (dialog) {
      return dialog.confirm(message, {
        title: '確認刪除',
        confirmText: '刪除',
        cancelText: '取消',
      });
    }
    return window.confirm(message);
  };

  const deleteSingle = async (key: string) => {
    if (!(await confirmDelete(`確定要刪除「${getFilename(key)}」嗎？`))) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/assets/${encodeAssetKey(key)}`, {
        method: 'DELETE',
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error || '刪除失敗');
      setItems((prev) => prev.filter((i) => i.key !== key));
      if (detail?.key === key) setDetail(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '未知錯誤';
      getToast()?.error(`刪除失敗：${msg}`);
    } finally {
      setDeleting(false);
    }
  };

  const deleteBatch = async () => {
    const keys = Array.from(selected);
    if (keys.length === 0) return;
    const hasReferenced = keys.some(
      (key) => items.find((i) => i.key === key)?.referenced
    );
    const warn = hasReferenced
      ? '\n\n部分選取的檔案仍被頁面引用，刪除後相關頁面可能損壞。'
      : '';
    if (
      !(await confirmDelete(
        `即將刪除 ${keys.length} 個檔案，此操作無法復原。${warn}`
      ))
    )
      return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/assets/batch`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error || '批次刪除失敗');
      setItems((prev) => prev.filter((i) => !selected.has(i.key)));
      if (detail && selected.has(detail.key)) setDetail(null);
      setSelected(new Set());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '未知錯誤';
      getToast()?.error(`批次刪除失敗：${msg}`);
    } finally {
      setDeleting(false);
    }
  };

  // ── 改名操作 ──

  const startRename = () => {
    if (!detail) return;
    // 預填檔名部分（不含 prefix 路徑）
    const parts = detail.key.split('/');
    setRenameValue(parts.length > 1 ? parts.slice(1).join('/') : detail.key);
    setRenaming(true);
  };

  const submitRename = async () => {
    if (!detail || !renameValue.trim()) return;
    // 保持原本的 prefix（audio/ images/ files/）
    const prefix = detail.key.split('/')[0];
    const newKey = `${prefix}/${renameValue.trim()}`;
    if (newKey === detail.key) {
      setRenaming(false);
      return;
    }
    try {
      const res = await fetch(`/api/assets/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldKey: detail.key, newKey }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { key: string };
        error?: string;
      };
      if (!json.ok) throw new Error(json.error || '改名失敗');
      // 更新本地狀態
      setItems((prev) =>
        prev.map((i) => (i.key === detail.key ? { ...i, key: newKey } : i))
      );
      setDetail((prev) => (prev ? { ...prev, key: newKey } : null));
      setRenaming(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '未知錯誤';
      getToast()?.error(`改名失敗：${msg}`);
    }
  };

  // ── 渲染 ──

  const tabLabels: Record<TabFilter, string> = {
    all: `全部 (${items.length})`,
    images: `圖片 (${imageCount})`,
    audio: `音檔 (${audioCount})`,
  };

  return (
    <div className="ml">
      {/* 統計列 */}
      <div className="ml-stats">
        <span className="ml-stat">共 {items.length} 個檔案</span>
        <span className="ml-stat-sep">&middot;</span>
        <span className="ml-stat">總計 {fmtBytes(totalSize)}</span>
        <span className="ml-stat-sep">&middot;</span>
        <span className={`ml-stat ${orphanCount > 0 ? 'ml-stat--warn' : ''}`}>
          {orphanCount} 個孤兒檔案
        </span>
      </div>

      {/* 工具列 */}
      <div className="ml-toolbar">
        <div className="ml-tabs">
          {(['all', 'images', 'audio'] as TabFilter[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`ml-tab ${tab === t ? 'ml-tab--active' : ''}`}
              onClick={() => {
                setTab(t);
                clearSelection();
              }}
            >
              {tabLabels[t]}
            </button>
          ))}
        </div>

        <input
          type="text"
          className="ml-search"
          placeholder="搜尋檔名..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {selected.size > 0 ? (
          <div className="ml-actions">
            <span className="ml-sel-count">已選 {selected.size} 個</span>
            <button
              type="button"
              className="ml-btn ml-btn--danger"
              onClick={() => void deleteBatch()}
              disabled={deleting}
            >
              批次刪除
            </button>
            <button type="button" className="ml-btn" onClick={clearSelection}>
              取消選取
            </button>
          </div>
        ) : (
          <div className="ml-actions">
            <button type="button" className="ml-btn" onClick={selectOrphans}>
              選取孤兒
            </button>
            <button type="button" className="ml-btn" onClick={selectAll}>
              全選
            </button>
            <button
              type="button"
              className="ml-btn"
              onClick={() => fetchAssets()}
            >
              重新整理
            </button>
          </div>
        )}
      </div>

      {/* 錯誤 */}
      {error && <div className="ml-error">載入失敗：{error}</div>}

      {/* 主體 */}
      <div className="ml-body-wrap">
        <div className="ml-body" onClick={() => setDetail(null)}>
          <div className="ml-grid">
            {!loading && filtered.length === 0 && (
              <div className="ml-empty">
                {items.length === 0
                  ? '目前 R2 儲存空間中沒有任何檔案'
                  : '此分類下尚不存在任何檔案'}
              </div>
            )}

            {filtered.map((item) => (
              <div
                key={item.key}
                className={`ml-card${selected.has(item.key) ? ' ml-card--selected' : ''}${!item.referenced ? ' ml-card--orphan' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDetail(item);
                }}
              >
                <input
                  type="checkbox"
                  className="ml-checkbox"
                  checked={selected.has(item.key)}
                  onChange={() => toggleSelect(item.key)}
                  onClick={(e) => e.stopPropagation()}
                />

                <div className="ml-thumb">
                  {isImage(item) ? (
                    <img
                      src={`${apiBase}/api/assets/${encodeAssetKey(item.key)}`}
                      alt={getDisplayName(item)}
                      loading="lazy"
                      className="ml-thumb-img"
                    />
                  ) : (
                    <span className="ml-thumb-icon">&#9835;</span>
                  )}
                </div>

                {!item.referenced && (
                  <span className="ml-orphan-badge" title="未被任何頁面引用">
                    &#9888;
                  </span>
                )}

                <div className="ml-card-info">
                  <div className="ml-card-name" title={item.key}>
                    {getDisplayName(item)}
                  </div>
                  <div className="ml-card-meta">
                    {fmtBytes(item.size)} &middot; {fmtDate(item.uploaded)}
                  </div>
                </div>
              </div>
            ))}

            {loading && <div className="ml-loading">載入中...</div>}
          </div>

          {hasMore && !loading && (
            <div className="ml-load-more">
              <button
                type="button"
                className="ml-btn"
                onClick={() => fetchAssets(cursor)}
              >
                載入更多
              </button>
            </div>
          )}
        </div>

        {/* 詳情面板（常駐） */}
        <div className="ml-detail">
          {detail ? (
            <>
              <div className="ml-detail-preview">
                {isImage(detail) ? (
                  <img
                    src={`${apiBase}/api/assets/${encodeAssetKey(detail.key)}`}
                    alt={getDisplayName(detail)}
                    className="ml-detail-img"
                  />
                ) : (
                  <div className="ml-detail-audio-icon">&#9835;</div>
                )}
              </div>

              <div className="ml-detail-body">
                {detail.originalName && (
                  <>
                    <div className="ml-detail-label">原始檔名</div>
                    <div className="ml-detail-value">{detail.originalName}</div>
                  </>
                )}

                <div className="ml-detail-label">R2 路徑</div>
                {renaming ? (
                  <div className="ml-rename-row">
                    <span className="ml-rename-prefix">
                      {detail.key.split('/')[0]}/
                    </span>
                    <input
                      type="text"
                      className="ml-rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename();
                        if (e.key === 'Escape') setRenaming(false);
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="ml-btn"
                      onClick={submitRename}
                    >
                      確認
                    </button>
                    <button
                      type="button"
                      className="ml-btn"
                      onClick={() => setRenaming(false)}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div
                    className="ml-detail-value ml-detail-key ml-detail-key--renamable"
                    onClick={startRename}
                    title="點擊以改名"
                  >
                    {detail.key}
                  </div>
                )}

                <div className="ml-detail-label">大小</div>
                <div className="ml-detail-value">{fmtBytes(detail.size)}</div>

                <div className="ml-detail-label">上傳日期</div>
                <div className="ml-detail-value">
                  {fmtDate(detail.uploaded)}
                </div>

                <div className="ml-detail-label">類型</div>
                <div className="ml-detail-value">{detail.contentType}</div>

                <div className="ml-detail-label">引用狀態</div>
                <div className="ml-detail-value">
                  {detail.referenced ? (
                    `引用於 ${detail.referencedBy.length} 個頁面`
                  ) : (
                    <span className="ml-orphan-text">
                      &#9888; 孤兒檔案（未被任何頁面引用）
                    </span>
                  )}
                </div>

                {detail.referencedBy.length > 0 && (
                  <>
                    <div className="ml-detail-label">引用頁面</div>
                    <div className="ml-detail-refs">
                      {detail.referencedBy.map((id) => (
                        <a
                          key={id}
                          href={`/admin/edit/${id}`}
                          className="ml-detail-ref-link"
                        >
                          {id}
                        </a>
                      ))}
                    </div>
                  </>
                )}

                <button
                  type="button"
                  className="ml-btn ml-btn--danger ml-detail-delete"
                  onClick={() => deleteSingle(detail.key)}
                  disabled={deleting}
                >
                  刪除此檔案
                </button>
              </div>
            </>
          ) : (
            <div className="ml-detail-empty">
              <div className="ml-detail-empty-icon">&#9654;</div>
              <div className="ml-detail-empty-text">點選左側檔案以查看詳情</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
