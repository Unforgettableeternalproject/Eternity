import React, { useCallback, useEffect, useRef, useState } from 'react';
import { beginRowDrag, getDialog } from './editorHelpers';
import { renderIcon } from './IconLibrary';

/** 通用陣列搬移 */
function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr];
  const [moved] = result.splice(from, 1);
  result.splice(to, 0, moved);
  return result;
}

/** 插入縫隙（0 = 最前）換算成移除來源後的目標 index */
function moveIndexForGap(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}

/** 元素 from 移到 to 之後，原本位於 idx 的元素的新位置 */
function remapIndexAfterMove(idx: number, from: number, to: number): number {
  if (idx === from) return to;
  if (from < idx && idx <= to) return idx - 1;
  if (to <= idx && idx < from) return idx + 1;
  return idx;
}

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

  // 分頁拖曳排序：來源以 ref 記錄（is-dragging 延一幀才套，drop 判定不能
  // 等 state）；插入點以「縫隙」表示，0 = 第一個分頁之前
  const tabDragFromRef = useRef<number | null>(null);
  const [tabDragIdx, setTabDragIdx] = useState<number | null>(null);
  const [tabDropGap, setTabDropGap] = useState<number | null>(null);

  const resetTabDrag = () => {
    tabDragFromRef.current = null;
    setTabDragIdx(null);
    setTabDropGap(null);
  };

  const handleTabDragStart = (e: React.DragEvent<HTMLElement>, idx: number) => {
    beginRowDrag(e, idx);
    tabDragFromRef.current = idx;
    requestAnimationFrame(() => {
      if (tabDragFromRef.current === idx) setTabDragIdx(idx);
    });
  };

  const handleTabDragOver = (e: React.DragEvent<HTMLElement>, idx: number) => {
    const from = tabDragFromRef.current;
    if (from === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const gap = e.clientX > rect.left + rect.width / 2 ? idx + 1 : idx;
    // 來源兩側的縫隙等於原位，不顯示插入指示
    setTabDropGap(moveIndexForGap(from, gap) === from ? null : gap);
  };

  const handleTabDrop = (e: React.DragEvent<HTMLElement>) => {
    // 拖曳帶 text/plain，未擋預設行為時 Firefox 會把它當網址開啟
    e.preventDefault();
    const from = tabDragFromRef.current;
    const gap = tabDropGap;
    resetTabDrag();
    if (from === null || gap === null) return;
    const to = moveIndexForGap(from, gap);
    if (to === from) return;
    onZoneTabsChange(moveItem(zoneTabs, from, to));
    // 選取跟著分頁本身走，不停在原本的位置
    setActiveIdx(remapIndexAfterMove(activeIdx, from, to));
  };

  /** 拖曳中的插入指示：inset 陰影不改變寬度，拖曳中不會推擠版面 */
  const tabDragStyle = (i: number): React.CSSProperties | undefined => {
    const style: React.CSSProperties = {};
    if (tabDragIdx === i) style.opacity = 0.4;
    if (tabDropGap === i) style.boxShadow = `inset 2px 0 0 ${accent}`;
    else if (tabDropGap === i + 1 && i === zoneTabs.length - 1)
      style.boxShadow = `inset -2px 0 0 ${accent}`;
    return Object.keys(style).length > 0 ? style : undefined;
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

  // 章節列拖曳排序：來源以 ref 記錄（is-dragging 延一幀才套，drop 判定
  // 不能等 state）
  const dragFromRef = useRef<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const resetItemDrag = () => {
    dragFromRef.current = null;
    setDragIdx(null);
    setDropIdx(null);
  };

  const handleItemDragStart = (
    e: React.DragEvent<HTMLElement>,
    idx: number
  ) => {
    beginRowDrag(e, idx);
    dragFromRef.current = idx;
    requestAnimationFrame(() => {
      if (dragFromRef.current === idx) setDragIdx(idx);
    });
  };

  const handleItemDragOver = (e: React.DragEvent<HTMLElement>, idx: number) => {
    if (dragFromRef.current === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIdx(idx);
  };

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    // 拖曳帶 text/plain，未擋預設行為時 Firefox 會把它當網址開啟
    e.preventDefault();
    const from = dragFromRef.current;
    const to = dropIdx;
    resetItemDrag();
    if (
      from === null ||
      to === null ||
      from === to ||
      activeIdx >= zoneTabs.length
    )
      return;
    updateTab(activeIdx, {
      items: moveItem(zoneTabs[activeIdx].items, from, to),
    });
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
                <div
                  key={i}
                  className="ned-zone-tab-drag"
                  draggable={editingIdx === null}
                  onDragStart={(e) => handleTabDragStart(e, i)}
                  onDragOver={(e) => handleTabDragOver(e, i)}
                  onDrop={handleTabDrop}
                  onDragEnd={resetTabDrag}
                  style={{
                    display: 'flex',
                    flexShrink: 0,
                    cursor: 'grab',
                    ...tabDragStyle(i),
                  }}
                >
                  <button
                    type="button"
                    className={`ned-zone-tab-btn ${activeIdx === i ? 'is-active' : ''}`}
                    onClick={() => setActiveIdx(i)}
                    onDoubleClick={() => startEdit(i)}
                    style={
                      activeIdx === i
                        ? { color: accent, borderBottomColor: accent }
                        : undefined
                    }
                    title="拖曳排序・雙擊重新命名"
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
                </div>
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
                      onDragStart={(e) => handleItemDragStart(e, i)}
                      onDragOver={(e) => handleItemDragOver(e, i)}
                      onDrop={handleDrop}
                      onDragEnd={resetItemDrag}
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
