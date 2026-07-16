import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getDialog, getToast } from './editorHelpers';
import {
  TYPE_LETTERS,
  NO_DRAG_TYPES,
  NO_CHILDREN_TYPES,
  TREE_HIDDEN_TYPES,
  NO_INSERT_ZONE_AREAS,
  getDefaultChildPageType,
} from './editorModeRegistry';
import { renderIcon } from './IconLibrary';

interface PageTreeNode {
  id: string;
  title: string;
  slug: string;
  pageType: string;
  depth: number;
  sortOrder?: number;
  metadata: Record<string, unknown>;
  children: PageTreeNode[];
}

interface EditorPageTreeProps {
  area: string;
  apiBase: string;
  currentSlug: string;
  accent: string;
  refreshKey?: number;
  /**
   * 樹狀導航前的守衛。回傳 false → 取消導航（例如使用者在 UepDialog 選了留下）；
   * 未提供時樹點擊照舊直接跳頁。呼叫端負責清除 dirty 狀態以避免 beforeunload
   * 二次攔截。
   */
  beforeNavigate?: (targetPageId: string) => Promise<boolean>;
}

const NO_EDIT_TYPES = new Set<string>(); // page 類型已移至首頁編輯器

// Flatten tree into ordered list with parent info for drag calculations
interface FlatNode {
  node: PageTreeNode;
  depth: number;
  parentId: string | null;
  index: number; // position among siblings
}

function flattenTree(
  nodes: PageTreeNode[],
  depth = 0,
  parentId: string | null = null
): FlatNode[] {
  const result: FlatNode[] = [];
  nodes.forEach((node, i) => {
    result.push({ node, depth, parentId, index: i });
    if (node.children?.length) {
      result.push(...flattenTree(node.children, depth + 1, node.id));
    }
  });
  return result;
}

type DropPosition = 'before' | 'after' | 'child';

export default function EditorPageTree({
  area,
  apiBase,
  currentSlug,
  accent,
  refreshKey,
  beforeNavigate,
}: EditorPageTreeProps) {
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [contextNode, setContextNode] = useState<string | null>(null);

  // Inline 新增表單狀態
  const [creating, setCreating] = useState<{
    parentId: string | null;
    parentDepth: number;
    insertIndex: number;
  } | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    pos: DropPosition;
  } | null>(null);

  const fetchTree = useCallback(() => {
    setLoading(true);
    fetch(`${apiBase}/api/content/${area}/tree`)
      .then((res) => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json'))
          throw new Error('API not available');
        return res.json();
      })
      .then((json) => {
        if (json.ok) setTree(json.data);
        else setError(json.error || 'Failed to load tree');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBase, area]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // 儲存成功後由父元件遞增 refreshKey，觸發重新載入
  useEffect(() => {
    if (refreshKey) fetchTree();
  }, [refreshKey]); // eslint-disable-line

  useEffect(() => {
    const handler = () => setContextNode(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // --- 輔助：從真實 sortOrder 計算插入值 ---

  /** 取得某個 parent 底下的所有子節點（已按 sortOrder 排序） */
  function getChildrenOf(parentId: string | null): PageTreeNode[] {
    if (!parentId) return tree;
    const parent = findNode(tree, parentId);
    return parent?.children || [];
  }

  /**
   * 依照插入位置計算合適的 sortOrder。
   * 使用真實的 sortOrder 值（而非視覺索引），確保後端排序正確。
   */
  function calcSortOrder(
    siblings: PageTreeNode[],
    insertIndex: number
  ): number {
    if (siblings.length === 0) return 0;
    if (insertIndex <= 0) {
      return (siblings[0].sortOrder ?? 0) - 1;
    }
    if (insertIndex >= siblings.length) {
      return (siblings[siblings.length - 1].sortOrder ?? 0) + 1;
    }
    // 插在 idx-1 與 idx 之間
    const prev = siblings[insertIndex - 1].sortOrder ?? 0;
    const next = siblings[insertIndex].sortOrder ?? 0;
    if (next > prev + 1) return Math.floor((prev + next) / 2);
    return prev + 1;
  }

  // --- Drag & Drop ---

  const handleDragStart = (e: React.DragEvent, nodeId: string) => {
    setDragId(nodeId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', nodeId);
  };

  const handleDragOver = (e: React.DragEvent, nodeId: string) => {
    if (!dragId || dragId === nodeId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    let pos: DropPosition;
    if (y < h * 0.25) pos = 'before';
    else if (y > h * 0.75) pos = 'after';
    else pos = 'child';

    setDropTarget({ id: nodeId, pos });
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId || !dropTarget) return;

    const flat = flattenTree(tree);
    const dragFlat = flat.find((f) => f.node.id === dragId);
    const targetFlat = flat.find((f) => f.node.id === dropTarget.id);
    if (!dragFlat || !targetFlat) return;

    let newParentId: string | null;
    let newDepth: number;
    let newSortOrder: number;

    if (dropTarget.pos === 'child') {
      // 成為目標節點的子節點 — 放到最後
      newParentId = targetFlat.node.id;
      newDepth = targetFlat.node.depth + 1;
      const children = targetFlat.node.children || [];
      newSortOrder =
        children.length > 0
          ? Math.max(...children.map((c) => c.sortOrder ?? 0)) + 1
          : 0;
    } else if (dropTarget.pos === 'before') {
      // 放到目標前面 — 同層
      newParentId = targetFlat.parentId;
      newDepth = targetFlat.node.depth;
      newSortOrder = (targetFlat.node.sortOrder ?? 0) - 1;
    } else {
      // 放到目標後面 — 同層
      newParentId = targetFlat.parentId;
      newDepth = targetFlat.node.depth;
      newSortOrder = (targetFlat.node.sortOrder ?? 0) + 1;
    }

    setDragId(null);
    setDropTarget(null);

    const pageSlug = dragId.replace(`${area}/`, '');
    try {
      await fetch(`${apiBase}/api/content/${area}/${pageSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId: newParentId,
          depth: newDepth,
          sortOrder: newSortOrder,
        }),
      });
      fetchTree();
    } catch {
      // silent
    }
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDropTarget(null);
  };

  // --- CRUD ---

  // 開始 inline 建立 — 顯示輸入欄位
  const startCreate = (
    parentId: string | null,
    parentDepth: number,
    insertIndex: number
  ) => {
    setCreating({ parentId, parentDepth, insertIndex });
    setNewTitle('');
    setCreateError(null);
    // 如果是子頁面，確保父節點展開
    if (parentId) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
    setTimeout(() => createInputRef.current?.focus(), 30);
  };

  // 從 tree 中查找節點
  function findNode(nodes: PageTreeNode[], id: string): PageTreeNode | null {
    for (const n of nodes) {
      if (n.id === id) return n;
      const found = findNode(n.children || [], id);
      if (found) return found;
    }
    return null;
  }

  // 確認送出建立
  const submitCreate = async () => {
    if (!creating || !newTitle.trim()) {
      cancelCreate();
      return;
    }

    const title = newTitle.trim();
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/^-|-$/g, '') || `page-${Date.now()}`;

    const parentPath = creating.parentId || area;
    const pageSlug = `${parentPath}/${slug}`.replace(`${area}/`, '');

    let newPageType = 'section';
    let newMetadata: Record<string, unknown> = {};
    if (creating.parentId) {
      const parentNode = findNode(tree, creating.parentId);
      if (parentNode) {
        newPageType = getDefaultChildPageType(area, parentNode.pageType);
        // Concepts stack → type：繼承 stack_style
        if (area === 'concepts' && parentNode.pageType === 'stack') {
          const existingChild = (parentNode.children || []).find(
            (c) => c.metadata?.stack_style
          );
          const stackStyle =
            existingChild?.metadata?.stack_style ||
            (
              {
                'server/records': 'dossier',
                'server/browser': 'browser',
                'server/time_logs': 'chrono',
                'server/translation': 'diff',
              } as Record<string, string>
            )[parentNode.slug];
          if (stackStyle) newMetadata = { stack_style: stackStyle };
        }
      }
    }

    // 用真實 sortOrder 值計算正確的排序位置
    const siblings = getChildrenOf(creating.parentId);
    const sortOrder = calcSortOrder(siblings, creating.insertIndex);

    setCreateLoading(true);
    setCreateError(null);

    try {
      const res = await fetch(`${apiBase}/api/content/${area}/${pageSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content: [{ id: 'content', type: 'rich_text', content: '<p></p>' }],
          parentId: creating.parentId || null,
          depth: creating.parentDepth + 1,
          pageType: newPageType,
          sortOrder,
          metadata: newMetadata,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        window.location.href = `/admin/edit/${area}/${pageSlug}`;
      } else {
        setCreateError(json.error || '建立失敗');
        setCreateLoading(false);
      }
    } catch (e: any) {
      setCreateError(e.message || '網路錯誤');
      setCreateLoading(false);
    }
  };

  // 取消建立
  const cancelCreate = () => {
    setCreating(null);
    setNewTitle('');
    setCreateError(null);
  };

  const handleDelete = async (node: PageTreeNode) => {
    const hasChildren = node.children && node.children.length > 0;
    const msg = hasChildren
      ? `確定要刪除 "${node.title}" 嗎？此節點有 ${node.children.length} 個子頁面。`
      : `確定要刪除 "${node.title}" 嗎？`;
    if (!(await getDialog().confirm(msg))) return;

    const pageSlug = node.id.replace(`${area}/`, '');
    try {
      const res = await fetch(`${apiBase}/api/content/${area}/${pageSlug}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.ok) {
        if (node.id === `${area}/${currentSlug}`) {
          window.location.href = '/admin';
        } else {
          fetchTree();
        }
      } else {
        getToast().error(`Failed: ${json.error}`);
      }
    } catch (e: any) {
      getToast().error(`Error: ${e.message}`);
    }
  };

  // --- Inline 建立輸入列 ---

  const renderCreateRow = (depth: number) => (
    <div
      className="ned-tree-item ned-tree-create-row"
      style={{ paddingLeft: `${18 + depth * 14}px` }}
    >
      <span className="ned-tree-type" style={{ color: accent }}>
        +
      </span>
      <input
        ref={createInputRef}
        className="ned-tree-create-input"
        type="text"
        value={newTitle}
        onChange={(e) => {
          setNewTitle(e.target.value);
          setCreateError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitCreate();
          }
          if (e.key === 'Escape') cancelCreate();
        }}
        onBlur={() => {
          // 延遲一下，避免跟 loading 狀態衝突
          if (!createLoading) setTimeout(() => cancelCreate(), 120);
        }}
        placeholder="輸入頁面標題…"
        disabled={createLoading}
        autoFocus
      />
      {createLoading && <span className="ned-tree-create-spinner">…</span>}
      {createError && (
        <span className="ned-tree-create-error" title={createError}>
          !
        </span>
      )}
    </div>
  );

  // --- Insert zone（GitBook 風格：hover 在項目間顯示 + 按鈕）---

  const renderInsertZone = (
    parentId: string | null,
    parentDepth: number,
    index: number,
    depth: number
  ) => (
    <div
      key={`zone-${parentId ?? 'root'}-${index}`}
      className="ned-tree-insert-zone"
      onClick={() => startCreate(parentId, parentDepth, index)}
    >
      <div
        className="ned-tree-insert-line"
        style={{ paddingLeft: `${14 + depth * 14}px` }}
      >
        <span className="ned-tree-insert-plus">+</span>
        <span className="ned-tree-insert-rule" />
      </div>
    </div>
  );

  // 將節點列表與 insert zones 交錯排列
  const renderNodeList = (
    nodes: PageTreeNode[],
    depth: number,
    parentId: string | null,
    parentDepth: number
  ) => {
    const result: React.ReactNode[] = [];

    const showInsertZones = !NO_INSERT_ZONE_AREAS.has(area);

    for (let i = 0; i <= nodes.length; i++) {
      const isCreatingHere =
        creating?.parentId === parentId && creating?.insertIndex === i;

      if (isCreatingHere) {
        result.push(
          <React.Fragment key={`create-${parentId ?? 'root'}-${i}`}>
            {renderCreateRow(depth)}
          </React.Fragment>
        );
      } else if (showInsertZones) {
        result.push(renderInsertZone(parentId, parentDepth, i, depth));
      }

      if (i < nodes.length) {
        result.push(renderNode(nodes[i], depth));
      }
    }

    return result;
  };

  // --- Render ---

  const renderNode = (
    node: PageTreeNode,
    depth: number = 0
  ): React.ReactNode => {
    // page / homepage 類型節點由首頁編輯器管理 — 跳過節點本身，但保留其子層
    if (node.pageType === 'page' || node.pageType === 'homepage') {
      const children = node.children || [];
      if (children.length === 0) return null;
      return (
        <React.Fragment key={node.id}>
          {children.map((child: PageTreeNode) => renderNode(child, depth))}
        </React.Fragment>
      );
    }
    if (TREE_HIDDEN_TYPES[area]?.has(node.pageType)) return null;

    const isActive = node.id === `${area}/${currentSlug}`;
    const hiddenSet = TREE_HIDDEN_TYPES[area];
    const visibleChildren = hiddenSet
      ? (node.children || []).filter(
          (c: PageTreeNode) => !hiddenSet.has(c.pageType)
        )
      : node.children || [];
    const hasChildren = visibleChildren.length > 0;
    const isCollapsed = collapsed.has(node.id);
    const noEdit = NO_EDIT_TYPES.has(node.pageType);
    const noDrag = NO_DRAG_TYPES.has(node.pageType);
    const isDragging = dragId === node.id;
    const isDropTarget = dropTarget?.id === node.id;
    const showContext = contextNode === node.id;

    let dropClass = '';
    if (isDropTarget && dropTarget) {
      dropClass = `ned-tree-drop--${dropTarget.pos}`;
    }

    return (
      <div key={node.id}>
        <div
          className={`ned-tree-item ${dropClass} ${isDragging ? 'ned-tree-item--dragging' : ''}`}
          style={{
            paddingLeft: `${18 + depth * 14}px`,
            borderLeftColor: isActive ? accent : 'transparent',
            background: isActive ? `${accent}10` : undefined,
            color: isActive ? 'var(--ink-title)' : undefined,
          }}
          draggable={!noDrag}
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        >
          {hasChildren && (
            <button
              className="ned-tree-toggle"
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(node.id);
              }}
            >
              {isCollapsed ? '+' : '\u2013'}
            </button>
          )}
          {renderIcon(node.metadata?.icon as string, 14, 'ned-tree-icon') || (
            <span className="ned-tree-type">
              {TYPE_LETTERS[node.pageType] || 'P'}
            </span>
          )}
          {noEdit ? (
            <span
              className="ned-tree-label ned-tree-label--locked"
              title="Homepage-level (not editable here)"
            >
              {node.title || node.slug}
            </span>
          ) : (
            <a
              href={`/admin/edit/${node.id}`}
              className="ned-tree-label"
              onClick={async (e) => {
                if (isActive) {
                  e.preventDefault();
                  return;
                }
                if (!beforeNavigate) return; // 未提供守衛 → 原生跳轉
                e.preventDefault();
                const ok = await beforeNavigate(node.id);
                if (ok) window.location.href = `/admin/edit/${node.id}`;
              }}
            >
              {node.title || node.slug}
            </a>
          )}
          {hasChildren && (
            <span className="ned-tree-count">{node.children.length}</span>
          )}
          {area === 'echoes' &&
            node.pageType === 'song' &&
            typeof node.metadata?.spoilerLevel === 'number' &&
            (node.metadata.spoilerLevel as number) > 0 && (
              <span
                className="ned-tree-spoiler-badge"
                style={{
                  color:
                    (node.metadata.spoilerLevel as number) === 3
                      ? 'crimson'
                      : 'goldenrod',
                }}
              >
                L{node.metadata.spoilerLevel as number}
              </span>
            )}
          {!noEdit && (
            <button
              className="ned-tree-menu-btn"
              onClick={(e) => {
                e.stopPropagation();
                setContextNode(showContext ? null : node.id);
              }}
            >
              &middot;&middot;&middot;
            </button>
          )}
          {showContext && (
            <div
              className="ned-tree-context"
              onClick={(e) => e.stopPropagation()}
            >
              {!NO_CHILDREN_TYPES.has(node.pageType) &&
                !(area === 'echoes' && node.pageType === 'subcategory') &&
                !(area === 'visuals' && node.pageType === 'subcategory') && (
                  <button
                    className="ned-tree-context-item"
                    onClick={() => {
                      setContextNode(null);
                      startCreate(node.id, node.depth, visibleChildren.length);
                    }}
                  >
                    {(area === 'echoes' && node.pageType === 'cluster') ||
                    (area === 'visuals' && node.pageType === 'division')
                      ? '+ Add subcategory'
                      : '+ Add child'}
                  </button>
                )}
              <button
                className="ned-tree-context-item ned-tree-context-item--danger"
                onClick={() => {
                  setContextNode(null);
                  handleDelete(node);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
        {hasChildren && !isCollapsed && (
          <div>
            {renderNodeList(visibleChildren, depth + 1, node.id, node.depth)}
          </div>
        )}
        {/* 無子節點但正在建立子頁面時，顯示 inline 表單 */}
        {!hasChildren && creating?.parentId === node.id && (
          <div>{renderCreateRow(depth + 1)}</div>
        )}
      </div>
    );
  };

  return (
    <div className="ned-tree">
      <div className="ned-tree-header">
        <span>page tree</span>
        <button
          className="ned-tree-add"
          style={{ color: accent }}
          title="New root-level page"
          onClick={() => startCreate(null, -1, tree.length)}
        >
          +
        </button>
      </div>
      {loading && <div className="ned-tree-status">Loading...</div>}
      {error && <div className="ned-tree-status ned-tree-error">{error}</div>}
      {!loading && !error && renderNodeList(tree, 0, null, -1)}
    </div>
  );
}
