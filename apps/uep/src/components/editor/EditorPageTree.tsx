import React, { useCallback, useEffect, useRef, useState } from 'react';
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
}

const TYPE_LETTERS: Record<string, string> = {
  zone: 'Z',
  chapter: 'C',
  arc: 'A',
  section: 'S',
  page: 'P',
  song: 'S',
};

const NO_EDIT_TYPES = new Set(['page']); // cannot open in editor
const NO_DRAG_TYPES = new Set(['page', 'zone']); // cannot be reordered

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
      newParentId = targetFlat.node.id;
      newDepth = targetFlat.depth + 1;
      newSortOrder = targetFlat.node.children?.length ?? 0;
    } else if (dropTarget.pos === 'before') {
      newParentId = targetFlat.parentId;
      newDepth = targetFlat.depth;
      newSortOrder = Math.max(0, targetFlat.index);
    } else {
      newParentId = targetFlat.parentId;
      newDepth = targetFlat.depth;
      newSortOrder = targetFlat.index + 1;
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
          pageType: 'section',
          sortOrder: creating.insertIndex,
          metadata: {},
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
      ? `"${node.title}" has ${node.children.length} child page(s). Delete anyway?`
      : `Delete "${node.title}"?`;
    if (!window.confirm(msg)) return;

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
        window.alert(`Failed: ${json.error}`);
      }
    } catch (e: any) {
      window.alert(`Error: ${e.message}`);
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

    for (let i = 0; i <= nodes.length; i++) {
      const isCreatingHere =
        creating?.parentId === parentId && creating?.insertIndex === i;

      if (isCreatingHere) {
        result.push(
          <React.Fragment key={`create-${parentId ?? 'root'}-${i}`}>
            {renderCreateRow(depth)}
          </React.Fragment>
        );
      } else {
        result.push(renderInsertZone(parentId, parentDepth, i, depth));
      }

      if (i < nodes.length) {
        result.push(renderNode(nodes[i], depth));
      }
    }

    return result;
  };

  // --- Render ---

  const renderNode = (node: PageTreeNode, depth: number = 0) => {
    const isActive = node.id === `${area}/${currentSlug}`;
    const hasChildren = node.children && node.children.length > 0;
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
              onClick={(e) => {
                if (isActive) e.preventDefault();
              }}
            >
              {node.title || node.slug}
            </a>
          )}
          {hasChildren && (
            <span className="ned-tree-count">{node.children.length}</span>
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
              <button
                className="ned-tree-context-item"
                onClick={() => {
                  setContextNode(null);
                  startCreate(node.id, node.depth, node.children?.length ?? 0);
                }}
              >
                + Add child
              </button>
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
          <div>{renderNodeList(node.children, depth + 1, node.id, depth)}</div>
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
