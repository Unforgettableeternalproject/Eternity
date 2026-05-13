import React, { useCallback, useEffect, useRef, useState } from 'react';

interface GalleryItem {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  metadata: Record<string, unknown>;
}

interface VisualsSubcatEditorProps {
  area: string;
  apiBase: string;
  pageId: string;
  pageSlug: string;
  accent: string;
  onDirty: () => void;
  refreshKey?: number;
}

export default function VisualsSubcatEditor({
  area,
  apiBase,
  pageId,
  pageSlug,
  accent,
  onDirty,
  refreshKey,
}: VisualsSubcatEditorProps) {
  const [galleries, setGalleries] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 新增畫廊表單
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  // 拖曳
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // 載入子畫廊頁面
  const fetchGalleries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/content/${area}/tree`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) return;

      // 從 tree 中遞迴找到目標節點
      function findNode(nodes: any[]): any {
        for (const n of nodes) {
          if (n.id === pageId) return n;
          const found = findNode(n.children || []);
          if (found) return found;
        }
        return null;
      }

      const node = findNode(json.data || []);
      if (node) {
        const galleryChildren = (node.children || [])
          .filter((c: any) => c.pageType === 'gallery')
          .sort((a: GalleryItem, b: GalleryItem) => a.sortOrder - b.sortOrder);
        setGalleries(galleryChildren);
      }
    } catch (err) {
      console.error('載入畫廊清單失敗:', err);
    } finally {
      setLoading(false);
    }
  }, [apiBase, area, pageId]);

  useEffect(() => {
    void fetchGalleries();
  }, [fetchGalleries, refreshKey]);

  // 新增畫廊
  const handleAddGallery = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);

    const title = newTitle.trim();
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/^-|-$/g, '') || `gallery-${Date.now()}`;

    const gallerySlug = `${pageSlug}/${slug}`;
    try {
      const res = await fetch(`${apiBase}/api/content/${area}/${gallerySlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content: [{ id: 'content', type: 'rich_text', content: '' }],
          parentId: pageId,
          depth: pageId.split('/').length,
          pageType: 'gallery',
          sortOrder: galleries.length,
          metadata: {
            images: [],
            group: '',
            spoilerLevel: 0,
            gate: '',
          },
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setNewTitle('');
        setShowAdd(false);
        await fetchGalleries();
      } else {
        alert(`新增失敗: ${json.error}`);
      }
    } catch (e: any) {
      alert(`錯誤: ${e.message}`);
    } finally {
      setCreating(false);
    }
  };

  // 拖曳排序
  const handleDragStart = (idx: number) => setDragIdx(idx);

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDropIdx(idx);
  };

  const handleDrop = async () => {
    if (dragIdx === null || dropIdx === null || dragIdx === dropIdx) {
      setDragIdx(null);
      setDropIdx(null);
      return;
    }

    const newGalleries = [...galleries];
    const [moved] = newGalleries.splice(dragIdx, 1);
    newGalleries.splice(dropIdx, 0, moved);
    setGalleries(newGalleries);
    setDragIdx(null);
    setDropIdx(null);

    for (let i = 0; i < newGalleries.length; i++) {
      const g = newGalleries[i];
      if (g.sortOrder !== i) {
        const gSlug = g.id.replace(`${area}/`, '');
        await fetch(`${apiBase}/api/content/${area}/${gSlug}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: i }),
        });
      }
    }
  };

  // 刪除畫廊
  const handleDeleteGallery = async (gallery: GalleryItem) => {
    if (!window.confirm(`確定刪除畫廊「${gallery.title}」?`)) return;
    const gSlug = gallery.id.replace(`${area}/`, '');
    try {
      await fetch(`${apiBase}/api/content/${area}/${gSlug}`, {
        method: 'DELETE',
      });
      await fetchGalleries();
    } catch (e: any) {
      alert(`刪除失敗: ${e.message}`);
    }
  };

  return (
    <div className="ned-subcat-editor">
      <div className="ned-subcat-section">
        <div className="ned-subcat-list-header">
          <label className="ned-field-label" style={{ margin: 0 }}>
            畫廊頁面
          </label>
          <span className="ned-subcat-list-count">{galleries.length} 個</span>
          <button
            className="ned-btn-ghost ned-btn-sm"
            type="button"
            onClick={() => {
              setShowAdd(true);
              setTimeout(() => addInputRef.current?.focus(), 50);
            }}
            style={{ marginLeft: 'auto', color: accent }}
          >
            + 新增畫廊
          </button>
        </div>

        {loading && <div className="ned-subcat-loading">載入中...</div>}

        {!loading && galleries.length === 0 && !showAdd && (
          <div className="ned-subcat-empty">尚無畫廊頁面</div>
        )}

        <div className="ned-subcat-song-list">
          {galleries.map((gallery, i) => {
            const meta = gallery.metadata || {};
            const spoiler = (meta.spoilerLevel as number) || 0;
            const group = (meta.group as string) || '';
            const images = Array.isArray(meta.images) ? meta.images : [];
            const isDragging = dragIdx === i;
            const isDropTarget = dropIdx === i;

            return (
              <div
                key={gallery.id}
                className={`ned-subcat-song-row ${isDragging ? 'is-dragging' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={handleDrop}
                onDragEnd={() => {
                  setDragIdx(null);
                  setDropIdx(null);
                }}
              >
                <span className="ned-subcat-song-grip" title="拖曳排序">
                  ⠿
                </span>
                <span className="ned-subcat-song-num" style={{ color: accent }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="ned-subcat-song-info">
                  <a
                    href={`/admin/edit/${gallery.id}`}
                    className="ned-subcat-song-title"
                  >
                    {gallery.title || '(無標題)'}
                  </a>
                  <span className="ned-subcat-song-sub">
                    {images.length} 張圖片
                    {group && ` · ${group}`}
                  </span>
                </div>
                <span
                  style={{
                    display: 'inline-flex',
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  {meta.hidden === true ? (
                    <span
                      className="ned-subcat-song-spoiler"
                      style={{ color: 'var(--ink-mute, #888)' }}
                    >
                      隱藏
                    </span>
                  ) : meta.locked === true ? (
                    <span
                      className="ned-subcat-song-spoiler"
                      style={{ color: 'var(--ink-mute, #888)' }}
                    >
                      鎖定
                    </span>
                  ) : null}
                  {spoiler > 0 && (
                    <span
                      className="ned-subcat-song-spoiler"
                      style={{
                        color: spoiler === 3 ? 'crimson' : 'goldenrod',
                      }}
                    >
                      L{spoiler}
                    </span>
                  )}
                </span>
                <a
                  href={`/admin/edit/${gallery.id}`}
                  className="ned-subcat-song-edit"
                  style={{ color: accent }}
                  title="編輯畫廊"
                >
                  →
                </a>
                <button
                  type="button"
                  className="ned-subcat-song-delete"
                  onClick={() => handleDeleteGallery(gallery)}
                  title="刪除畫廊"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {/* 新增畫廊表單 */}
        {showAdd && (
          <div className="ned-subcat-add-form">
            <input
              ref={addInputRef}
              className="ned-field ned-subcat-add-input"
              type="text"
              value={newTitle}
              placeholder="輸入畫廊標題..."
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAddGallery();
                }
                if (e.key === 'Escape') {
                  setShowAdd(false);
                  setNewTitle('');
                }
              }}
              disabled={creating}
            />
            <button
              type="button"
              className="ned-btn-ghost ned-btn-sm"
              onClick={() => void handleAddGallery()}
              disabled={creating || !newTitle.trim()}
              style={{ color: accent }}
            >
              {creating ? '建立中...' : '確認'}
            </button>
            <button
              type="button"
              className="ned-btn-ghost ned-btn-sm"
              onClick={() => {
                setShowAdd(false);
                setNewTitle('');
              }}
            >
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
