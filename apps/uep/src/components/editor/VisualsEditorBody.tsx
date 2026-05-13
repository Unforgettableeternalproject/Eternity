/* global File, FormData */
import React, { useRef, useState } from 'react';

const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

// ──────────────────────────────────────────────────────────────
//  型別定義
// ──────────────────────────────────────────────────────────────

export interface ImageItem {
  /** 頁面內唯一 ID */
  id: string;
  /** R2 key (images/xxx.png) */
  file: string;
  /** 圖片說明 */
  caption: string;
  /** 排序 */
  sortOrder: number;
}

export interface VisualsData {
  /** 頁面內的圖片陣列 */
  images: ImageItem[];
  /** 分組標籤（同 group 的 gallery 在 subcat 中歸在一起）*/
  group: string;
  /** 遮蔽等級 0-3 */
  spoilerLevel: number;
  /** 解鎖條件 */
  gate: string;
}

export function parseVisualsData(
  metadata: Record<string, any>
): VisualsData {
  return {
    images: Array.isArray(metadata?.images) ? metadata.images : [],
    group: metadata?.group || '',
    spoilerLevel: metadata?.spoilerLevel ?? 0,
    gate: metadata?.gate || '',
  };
}

export function serializeVisualsData(
  data: VisualsData
): Record<string, any> {
  return {
    images: data.images,
    group: data.group || undefined,
    spoilerLevel: data.spoilerLevel,
    gate: data.gate || undefined,
  };
}

// ──────────────────────────────────────────────────────────────
//  工具函式
// ──────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 上傳檔案到 R2 */
async function uploadAsset(
  file: File
): Promise<{ key: string; url: string; size: number } | null> {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`${API_BASE}/api/assets`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const json = (await res.json()) as {
      ok: boolean;
      data: { key: string; url: string; size: number };
    };
    if (!json.ok) throw new Error('Upload returned ok=false');
    return json.data;
  } catch (err) {
    console.error('Upload error:', err);
    return null;
  }
}

/** 從 content-api 取得圖片列表（孤兒排前面）*/
interface ImagePickerItem {
  key: string;
  size: number;
  contentType: string;
  originalName: string;
  referenced: boolean;
  referencedBy: string[];
}

async function fetchImageAssets(): Promise<ImagePickerItem[]> {
  try {
    const res = await fetch(
      `${API_BASE}/api/assets?prefix=images/&limit=500`
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      ok: boolean;
      data: { items: ImagePickerItem[] };
    };
    if (!json.ok) return [];
    const items = json.data.items.filter(
      (i) =>
        i.contentType?.startsWith('image/') || i.key.startsWith('images/')
    );
    items.sort((a, b) => {
      if (a.referenced === b.referenced) return 0;
      return a.referenced ? 1 : -1;
    });
    return items;
  } catch {
    return [];
  }
}

function buildImageUrl(key: string): string {
  return `${API_BASE}/api/assets/${key
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')}`;
}

const SPOILER_LEVELS = [
  { l: 0, n: '無' },
  { l: 1, n: '霧化' },
  { l: 2, n: '遮罩' },
  { l: 3, n: '雜訊' },
];

// ──────────────────────────────────────────────────────────────
//  主元件
// ──────────────────────────────────────────────────────────────

interface VisualsEditorBodyProps {
  accent: string;
  initialData: VisualsData;
  onDataChange: (data: VisualsData) => void;
  onDirty: () => void;
}

export default function VisualsEditorBody({
  accent,
  initialData,
  onDataChange,
  onDirty,
}: VisualsEditorBodyProps) {
  const [data, setData] = useState<VisualsData>(initialData);
  const [uploading, setUploading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 圖片選擇器
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerItems, setPickerItems] = useState<ImagePickerItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // 拖曳
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // 刪除確認
  const [deleteConfirm, setDeleteConfirm] = useState<{
    imageId: string;
    file: string;
  } | null>(null);

  const update = (patch: Partial<VisualsData>) => {
    const next = { ...data, ...patch };
    setData(next);
    onDataChange(next);
    onDirty();
  };

  const updateImage = (imageId: string, patch: Partial<ImageItem>) => {
    const nextImages = data.images.map((img) =>
      img.id === imageId ? { ...img, ...patch } : img
    );
    update({ images: nextImages });
  };

  const removeImage = (imageId: string) => {
    update({
      images: data.images
        .filter((img) => img.id !== imageId)
        .map((img, i) => ({ ...img, sortOrder: i })),
    });
  };

  // 上傳圖片
  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const newImages: ImageItem[] = [];
      for (let i = 0; i < files.length; i++) {
        const result = await uploadAsset(files[i]);
        if (result) {
          newImages.push({
            id: generateId(),
            file: result.key,
            caption: '',
            sortOrder: data.images.length + newImages.length,
          });
        }
      }
      if (newImages.length > 0) {
        update({ images: [...data.images, ...newImages] });
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 從媒體庫選擇
  const openImagePicker = async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    const items = await fetchImageAssets();
    setPickerItems(items);
    setPickerLoading(false);
  };

  const selectFromLibrary = (item: ImagePickerItem) => {
    const already = data.images.some((img) => img.file === item.key);
    if (already) return;
    const newImg: ImageItem = {
      id: generateId(),
      file: item.key,
      caption: '',
      sortOrder: data.images.length,
    };
    update({ images: [...data.images, newImg] });
    setPickerOpen(false);
  };

  // 刪除
  const handleRemoveOnly = () => {
    if (!deleteConfirm) return;
    removeImage(deleteConfirm.imageId);
    setDeleteConfirm(null);
  };

  const handleDeleteFromLibrary = async () => {
    if (!deleteConfirm) return;
    const file = deleteConfirm.file;
    removeImage(deleteConfirm.imageId);
    setDeleteConfirm(null);
    try {
      const encoded = file
        .split('/')
        .map(encodeURIComponent)
        .join('/');
      await fetch(`${API_BASE}/api/assets/${encoded}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('刪除媒體庫檔案失敗:', err);
    }
  };

  // 拖曳排序
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDropIdx(idx);
  };
  const handleDrop = () => {
    if (dragIdx === null || dropIdx === null || dragIdx === dropIdx) {
      setDragIdx(null);
      setDropIdx(null);
      return;
    }
    const newImages = [...data.images];
    const [moved] = newImages.splice(dragIdx, 1);
    newImages.splice(dropIdx, 0, moved);
    update({
      images: newImages.map((img, i) => ({ ...img, sortOrder: i })),
    });
    setDragIdx(null);
    setDropIdx(null);
  };

  return (
    <div className="ned-echoes-body">
      {/* 圖片清單 */}
      <div className="ned-subcat-section">
        <div className="ned-subcat-list-header">
          <label className="ned-field-label" style={{ margin: 0 }}>
            圖片清單
          </label>
          <span className="ned-subcat-list-count">
            {data.images.length} 張
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              className="ned-btn-ghost ned-btn-sm"
              type="button"
              onClick={openImagePicker}
              style={{ color: accent }}
            >
              📂 媒體庫
            </button>
            <button
              className="ned-btn-ghost ned-btn-sm"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{ color: accent }}
            >
              {uploading ? '上傳中...' : '+ 上傳圖片'}
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleImageUpload}
        />

        {data.images.length === 0 && (
          <div className="ned-subcat-empty">
            尚無圖片 — 上傳或從媒體庫選取
          </div>
        )}

        <div className="ned-subcat-song-list">
          {data.images.map((img, i) => {
            const isExpanded = expandedId === img.id;
            const isDragging = dragIdx === i;
            const isDropTarget = dropIdx === i;

            return (
              <div key={img.id}>
                <div
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
                  <span
                    className="ned-subcat-song-grip"
                    title="拖曳排序"
                  >
                    ⠿
                  </span>
                  <span
                    className="ned-subcat-song-num"
                    style={{ color: accent }}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {/* 縮圖 */}
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      flexShrink: 0,
                      overflow: 'hidden',
                      border: '1px solid var(--line, #333)',
                      borderRadius: 4,
                      background: 'var(--bg-elevated, #252530)',
                    }}
                  >
                    {img.file && (
                      <img
                        src={buildImageUrl(img.file)}
                        alt=""
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    )}
                  </div>
                  <div className="ned-subcat-song-info" style={{ flex: 1 }}>
                    <span
                      className="ned-subcat-song-title"
                      style={{ cursor: 'pointer' }}
                      onClick={() =>
                        setExpandedId(isExpanded ? null : img.id)
                      }
                    >
                      {img.file?.split('/').pop() || '(未上傳)'}
                    </span>
                    {img.caption && (
                      <span className="ned-subcat-song-sub">
                        {img.caption}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="ned-subcat-song-edit"
                    style={{ color: accent }}
                    title={isExpanded ? '收合' : '展開編輯'}
                    onClick={() =>
                      setExpandedId(isExpanded ? null : img.id)
                    }
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  <button
                    type="button"
                    className="ned-subcat-song-delete"
                    onClick={() =>
                      setDeleteConfirm({
                        imageId: img.id,
                        file: img.file,
                      })
                    }
                    title="刪除圖片"
                  >
                    ×
                  </button>
                </div>

                {/* 展開的編輯區 */}
                {isExpanded && (
                  <div
                    style={{
                      padding: '12px 16px 12px 60px',
                      borderBottom: '1px solid var(--line, #333)',
                      background: 'var(--bg-soft, #1a1a22)',
                    }}
                  >
                    {/* 圖片預覽 */}
                    {img.file && (
                      <div
                        style={{
                          marginBottom: 12,
                          maxWidth: 320,
                          border: '1px solid var(--line, #333)',
                          borderRadius: 4,
                          overflow: 'hidden',
                        }}
                      >
                        <img
                          src={buildImageUrl(img.file)}
                          alt={img.caption || ''}
                          style={{
                            width: '100%',
                            display: 'block',
                          }}
                        />
                      </div>
                    )}
                    <label className="ned-field-label ned-field-label--sm">
                      說明 (Caption)
                    </label>
                    <input
                      className="ned-field ned-field--sm"
                      type="text"
                      value={img.caption}
                      placeholder="圖片說明..."
                      onChange={(e) =>
                        updateImage(img.id, {
                          caption: e.target.value,
                        })
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 分組標籤 */}
      <label className="ned-field-label">分組標籤</label>
      <input
        className="ned-field"
        type="text"
        value={data.group}
        placeholder="例如：主要角色、U時期"
        onChange={(e) => update({ group: e.target.value })}
      />

      {/* 遮蔽等級 */}
      <label className="ned-field-label">遮蔽等級 (Spoiler Level)</label>
      <div className="ned-spoiler-buttons">
        {SPOILER_LEVELS.map((o) => (
          <button
            key={o.l}
            className={`ned-spoiler-btn ${data.spoilerLevel === o.l ? 'is-active' : ''}`}
            style={{
              borderColor:
                data.spoilerLevel === o.l
                  ? accent
                  : 'var(--hairline-strong)',
              background:
                data.spoilerLevel === o.l
                  ? `${accent}12`
                  : 'transparent',
              color:
                data.spoilerLevel === o.l ? accent : 'var(--ink-soft)',
            }}
            onClick={() => update({ spoilerLevel: o.l })}
            type="button"
          >
            L{o.l}
            <span className="ned-spoiler-btn-label">{o.n}</span>
          </button>
        ))}
      </div>

      {/* 解鎖條件 */}
      <label className="ned-field-label">解鎖條件 (劇情前置)</label>
      <input
        className="ned-field"
        type="text"
        value={data.gate}
        placeholder="哪段劇情解鎖此畫廊"
        onChange={(e) => update({ gate: e.target.value })}
      />

      {/* 刪除確認 Dialog */}
      {deleteConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            style={{
              background: 'var(--bg-card, #1a1a22)',
              border: '1px solid var(--line, #333)',
              borderRadius: 12,
              padding: '24px 28px',
              maxWidth: 400,
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontWeight: 600,
                marginBottom: 8,
                fontSize: '1.05em',
              }}
            >
              刪除圖片
            </div>
            <div
              style={{
                fontSize: '0.85em',
                color: 'var(--ink-mute, #888)',
                marginBottom: 16,
                wordBreak: 'break-all',
              }}
            >
              {deleteConfirm.file.split('/').pop()}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <button
                type="button"
                className="ned-btn-ghost"
                onClick={handleRemoveOnly}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                }}
              >
                📎 僅從此畫廊移除
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.8em',
                    color: 'var(--ink-mute, #888)',
                    marginTop: 2,
                  }}
                >
                  檔案保留在媒體庫中，可供其他頁面使用
                </span>
              </button>
              <button
                type="button"
                className="ned-btn-ghost"
                onClick={() => void handleDeleteFromLibrary()}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                  borderColor: 'crimson',
                  color: 'crimson',
                }}
              >
                🗑 從媒體庫永久刪除
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.8em',
                    color: 'var(--ink-mute, #888)',
                    marginTop: 2,
                  }}
                >
                  移除引用並從 R2 儲存空間中刪除檔案
                </span>
              </button>
              <button
                type="button"
                className="ned-btn-ghost"
                onClick={() => setDeleteConfirm(null)}
                style={{
                  width: '100%',
                  padding: '8px 16px',
                  textAlign: 'center',
                  marginTop: 4,
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 圖片選擇器 Modal */}
      {pickerOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setPickerOpen(false)}
        >
          <div
            style={{
              background: 'var(--bg-card, #1a1a22)',
              border: '1px solid var(--line, #333)',
              borderRadius: 12,
              width: '90%',
              maxWidth: 640,
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--line, #333)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <strong>從媒體庫選擇圖片</strong>
                <span
                  style={{
                    marginLeft: 10,
                    fontSize: '0.85em',
                    color: 'var(--ink-mute, #888)',
                  }}
                >
                  僅顯示圖片 · 孤兒檔案優先
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ink, #ccc)',
                  fontSize: 20,
                  cursor: 'pointer',
                  padding: '0 4px',
                }}
              >
                ×
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
              {pickerLoading ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 32,
                    color: 'var(--ink-mute, #888)',
                  }}
                >
                  載入中...
                </div>
              ) : pickerItems.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 32,
                    color: 'var(--ink-mute, #888)',
                  }}
                >
                  媒體庫中沒有圖片
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: 8,
                  }}
                >
                  {pickerItems.map((item) => {
                    const already = data.images.some(
                      (img) => img.file === item.key
                    );
                    return (
                      <button
                        key={item.key}
                        type="button"
                        disabled={already}
                        onClick={() => selectFromLibrary(item)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          border: `1px solid ${already ? accent : 'var(--line, #333)'}`,
                          background: already
                            ? `${accent}15`
                            : 'transparent',
                          borderRadius: 6,
                          overflow: 'hidden',
                          cursor: already ? 'default' : 'pointer',
                          opacity: already ? 0.5 : 1,
                          padding: 0,
                          color: 'var(--ink, #ccc)',
                        }}
                      >
                        <img
                          src={buildImageUrl(item.key)}
                          alt=""
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            objectFit: 'cover',
                          }}
                        />
                        <div
                          style={{
                            padding: '4px 6px',
                            fontSize: '0.75em',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.originalName ||
                            item.key.split('/').pop()}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
