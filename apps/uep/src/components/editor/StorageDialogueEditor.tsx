import React, { useCallback, useEffect, useRef, useState } from 'react';

// ── 型別 ─────────────────────────────────────────────────────────
export type DialogueRole = 'narrator' | 'you' | 'uep' | 'sfx' | 'break';
export type UepSide = 'left' | 'right';

export interface DialogueLine {
  id: string;
  role: DialogueRole;
  text: string;
  side?: UepSide;
}

interface StorageDialogueEditorProps {
  accent: string;
  initialContentBlocks: { id: string; type: string; content: string }[];
  onContentChange: (
    blocks: { id: string; type: string; content: string }[]
  ) => void;
  onDirty: () => void;
}

// ── 常數 ─────────────────────────────────────────────────────────
const ROLE_LIBRARY: {
  id: DialogueRole;
  label: string;
  color: string;
  hint: string;
}[] = [
  { id: 'narrator', label: '旁白', color: '#5C5749', hint: '第三人稱描寫' },
  { id: 'you', label: '你', color: '#a85a2d', hint: '第二人稱動作 / 對白' },
  {
    id: 'uep',
    label: 'U.E.P',
    color: '#D5B618',
    hint: '金色對話框，可切換左/右',
  },
  { id: 'sfx', label: '音效', color: '#888', hint: '置中 · ~~ 環繞 ~~' },
  {
    id: 'break',
    label: '場景斷',
    color: '#666',
    hint: '場景切換橫線',
  },
];

let _lineIdCounter = 0;
function nextLineId() {
  return `dl-${Date.now()}-${++_lineIdCounter}`;
}

// ── HTML 解析 / 序列化 ────────────────────────────────────────────
export function parseStructuredHtml(html: string): DialogueLine[] {
  if (!html || !html.trim()) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const lines: DialogueLine[] = [];

  doc.body.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      const text = (node.textContent || '').trim();
      if (text) lines.push({ id: nextLineId(), role: 'narrator', text });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const role = el.getAttribute('data-role') as DialogueRole | null;
    const side = el.getAttribute('data-side') as UepSide | null;
    const text = el.textContent || '';

    if (el.tagName === 'HR' || role === 'break') {
      lines.push({ id: nextLineId(), role: 'break', text: '' });
    } else if (role === 'uep') {
      lines.push({ id: nextLineId(), role: 'uep', text, side: side || 'left' });
    } else if (role === 'you') {
      lines.push({ id: nextLineId(), role: 'you', text });
    } else if (role === 'sfx') {
      lines.push({ id: nextLineId(), role: 'sfx', text });
    } else if (role === 'narrator') {
      lines.push({ id: nextLineId(), role: 'narrator', text });
    } else {
      lines.push({ id: nextLineId(), role: 'narrator', text });
    }
  });

  return lines;
}

export function serializeLinesToHtml(lines: DialogueLine[]): string {
  return lines
    .map((line) => {
      switch (line.role) {
        case 'narrator':
          return `<div data-role="narrator">${escapeHtml(line.text)}</div>`;
        case 'you':
          return `<div data-role="you">${escapeHtml(line.text)}</div>`;
        case 'uep':
          return `<div data-role="uep" data-side="${line.side || 'left'}">${escapeHtml(line.text)}</div>`;
        case 'sfx':
          return `<div data-role="sfx">${escapeHtml(line.text)}</div>`;
        case 'break':
          return `<hr data-role="break" />`;
        default:
          return `<div data-role="narrator">${escapeHtml(line.text)}</div>`;
      }
    })
    .join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── 主元件 ────────────────────────────────────────────────────────
export default function StorageDialogueEditor({
  accent,
  initialContentBlocks,
  onContentChange,
  onDirty,
}: StorageDialogueEditorProps) {
  const rawHtml =
    initialContentBlocks?.[0]?.content ||
    (typeof initialContentBlocks === 'string'
      ? (initialContentBlocks as string)
      : '');

  const [lines, setLines] = useState<DialogueLine[]>(() =>
    parseStructuredHtml(rawHtml)
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const serializedRef = useRef(rawHtml);

  const sync = useCallback(
    (newLines: DialogueLine[]) => {
      setLines(newLines);
      const html = serializeLinesToHtml(newLines);
      if (html !== serializedRef.current) {
        serializedRef.current = html;
        onContentChange([{ id: 'content', type: 'rich_text', content: html }]);
        onDirty();
      }
    },
    [onContentChange, onDirty]
  );

  function updateLine(index: number, updates: Partial<DialogueLine>) {
    const newLines = lines.map((l, i) =>
      i === index ? { ...l, ...updates } : l
    );
    sync(newLines);
  }

  function removeLine(index: number) {
    const newLines = lines.filter((_, i) => i !== index);
    sync(newLines);
    if (selectedIndex === index) setSelectedIndex(null);
    else if (selectedIndex !== null && selectedIndex > index)
      setSelectedIndex(selectedIndex - 1);
  }

  function addLine(role: DialogueRole, afterIndex?: number) {
    const newLine: DialogueLine = {
      id: nextLineId(),
      role,
      text: role === 'break' ? '' : '',
      ...(role === 'uep' ? { side: autoNextSide() } : {}),
    };
    const newLines = [...lines];
    const insertAt =
      afterIndex !== undefined ? afterIndex + 1 : newLines.length;
    newLines.splice(insertAt, 0, newLine);
    sync(newLines);
    setSelectedIndex(insertAt);
  }

  function autoNextSide(): UepSide {
    const uepLines = lines.filter((l) => l.role === 'uep');
    return uepLines.length % 2 === 0 ? 'left' : 'right';
  }

  function moveLine(fromIndex: number, direction: 'up' | 'down') {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= lines.length) return;
    const newLines = [...lines];
    [newLines[fromIndex], newLines[toIndex]] = [
      newLines[toIndex],
      newLines[fromIndex],
    ];
    sync(newLines);
    setSelectedIndex(toIndex);
  }

  // 鍵盤快速鍵
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (selectedIndex === null) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        addLine('narrator', selectedIndex);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
        e.preventDefault();
        moveLine(selectedIndex, 'up');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
        e.preventDefault();
        moveLine(selectedIndex, 'down');
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, lines]);

  const charCount = lines.reduce((s, l) => s + (l.text || '').length, 0);

  return (
    <div className="sto-dialogue-editor" ref={containerRef}>
      {/* 統計列 */}
      <div className="sto-de-stats">
        <span>script mode</span>
        <span>
          {lines.length} lines · {charCount} chars
        </span>
      </div>

      {/* 身分標籤庫 */}
      <div className="sto-de-section-label">
        <span>身分標籤庫</span>
        <span className="sto-de-hint">
          點擊新增一行；或在下方每行的左側切換身分
        </span>
      </div>
      <div className="sto-de-role-palette">
        {ROLE_LIBRARY.map((r) => (
          <button
            key={r.id}
            className="sto-de-role-btn"
            style={
              { '--role-color': r.color } as React.CSSProperties
            }
            onClick={() => addLine(r.id)}
          >
            <span className="sto-de-role-chip">{r.label[0]}</span>
            <span>{r.label}</span>
          </button>
        ))}
      </div>

      {/* 劇本主體 */}
      <div className="sto-de-section-label">
        <span>劇本主體</span>
        <span className="sto-de-hint">
          ⌘↩ 新增下一行 · ⌘↑↓ 移動行
        </span>
      </div>
      <div className="sto-de-lines-container">
        {lines.map((line, i) => (
          <DialogueLineRow
            key={line.id}
            line={line}
            index={i}
            selected={i === selectedIndex}
            onSelect={() => setSelectedIndex(i)}
            onUpdate={(updates) => updateLine(i, updates)}
            onRemove={() => removeLine(i)}
            onMove={(dir) => moveLine(i, dir)}
          />
        ))}

        {lines.length === 0 && (
          <div className="sto-de-empty">
            還沒有任何台詞。點上方的身分標籤開始撰寫。
          </div>
        )}

        {/* 底部快速新增列 */}
        <div className="sto-de-quick-add">
          {ROLE_LIBRARY.map((r) => (
            <button
              key={r.id}
              className="sto-de-quick-add-btn"
              style={{ '--role-color': r.color } as React.CSSProperties}
              onClick={() => addLine(r.id)}
            >
              + {r.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 單行元件 ──────────────────────────────────────────────────────
interface DialogueLineRowProps {
  line: DialogueLine;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<DialogueLine>) => void;
  onRemove: () => void;
  onMove: (direction: 'up' | 'down') => void;
}

function DialogueLineRow({
  line,
  index,
  selected,
  onSelect,
  onUpdate,
  onRemove,
  onMove,
}: DialogueLineRowProps) {
  const role = ROLE_LIBRARY.find((r) => r.id === line.role) || ROLE_LIBRARY[0];

  if (line.role === 'break') {
    return (
      <div
        className={`sto-de-line sto-de-line--break ${selected ? 'is-selected' : ''}`}
        onClick={onSelect}
      >
        <span className="sto-de-line-num">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="sto-de-break-line" />
        <span className="sto-de-break-label">· 場景斷 ·</span>
        <span className="sto-de-break-line" />
        <button className="sto-de-line-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          ×
        </button>
      </div>
    );
  }

  return (
    <div
      className={`sto-de-line ${selected ? 'is-selected' : ''}`}
      style={{ '--role-color': role.color } as React.CSSProperties}
      onClick={onSelect}
    >
      <span className="sto-de-line-num">
        {String(index + 1).padStart(2, '0')}
      </span>

      {/* 角色選擇 */}
      <select
        className="sto-de-line-role"
        value={line.role}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) =>
          onUpdate({
            role: e.target.value as DialogueRole,
            ...(e.target.value === 'uep' && !line.side ? { side: 'left' } : {}),
          })
        }
        style={{ borderColor: role.color, color: role.color }}
      >
        {ROLE_LIBRARY.filter((r) => r.id !== 'break').map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>

      {/* 文字輸入 */}
      <textarea
        className="sto-de-line-text"
        value={line.text}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onUpdate({ text: e.target.value })}
        rows={Math.max(1, Math.ceil((line.text || '').length / 50))}
        placeholder={role.hint}
        style={{
          color: line.role === 'uep' ? '#D5B618' : undefined,
          fontStyle: line.role === 'you' ? 'italic' : undefined,
          fontWeight: line.role === 'uep' ? 600 : undefined,
        }}
      />

      {/* UEP 方向切換 */}
      {line.role === 'uep' && (
        <div className="sto-de-side-toggle" onClick={(e) => e.stopPropagation()}>
          {(['left', 'right'] as UepSide[]).map((s) => (
            <button
              key={s}
              className={`sto-de-side-btn ${line.side === s ? 'is-active' : ''}`}
              onClick={() => onUpdate({ side: s })}
            >
              {s === 'left' ? 'L' : 'R'}
            </button>
          ))}
        </div>
      )}
      {line.role !== 'uep' && <div className="sto-de-side-spacer" />}

      {/* 上下移動 + 刪除 */}
      {selected && (
        <div className="sto-de-line-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="sto-de-move-btn"
            onClick={() => onMove('up')}
            disabled={index === 0}
          >
            ▲
          </button>
          <button
            className="sto-de-move-btn"
            onClick={() => onMove('down')}
          >
            ▼
          </button>
        </div>
      )}
      {!selected && <div className="sto-de-side-spacer" />}

      <button
        className="sto-de-line-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
      >
        ×
      </button>
    </div>
  );
}
