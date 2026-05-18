import React, { useCallback, useEffect, useRef, useState } from 'react';

// ── 型別 ─────────────────────────────────────────────────────────
export type ItemType = 'zone' | 'ui' | 'service' | 'content' | 'misc';
export type ItemState = 'ok' | 'wip' | 'risk' | 'sealed';

export interface LogItem {
  id: string;
  type: ItemType;
  subject: string;
  text: string;
  state: ItemState;
}

export interface ChangelogMeta {
  version: string;
  date: string;
  author: string;
}

interface ChangelogEditorBodyProps {
  accent: string;
  initialContentBlocks: { id: string; type: string; content: string }[];
  onContentChange: (
    blocks: { id: string; type: string; content: string }[]
  ) => void;
  onDirty: () => void;
  meta: ChangelogMeta;
  onMetaChange: (meta: ChangelogMeta) => void;
}

// ── 常數 ─────────────────────────────────────────────────────────
export const LOG_ITEM_TYPES: {
  id: ItemType;
  label: string;
  color: string;
  shortLabel: string;
}[] = [
  { id: 'zone', label: '區域', color: '#3A3A3A', shortLabel: 'ZN' },
  { id: 'ui', label: 'UI / UX', color: '#5E548E', shortLabel: 'UI' },
  { id: 'service', label: '系統 / 服務', color: '#355C7D', shortLabel: 'SVC' },
  { id: 'content', label: '內容 / 文本', color: '#6B3F2A', shortLabel: 'CN' },
  { id: 'misc', label: '雜項', color: '#888', shortLabel: 'MS' },
];

export const LOG_ITEM_STATES: {
  id: ItemState;
  label: string;
  color: string;
}[] = [
  { id: 'ok', label: 'OK', color: '#D5B618' },
  { id: 'wip', label: 'WIP', color: '#c39c2d' },
  { id: 'risk', label: 'RISK', color: '#a85a2d' },
  { id: 'sealed', label: 'SEALED', color: '#888' },
];

let _itemIdCounter = 0;
function nextItemId() {
  return `li-${Date.now()}-${++_itemIdCounter}`;
}

// ── JSON 解析 / 序列化 ──────────────────────────────────────────
export function parseLogItems(
  blocks: { id: string; type: string; content: string }[]
): LogItem[] {
  const block = blocks.find((b) => b.type === 'log_items');
  if (!block) return [];
  try {
    const arr =
      typeof block.content === 'string'
        ? JSON.parse(block.content)
        : block.content;
    if (!Array.isArray(arr)) return [];
    return arr.map((item: any) => ({
      id: item.id || nextItemId(),
      type: item.type || 'misc',
      subject: item.subject || '',
      text: item.text || '',
      state: item.state || 'ok',
    }));
  } catch {
    return [];
  }
}

export function serializeLogItems(
  items: LogItem[]
): { id: string; type: string; content: string }[] {
  return [
    {
      id: 'items',
      type: 'log_items',
      content: JSON.stringify(
        items.map((it) => ({
          id: it.id,
          type: it.type,
          subject: it.subject,
          text: it.text,
          state: it.state,
        }))
      ),
    },
  ];
}

// ── 主元件 ────────────────────────────────────────────────────────
export default function ChangelogEditorBody({
  accent,
  initialContentBlocks,
  onContentChange,
  onDirty,
  meta,
  onMetaChange,
}: ChangelogEditorBodyProps) {
  const [items, setItems] = useState<LogItem[]>(() =>
    parseLogItems(initialContentBlocks)
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<ItemType | 'all'>('all');
  const serializedRef = useRef(JSON.stringify(initialContentBlocks));

  const sync = useCallback(
    (newItems: LogItem[]) => {
      setItems(newItems);
      const blocks = serializeLogItems(newItems);
      const json = JSON.stringify(blocks);
      if (json !== serializedRef.current) {
        serializedRef.current = json;
        onContentChange(blocks);
        onDirty();
      }
    },
    [onContentChange, onDirty]
  );

  function updateItem(index: number, updates: Partial<LogItem>) {
    const newItems = items.map((it, i) =>
      i === index ? { ...it, ...updates } : it
    );
    sync(newItems);
  }

  function removeItem(index: number) {
    const newItems = items.filter((_, i) => i !== index);
    sync(newItems);
    if (selectedIndex === index) setSelectedIndex(null);
    else if (selectedIndex !== null && selectedIndex > index)
      setSelectedIndex(selectedIndex - 1);
  }

  function addItem(type: ItemType, afterIndex?: number) {
    const newItem: LogItem = {
      id: nextItemId(),
      type,
      subject: '',
      text: '',
      state: 'ok',
    };
    const newItems = [...items];
    const insertAt =
      afterIndex !== undefined ? afterIndex + 1 : newItems.length;
    newItems.splice(insertAt, 0, newItem);
    sync(newItems);
    setSelectedIndex(insertAt);
  }

  function moveItem(fromIndex: number, direction: 'up' | 'down') {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= items.length) return;
    const newItems = [...items];
    [newItems[fromIndex], newItems[toIndex]] = [
      newItems[toIndex],
      newItems[fromIndex],
    ];
    sync(newItems);
    setSelectedIndex(toIndex);
  }

  // 鍵盤快速鍵
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (selectedIndex === null) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        addItem(items[selectedIndex]?.type || 'misc', selectedIndex);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
        e.preventDefault();
        moveItem(selectedIndex, 'up');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
        e.preventDefault();
        moveItem(selectedIndex, 'down');
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, items]);

  // 統計
  const typeCounts: Record<string, number> = {};
  for (const it of items) {
    typeCounts[it.type] = (typeCounts[it.type] || 0) + 1;
  }

  const visibleItems =
    filterType === 'all'
      ? items.map((it, i) => ({ item: it, originalIndex: i }))
      : items
          .map((it, i) => ({ item: it, originalIndex: i }))
          .filter(({ item }) => item.type === filterType);

  return (
    <div className="sto-cl-editor">
      {/* 統計列 */}
      <div className="sto-cl-stats">
        <span>changelog mode</span>
        <span>
          {items.length} items ·{' '}
          {LOG_ITEM_STATES.map((s) => {
            const count = items.filter((it) => it.state === s.id).length;
            return count > 0 ? `${s.label.toLowerCase()}:${count}` : null;
          })
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      {/* Metadata 面板 */}
      <div className="sto-cl-meta-grid">
        <div className="sto-cl-meta-cell">
          <label className="sto-cl-meta-label">version</label>
          <input
            className="sto-cl-meta-input"
            type="text"
            value={meta.version}
            onChange={(e) => {
              onMetaChange({ ...meta, version: e.target.value });
              onDirty();
            }}
            placeholder="0.4.??"
          />
        </div>
        <div className="sto-cl-meta-cell">
          <label className="sto-cl-meta-label">date</label>
          <input
            className="sto-cl-meta-input"
            type="text"
            value={meta.date}
            onChange={(e) => {
              onMetaChange({ ...meta, date: e.target.value });
              onDirty();
            }}
            placeholder="?? / ?? / ??"
          />
        </div>
        <div className="sto-cl-meta-cell">
          <label className="sto-cl-meta-label">author</label>
          <input
            className="sto-cl-meta-input"
            type="text"
            value={meta.author}
            onChange={(e) => {
              onMetaChange({ ...meta, author: e.target.value });
              onDirty();
            }}
            placeholder="◼︎◼︎◼︎◼︎◼︎◼︎"
          />
        </div>
      </div>

      {/* 類型標籤庫 */}
      <div className="sto-cl-section-label">
        <span>類型標籤庫</span>
        <span className="sto-cl-hint">點擊新增一條紀錄</span>
      </div>
      <div className="sto-cl-type-palette">
        {LOG_ITEM_TYPES.map((t) => (
          <button
            key={t.id}
            className="sto-cl-type-btn"
            style={{ '--type-color': t.color } as React.CSSProperties}
            onClick={() => addItem(t.id)}
          >
            <span className="sto-cl-type-chip">{t.shortLabel}</span>
            <span>{t.label}</span>
            {typeCounts[t.id] ? (
              <span className="sto-cl-type-count">{typeCounts[t.id]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* 篩選列 */}
      <div className="sto-cl-section-label">
        <span>紀錄列表</span>
        <span className="sto-cl-hint">⌘↩ 新增 · ⌘↑↓ 移動</span>
      </div>
      <div className="sto-cl-filter-bar">
        <button
          className={`sto-cl-filter-chip ${filterType === 'all' ? 'is-active' : ''}`}
          onClick={() => setFilterType('all')}
        >
          全部 ({items.length})
        </button>
        {LOG_ITEM_TYPES.map((t) => {
          const count = typeCounts[t.id] || 0;
          if (count === 0) return null;
          return (
            <button
              key={t.id}
              className={`sto-cl-filter-chip ${filterType === t.id ? 'is-active' : ''}`}
              style={{ '--chip-color': t.color } as React.CSSProperties}
              onClick={() => setFilterType(t.id)}
            >
              <span
                className="sto-cl-filter-chip-dot"
                style={{ background: t.color }}
              />
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      {/* 紀錄列表 */}
      <div className="sto-cl-items-container">
        {visibleItems.map(({ item, originalIndex }) => (
          <LogItemRow
            key={item.id}
            item={item}
            index={originalIndex}
            selected={originalIndex === selectedIndex}
            onSelect={() => setSelectedIndex(originalIndex)}
            onUpdate={(updates) => updateItem(originalIndex, updates)}
            onRemove={() => removeItem(originalIndex)}
            onMove={(dir) => moveItem(originalIndex, dir)}
            totalItems={items.length}
          />
        ))}

        {items.length === 0 && (
          <div className="sto-cl-empty">
            還沒有任何紀錄。點上方的類型標籤開始新增。
          </div>
        )}

        {/* 底部快速新增列 */}
        <div className="sto-cl-quick-add">
          {LOG_ITEM_TYPES.map((t) => (
            <button
              key={t.id}
              className="sto-cl-quick-add-btn"
              style={{ '--type-color': t.color } as React.CSSProperties}
              onClick={() => addItem(t.id)}
            >
              + {t.shortLabel}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 單項元件 ──────────────────────────────────────────────────────
interface LogItemRowProps {
  item: LogItem;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<LogItem>) => void;
  onRemove: () => void;
  onMove: (direction: 'up' | 'down') => void;
  totalItems: number;
}

function LogItemRow({
  item,
  index,
  selected,
  onSelect,
  onUpdate,
  onRemove,
  onMove,
  totalItems,
}: LogItemRowProps) {
  const typeInfo =
    LOG_ITEM_TYPES.find((t) => t.id === item.type) || LOG_ITEM_TYPES[4];
  const stateInfo =
    LOG_ITEM_STATES.find((s) => s.id === item.state) || LOG_ITEM_STATES[0];

  return (
    <div
      className={`sto-cl-item ${selected ? 'is-selected' : ''}`}
      style={{ '--type-color': typeInfo.color } as React.CSSProperties}
      onClick={onSelect}
    >
      {/* 序號 */}
      <span className="sto-cl-item-num">
        {String(index + 1).padStart(2, '0')}
      </span>

      {/* 類型選擇 */}
      <select
        className="sto-cl-item-type"
        value={item.type}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onUpdate({ type: e.target.value as ItemType })}
        style={{ borderColor: typeInfo.color, color: typeInfo.color }}
      >
        {LOG_ITEM_TYPES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.shortLabel} · {t.label}
          </option>
        ))}
      </select>

      {/* 主題 + 內文 */}
      <div className="sto-cl-item-content" onClick={(e) => e.stopPropagation()}>
        <input
          className="sto-cl-item-subject"
          type="text"
          value={item.subject}
          onChange={(e) => onUpdate({ subject: e.target.value })}
          placeholder="主題..."
        />
        <textarea
          className="sto-cl-item-text"
          value={item.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          rows={Math.max(1, Math.ceil((item.text || '').length / 60))}
          placeholder="說明內容..."
        />
      </div>

      {/* 狀態選擇 */}
      <select
        className="sto-cl-item-state"
        value={item.state}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onUpdate({ state: e.target.value as ItemState })}
        style={{ borderColor: stateInfo.color, color: stateInfo.color }}
      >
        {LOG_ITEM_STATES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      {/* 移動按鈕 */}
      {selected && (
        <div
          className="sto-cl-item-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="sto-cl-move-btn"
            onClick={() => onMove('up')}
            disabled={index === 0}
          >
            ▲
          </button>
          <button
            className="sto-cl-move-btn"
            onClick={() => onMove('down')}
            disabled={index === totalItems - 1}
          >
            ▼
          </button>
        </div>
      )}
      {!selected && <div className="sto-cl-spacer" />}

      {/* 刪除 */}
      <button
        className="sto-cl-item-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ×
      </button>
    </div>
  );
}
