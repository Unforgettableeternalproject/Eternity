import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getDialog } from './editorHelpers';
import { renderIcon } from './IconLibrary';

/* === 分頁資料型別（儲存在 zone page 的 metadata.zoneTabs） === */
export interface ZoneTab {
  label: string;
  items: string[]; // page IDs
}

interface TreeNode {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  pageType: string;
  metadata: Record<string, unknown>;
  children: TreeNode[];
}

interface ZoneTabsEditorProps {
  area: string;
  apiBase: string;
  pageId: string;
  accent: string;
  zoneTabs: ZoneTab[];
  onZoneTabsChange: (tabs: ZoneTab[]) => void;
  refreshKey?: number;
}

export default function ZoneTabsEditor({
  area,
  apiBase,
  pageId,
  accent,
  zoneTabs,
  onZoneTabsChange,
  refreshKey,
}: ZoneTabsEditorProps) {
  const [children, setChildren] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // 載入子頁面，用來把 page ID 解析成標題
  const fetchChildren = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/content/${area}/tree`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) return;

      function findNode(nodes: TreeNode[]): TreeNode | null {
        for (const n of nodes) {
          if (n.id === pageId) return n;
          const found = findNode(n.children || []);
          if (found) return found;
        }
        return null;
      }

      const node = findNode(json.data || []);
      if (node) {
        const kids = (node.children || [])
          .filter(
            (c: TreeNode) =>
              c.pageType !== 'page' && c.metadata?.hidden !== true
          )
          .sort((a: TreeNode, b: TreeNode) => a.sortOrder - b.sortOrder);
        setChildren(kids);
      }
    } catch (err) {
      console.error('載入子頁面失敗:', err);
    } finally {
      setLoading(false);
    }
  }, [apiBase, area, pageId]);

  useEffect(() => {
    void fetchChildren();
  }, [fetchChildren, refreshKey]);

  // 已分配的 page IDs
  const assignedIds = new Set(zoneTabs.flatMap((t) => t.items));
  // 未分配的子頁面
  const unassigned = children.filter((c) => !assignedIds.has(c.id));
  // 解析 page ID → TreeNode
  const resolve = (id: string) => children.find((c) => c.id === id);

  /* === 編輯操作 === */

  const updateTab = (idx: number, patch: Partial<ZoneTab>) => {
    onZoneTabsChange(
      zoneTabs.map((t, i) => (i === idx ? { ...t, ...patch } : t))
    );
  };

  const addTab = () => {
    onZoneTabsChange([
      ...zoneTabs,
      { label: `分頁 ${zoneTabs.length + 1}`, items: [] },
    ]);
    setActiveIdx(zoneTabs.length);
  };

  const removeTab = async (idx: number) => {
    if (
      !(await getDialog().confirm(
        `確定刪除分頁「${zoneTabs[idx].label}」？其中的項目將變為未分類。`
      ))
    )
      return;
    const next = zoneTabs.filter((_, i) => i !== idx);
    onZoneTabsChange(next);
    if (activeIdx >= next.length) setActiveIdx(Math.max(0, next.length - 1));
  };

  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditingLabel(zoneTabs[idx].label);
    setTimeout(() => editInputRef.current?.select(), 30);
  };

  const commitEdit = () => {
    if (editingIdx !== null && editingLabel.trim()) {
      updateTab(editingIdx, { label: editingLabel.trim() });
    }
    setEditingIdx(null);
  };

  const addItem = (itemId: string) => {
    if (activeIdx < zoneTabs.length) {
      updateTab(activeIdx, {
        items: [...zoneTabs[activeIdx].items, itemId],
      });
    }
    setShowPicker(false);
  };

  const removeItem = (itemId: string) => {
    if (activeIdx < zoneTabs.length) {
      updateTab(activeIdx, {
        items: zoneTabs[activeIdx].items.filter((id) => id !== itemId),
      });
    }
  };

  // 拖曳排序
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const handleDrop = () => {
    if (
      dragIdx === null ||
      dropIdx === null ||
      dragIdx === dropIdx ||
      activeIdx >= zoneTabs.length
    )
      return;
    const items = [...zoneTabs[activeIdx].items];
    const [moved] = items.splice(dragIdx, 1);
    items.splice(dropIdx, 0, moved);
    updateTab(activeIdx, { items });
    setDragIdx(null);
    setDropIdx(null);
  };

  const activeTab = zoneTabs[activeIdx] || null;

  return (
    <div className="ned-zone-tabs">
      <div className="ned-zone-tabs-head">
        <label className="ned-field-label" style={{ margin: 0 }}>
          分頁目錄
        </label>
        <span className="ned-zone-tabs-count">
          {zoneTabs.length} 個分頁
          {unassigned.length > 0 && ` · ${unassigned.length} 未分類`}
        </span>
      </div>

      {loading && <div className="ned-zone-tabs-status">載入中...</div>}

      {!loading && (
        <div className="ned-zone-tabs-container">
          {/* 分頁標籤列 */}
          <div className="ned-zone-tabs-bar">
            {zoneTabs.map((tab, i) =>
              editingIdx === i ? (
                <input
                  key={i}
                  ref={editInputRef}
                  className="ned-zone-tab-input"
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit();
                    if (e.key === 'Escape') setEditingIdx(null);
                  }}
                  style={{ color: accent, borderBottomColor: accent }}
                />
              ) : (
                <button
                  key={i}
                  type="button"
                  className={`ned-zone-tab-btn ${activeIdx === i ? 'is-active' : ''}`}
                  onClick={() => setActiveIdx(i)}
                  onDoubleClick={() => startEdit(i)}
                  style={
                    activeIdx === i
                      ? { color: accent, borderBottomColor: accent }
                      : undefined
                  }
                  title="雙擊重新命名"
                >
                  {tab.label}
                  {activeIdx === i && zoneTabs.length > 1 && (
                    <span
                      className="ned-zone-tab-close"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTab(i);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') removeTab(i);
                      }}
                      title="移除分頁"
                    >
                      ×
                    </span>
                  )}
                </button>
              )
            )}
            <button
              type="button"
              className="ned-zone-tab-add"
              onClick={addTab}
              style={{ color: accent }}
              title="新增分頁"
            >
              +
            </button>
          </div>

          {/* 分頁內容 */}
          <div className="ned-zone-tabs-body">
            {activeTab ? (
              <>
                {activeTab.items.length === 0 && !showPicker && (
                  <div className="ned-zone-tabs-hint">
                    點擊下方「+ 加入章節」將頁面加入此分頁
                  </div>
                )}

                {activeTab.items.map((itemId, i) => {
                  const child = resolve(itemId);
                  const isDragging = dragIdx === i;
                  const isDropTarget = dropIdx === i;
                  return (
                    <div
                      key={itemId}
                      className={`ned-zone-tab-item ${isDragging ? 'is-dragging' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
                      draggable
                      onDragStart={() => setDragIdx(i)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDropIdx(i);
                      }}
                      onDrop={handleDrop}
                      onDragEnd={() => {
                        setDragIdx(null);
                        setDropIdx(null);
                      }}
                    >
                      <span className="ned-zone-tab-item-grip" title="拖曳排序">
                        ⠿
                      </span>
                      <span
                        className="ned-zone-tab-item-num"
                        style={{ color: accent }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {child ? (
                        <>
                          {renderIcon(
                            child.metadata?.icon as string,
                            14,
                            'ned-zone-tab-item-icon'
                          ) || (
                            <span className="ned-zone-tab-item-type">
                              {(child.pageType || 'P')
                                .slice(0, 4)
                                .toUpperCase()}
                            </span>
                          )}
                          <a
                            href={`/admin/edit/${child.id}`}
                            className="ned-zone-tab-item-title"
                          >
                            {child.title}
                          </a>
                        </>
                      ) : (
                        <>
                          <span className="ned-zone-tab-item-type">?</span>
                          <span className="ned-zone-tab-item-title ned-zone-tab-item--missing">
                            {itemId}
                          </span>
                        </>
                      )}
                      <a
                        href={child ? `/admin/edit/${child.id}` : '#'}
                        className="ned-zone-tab-item-edit"
                        style={{ color: accent }}
                        title="編輯頁面"
                      >
                        →
                      </a>
                      <button
                        type="button"
                        className="ned-zone-tab-item-remove"
                        onClick={() => removeItem(itemId)}
                        title="從分頁移除"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}

                {/* 新增章節 */}
                <div className="ned-zone-tab-add-row">
                  {showPicker ? (
                    <div className="ned-zone-tab-picker">
                      {unassigned.length === 0 ? (
                        <div className="ned-zone-tabs-hint">
                          所有子頁面都已分配到分頁中
                        </div>
                      ) : (
                        unassigned.map((child) => (
                          <button
                            key={child.id}
                            type="button"
                            className="ned-zone-tab-picker-item"
                            onClick={() => addItem(child.id)}
                          >
                            {renderIcon(
                              child.metadata?.icon as string,
                              13,
                              'ned-zone-tab-item-icon'
                            ) || null}
                            <span>{child.title}</span>
                          </button>
                        ))
                      )}
                      <button
                        type="button"
                        className="ned-btn-ghost ned-btn-sm"
                        onClick={() => setShowPicker(false)}
                        style={{ marginTop: 6 }}
                      >
                        收起
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="ned-zone-tab-add-btn"
                      onClick={() => setShowPicker(true)}
                      disabled={unassigned.length === 0}
                      style={{ color: accent }}
                    >
                      + 加入章節
                      {unassigned.length > 0 && (
                        <span className="ned-zone-tabs-count">
                          {unassigned.length} 可選
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="ned-zone-tabs-hint">點擊「+」新增第一個分頁</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
