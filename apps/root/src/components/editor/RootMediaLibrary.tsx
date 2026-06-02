import React, { useState, useCallback, useEffect, useRef } from 'react';
import './RootMediaLibrary.css';

// ── types ──
interface AssetItem {
  key: string;
  size: number;
  uploaded: string;
  contentType: string;
  originalName?: string;
}

interface RootMediaLibraryProps {
  apiBase: string;
  token: string;
  /** page = 完整媒體庫頁面, picker = dialog 模式（選圖用） */
  mode: 'page' | 'picker';
  onPick?: (url: string) => void;
  /** 過濾顯示的檔案類型：image 只顯示圖片、audio 只顯示音檔、all 全部（預設） */
  filterType?: 'image' | 'audio' | 'all';
}

// ── utils ──
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

function encodeAssetKey(key: string): string {
  return key
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

function buildAssetUrl(apiBase: string, key: string): string {
  return `${apiBase}/api/root/assets/${encodeAssetKey(key)}`;
}

// ── component ──
export default function RootMediaLibrary({
  apiBase,
  token,
  mode,
  onPick,
  filterType = 'all',
}: RootMediaLibraryProps) {
  const [items, setItems] = useState<AssetItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AssetItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // headers helper
  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  // ── fetch ──
  const fetchAssets = useCallback(
    async (nextCursor?: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '200' });
        if (nextCursor) params.set('cursor', nextCursor);
        const res = await fetch(`${apiBase}/api/root/assets?${params}`, {
          headers: authHeaders(),
        });
        const json = (await res.json()) as {
          ok: boolean;
          data?: { items: AssetItem[]; cursor?: string; hasMore: boolean };
        };
        if (!json.ok) throw new Error('載入失敗');
        const data = json.data!;
        setItems((prev) =>
          nextCursor ? [...prev, ...data.items] : data.items
        );
        setCursor(data.cursor);
        setHasMore(data.hasMore);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    },
    [apiBase, authHeaders]
  );

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // ── upload ──
  const handleUpload = useCallback(
    async (files: globalThis.FileList | null) => {
      if (!files || files.length === 0) return;
      const allowed = Array.from(files).filter((f) => {
        if (filterType === 'audio') return f.type.startsWith('audio/');
        if (filterType === 'image') return f.type.startsWith('image/');
        return f.type.startsWith('image/') || f.type.startsWith('audio/');
      });
      if (allowed.length === 0) return;

      setUploading(true);
      const failed: string[] = [];
      for (const file of allowed) {
        try {
          const res = await fetch(`${apiBase}/api/root/assets`, {
            method: 'POST',
            headers: authHeaders(),
            body: (() => {
              const fd = new FormData();
              fd.append('file', file);
              return fd;
            })(),
          });
          if (!res.ok) failed.push(file.name);
        } catch {
          failed.push(file.name);
        }
      }
      setUploading(false);
      if (failed.length > 0) {
        alert(`上傳失敗：${failed.join('、')}`);
      }
      fetchAssets();
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [apiBase, authHeaders, fetchAssets]
  );

  // ── delete ──
  const handleDelete = useCallback(
    async (key: string) => {
      if (!window.confirm(`確定要刪除「${getFilename(key)}」嗎？`)) return;
      try {
        const res = await fetch(
          `${apiBase}/api/root/assets/${encodeAssetKey(key)}`,
          {
            method: 'DELETE',
            headers: authHeaders(),
          }
        );
        if (!res.ok) {
          alert(`刪除失敗：${getFilename(key)}`);
          return;
        }
        setItems((prev) => prev.filter((i) => i.key !== key));
        if (selected?.key === key) setSelected(null);
      } catch {
        alert(`刪除失敗：${getFilename(key)}`);
      }
    },
    [apiBase, authHeaders, selected]
  );

  // ── copy URL ──
  const copyUrl = useCallback(
    (key: string) => {
      const url = buildAssetUrl(apiBase, key);
      navigator.clipboard.writeText(url).catch(() => {});
    },
    [apiBase]
  );

  // ── drag & drop ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);
  const handleDragLeave = useCallback(() => setDragging(false), []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleUpload(e.dataTransfer.files);
    },
    [handleUpload]
  );

  // ── filter helpers ──
  const AUDIO_EXTS = /\.(mp3|wav|ogg|flac|m4a|aac|wma|opus)$/i;
  const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;

  function isAudio(item: AssetItem): boolean {
    return item.contentType?.startsWith('audio/') || AUDIO_EXTS.test(item.key);
  }
  function isImage(item: AssetItem): boolean {
    return item.contentType?.startsWith('image/') || IMAGE_EXTS.test(item.key);
  }

  // ── filter ──
  const searchLower = search.toLowerCase();
  const filtered = items.filter((item) => {
    // content type 過濾（contentType + 副檔名 fallback）
    if (filterType === 'image' && !isImage(item)) return false;
    if (filterType === 'audio' && !isAudio(item)) return false;
    // 搜尋文字過濾
    if (!searchLower) return true;
    const name = (item.originalName || item.key).toLowerCase();
    return name.includes(searchLower);
  });

  const totalSize = items.reduce((a, i) => a + i.size, 0);

  // ── card click ──
  const handleCardClick = useCallback(
    (item: AssetItem) => {
      if (mode === 'picker' && onPick) {
        onPick(item.key);
      } else {
        setSelected((prev) => (prev?.key === item.key ? null : item));
      }
    },
    [mode, onPick, apiBase]
  );

  return (
    <div
      className={`qe-ml${mode === 'picker' ? ' qe-ml--picker' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ position: 'relative' }}
    >
      <div className="qe-ml__main">
        {/* toolbar */}
        <div className="qe-ml__toolbar">
          <input
            className="qe-ml__search"
            placeholder="搜尋檔案名稱…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="qe-ml__stats">
            {items.length} files · {fmtBytes(totalSize)}
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="qe-ml__upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'uploading…' : '＋ upload'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>

        {/* grid */}
        <div className="qe-ml__grid-wrap">
          {loading && items.length === 0 ? (
            <div className="qe-ml__empty">loading…</div>
          ) : filtered.length === 0 ? (
            <div className="qe-ml__empty">
              {items.length === 0
                ? '尚無檔案 — 拖曳圖片到此處上傳'
                : '找不到符合的檔案'}
            </div>
          ) : (
            <div className="qe-ml__grid">
              {filtered.map((item) => (
                <div
                  key={item.key}
                  className={`qe-ml__card${selected?.key === item.key ? ' qe-ml__card--selected' : ''}`}
                  onClick={() => handleCardClick(item)}
                >
                  <img
                    className="qe-ml__thumb"
                    src={buildAssetUrl(apiBase, item.key)}
                    alt={item.originalName || item.key}
                    loading="lazy"
                  />
                  <div className="qe-ml__card-meta">
                    <div className="qe-ml__card-name">
                      {item.originalName || getFilename(item.key)}
                    </div>
                    <div className="qe-ml__card-size">
                      {fmtBytes(item.size)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hasMore && (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <button
                className="qe-ml__upload-btn"
                onClick={() => fetchAssets(cursor)}
                disabled={loading}
              >
                {loading ? 'loading…' : 'load more'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* detail panel (page mode only) */}
      {mode === 'page' && selected && (
        <div className="qe-ml__detail">
          <img
            className="qe-ml__detail-preview"
            src={buildAssetUrl(apiBase, selected.key)}
            alt=""
          />

          <div className="qe-ml__detail-field">
            <div className="qe-ml__detail-label">filename</div>
            <div className="qe-ml__detail-value">
              {selected.originalName || getFilename(selected.key)}
            </div>
          </div>

          <div className="qe-ml__detail-field">
            <div className="qe-ml__detail-label">r2 key</div>
            <div className="qe-ml__detail-value">{selected.key}</div>
          </div>

          <div className="qe-ml__detail-field">
            <div className="qe-ml__detail-label">size</div>
            <div className="qe-ml__detail-value">{fmtBytes(selected.size)}</div>
          </div>

          <div className="qe-ml__detail-field">
            <div className="qe-ml__detail-label">type</div>
            <div className="qe-ml__detail-value">{selected.contentType}</div>
          </div>

          <div className="qe-ml__detail-field">
            <div className="qe-ml__detail-label">uploaded</div>
            <div className="qe-ml__detail-value">
              {fmtDate(selected.uploaded)}
            </div>
          </div>

          <div className="qe-ml__detail-actions">
            <button
              className="qe-topbar__btn"
              onClick={() => copyUrl(selected.key)}
              style={{ flex: 1 }}
            >
              <span className="qe-mono">copy url</span>
            </button>
            <button
              className="qe-topbar__btn qe-topbar__btn--danger"
              onClick={() => handleDelete(selected.key)}
            >
              <span className="qe-mono" style={{ color: 'inherit' }}>
                delete
              </span>
            </button>
          </div>
        </div>
      )}

      {/* drag overlay */}
      {dragging && (
        <div className="qe-ml__drop-overlay">
          <span
            className="qe-mono"
            style={{
              color: 'var(--qe-navy)',
              fontSize: 14,
              letterSpacing: '0.2em',
            }}
          >
            放開以上傳圖片
          </span>
        </div>
      )}
    </div>
  );
}
