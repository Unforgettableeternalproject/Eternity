import React, { useCallback, useEffect, useRef, useState } from 'react';

interface SongItem {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  metadata: Record<string, unknown>;
}

interface EchoesSubcatEditorProps {
  area: string;
  apiBase: string;
  pageId: string;
  pageSlug: string;
  accent: string;
  onDirty: () => void;
  refreshKey?: number;
}

export default function EchoesSubcatEditor({
  area,
  apiBase,
  pageId,
  pageSlug,
  accent,
  onDirty,
  refreshKey,
}: EchoesSubcatEditorProps) {
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 新增歌曲表單
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  // 拖曳
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // 載入子歌曲
  const fetchSongs = useCallback(async () => {
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
        // 收集所有 song 類型的直接子節點
        const songChildren = (node.children || [])
          .filter((c: any) => c.pageType === 'song')
          .sort((a: SongItem, b: SongItem) => a.sortOrder - b.sortOrder);
        setSongs(songChildren);
      }
    } catch (err) {
      console.error('載入歌曲清單失敗:', err);
    } finally {
      setLoading(false);
    }
  }, [apiBase, area, pageId]);

  useEffect(() => {
    void fetchSongs();
  }, [fetchSongs, refreshKey]);

  // 新增歌曲
  const handleAddSong = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);

    const title = newTitle.trim();
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/^-|-$/g, '') || `song-${Date.now()}`;

    const songSlug = `${pageSlug}/${slug}`;
    try {
      const res = await fetch(`${apiBase}/api/content/${area}/${songSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content: [{ id: 'content', type: 'rich_text', content: '' }],
          parentId: pageId,
          depth: pageId.split('/').length,
          pageType: 'song',
          sortOrder: songs.length,
          metadata: {
            subtitle: '',
            category: 'area',
            spoilerLevel: 0,
            gate: '',
            audioFile: null,
            audioMeta: null,
            appreciation: [''],
            appreciationLocked: '',
          },
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setNewTitle('');
        setShowAdd(false);
        await fetchSongs();
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

    // 重新排列
    const newSongs = [...songs];
    const [moved] = newSongs.splice(dragIdx, 1);
    newSongs.splice(dropIdx, 0, moved);
    setSongs(newSongs);
    setDragIdx(null);
    setDropIdx(null);

    // 更新每首歌的 sortOrder
    for (let i = 0; i < newSongs.length; i++) {
      const song = newSongs[i];
      if (song.sortOrder !== i) {
        const songSlug = song.id.replace(`${area}/`, '');
        await fetch(`${apiBase}/api/content/${area}/${songSlug}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: i }),
        });
      }
    }
  };

  // 刪除歌曲
  const handleDeleteSong = async (song: SongItem) => {
    if (!window.confirm(`確定刪除「${song.title}」?`)) return;
    const songSlug = song.id.replace(`${area}/`, '');
    try {
      await fetch(`${apiBase}/api/content/${area}/${songSlug}`, {
        method: 'DELETE',
      });
      await fetchSongs();
    } catch (e: any) {
      alert(`刪除失敗: ${e.message}`);
    }
  };

  return (
    <div className="ned-subcat-editor">
      {/* 曲目列表 */}
      <div className="ned-subcat-section">
        <div className="ned-subcat-list-header">
          <label className="ned-field-label" style={{ margin: 0 }}>
            曲目列表
          </label>
          <span className="ned-subcat-list-count">{songs.length} 首</span>
          <button
            className="ned-btn-ghost ned-btn-sm"
            type="button"
            onClick={() => {
              setShowAdd(true);
              setTimeout(() => addInputRef.current?.focus(), 50);
            }}
            style={{ marginLeft: 'auto', color: accent }}
          >
            + 新增歌曲
          </button>
        </div>

        {loading && <div className="ned-subcat-loading">載入中...</div>}

        {!loading && songs.length === 0 && !showAdd && (
          <div className="ned-subcat-empty">尚無曲目</div>
        )}

        <div className="ned-subcat-song-list">
          {songs.map((song, i) => {
            const meta = song.metadata || {};
            const spoiler = (meta.spoilerLevel as number) || 0;
            const subtitle = (meta.subtitle as string) || '';
            const isDragging = dragIdx === i;
            const isDropTarget = dropIdx === i;

            return (
              <div
                key={song.id}
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
                    href={`/admin/edit/${song.id}`}
                    className="ned-subcat-song-title"
                  >
                    {song.title || '(無標題)'}
                  </a>
                  {subtitle && (
                    <span className="ned-subcat-song-sub">{subtitle}</span>
                  )}
                </div>
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
                <a
                  href={`/admin/edit/${song.id}`}
                  className="ned-subcat-song-edit"
                  style={{ color: accent }}
                  title="編輯歌曲"
                >
                  →
                </a>
                <button
                  type="button"
                  className="ned-subcat-song-delete"
                  onClick={() => handleDeleteSong(song)}
                  title="刪除歌曲"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {/* 新增歌曲表單 */}
        {showAdd && (
          <div className="ned-subcat-add-form">
            <input
              ref={addInputRef}
              className="ned-field ned-subcat-add-input"
              type="text"
              value={newTitle}
              placeholder="輸入歌曲標題..."
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAddSong();
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
              onClick={() => void handleAddSong()}
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
