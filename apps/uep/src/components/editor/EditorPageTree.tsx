import React, { useEffect, useState } from 'react';

interface PageTreeNode {
  id: string;
  title: string;
  slug: string;
  pageType: string;
  depth: number;
  metadata: Record<string, unknown>;
  children: PageTreeNode[];
}

interface EditorPageTreeProps {
  area: string;
  apiBase: string;
  currentSlug: string;
  accent: string;
}

const TYPE_LETTERS: Record<string, string> = {
  zone: 'Z',
  chapter: 'C',
  arc: 'A',
  section: 'S',
  page: 'P',
  song: 'S',
};

export default function EditorPageTree({
  area,
  apiBase,
  currentSlug,
  accent,
}: EditorPageTreeProps) {
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${apiBase}/api/content/${area}/tree`)
      .then((res) => {
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          throw new Error('API not available');
        }
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (json.ok) {
          setTree(json.data);
        } else {
          setError(json.error || 'Failed to load tree');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, area]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: PageTreeNode, depth: number = 0) => {
    const isActive = node.id === `${area}/${currentSlug}`;
    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);

    return (
      <div key={node.id}>
        <a
          href={`/admin/edit/${node.id}`}
          className="ned-tree-item"
          style={{
            paddingLeft: `${18 + depth * 14}px`,
            borderLeftColor: isActive ? accent : 'transparent',
            background: isActive ? `${accent}10` : undefined,
            color: isActive ? 'var(--ink-title)' : undefined,
          }}
          onClick={(e) => {
            if (isActive) e.preventDefault();
          }}
        >
          {hasChildren && (
            <button
              className="ned-tree-toggle"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleCollapse(node.id);
              }}
            >
              {isCollapsed ? '+' : '-'}
            </button>
          )}
          <span className="ned-tree-type">
            {TYPE_LETTERS[node.pageType] || 'P'}
          </span>
          <span className="ned-tree-label">{node.title || node.slug}</span>
          {hasChildren && (
            <span className="ned-tree-count">{node.children.length}</span>
          )}
        </a>
        {hasChildren && !isCollapsed && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
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
          title="New page"
        >
          +
        </button>
      </div>
      {loading && (
        <div className="ned-tree-status">Loading...</div>
      )}
      {error && (
        <div className="ned-tree-status ned-tree-error">{error}</div>
      )}
      {!loading && !error && tree.map((node) => renderNode(node, 0))}
    </div>
  );
}
