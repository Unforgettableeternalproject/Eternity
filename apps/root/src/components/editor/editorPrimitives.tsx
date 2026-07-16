import React, { useState } from 'react';
import ConfirmDialog, {
  type ConfirmDialogState,
  DIALOG_CLOSED,
} from './ConfirmDialog';

// ─── 共用 primitive 元件（從 RootEditor 提取） ───────────────────────

export function Mono({
  children,
  v,
  style,
}: {
  children: React.ReactNode;
  v?: 'navy' | 'coral' | 'fade';
  style?: React.CSSProperties;
}) {
  return (
    <span className={`qe-mono${v ? ` qe-mono--${v}` : ''}`} style={style}>
      {children}
    </span>
  );
}

export function Divider({ label }: { label?: string }) {
  return (
    <div className="qe-divider">
      {label && <Mono v="navy">{label}</Mono>}
      <div className="qe-divider__line" />
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="qe-field">
      <div className="qe-field__head">
        <Mono>{label}</Mono>
        {hint && <span className="qe-field__hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  mono,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      className={`qe-input${mono ? ' qe-input--mono' : ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: (string | [string, string])[];
}) {
  return (
    <select
      className="qe-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => {
        const [val, lab] = Array.isArray(o) ? o : [o, o];
        return (
          <option key={val} value={val}>
            {lab}
          </option>
        );
      })}
    </select>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="qe-toggle">
      <span className="qe-toggle__label">{label}</span>
      <span
        className={`qe-toggle__track${checked ? ' qe-toggle__track--on' : ''}`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="qe-toggle__thumb" />
      </span>
    </label>
  );
}

export function TagEditor({
  tags,
  onChange,
  onRename,
}: {
  tags: string[];
  onChange: (t: string[]) => void;
  /** 重命名標籤：(舊名, 新名) → 由外層處理全域傳播 */
  onRename?: (oldName: string, newName: string) => void;
}) {
  const [dialog, setDialog] = useState<ConfirmDialogState>(DIALOG_CLOSED);

  return (
    <div className="qe-tags">
      {tags.map((t, i) => (
        <span
          key={i}
          className="qe-tag"
          title={onRename ? '雙擊重命名' : undefined}
          onDoubleClick={() => {
            if (!onRename) return;
            setDialog({
              open: true,
              title: `重命名標籤「${t}」`,
              description: '所有使用此標籤的項目都會同步更新',
              prompt: true,
              promptPlaceholder: '輸入新名稱',
              promptDefault: t,
              confirmLabel: '重命名',
              onPromptConfirm: (v) => {
                const newName = v.trim();
                if (newName && newName !== t) onRename(t, newName);
              },
            });
          }}
        >
          {t}
          <span
            className="qe-tag__x"
            onClick={() => onChange(tags.filter((_, j) => j !== i))}
          >
            ×
          </span>
        </span>
      ))}
      <button
        className="qe-tag--add"
        onClick={() => {
          setDialog({
            open: true,
            title: '新增 tag',
            prompt: true,
            promptPlaceholder: '輸入 tag 名稱',
            confirmLabel: '新增',
            onPromptConfirm: (v) => onChange([...tags, v]),
          });
        }}
      >
        + tag
      </button>
      <ConfirmDialog state={dialog} onClose={() => setDialog(DIALOG_CLOSED)} />
    </div>
  );
}

export function OutlineRow({
  active,
  num,
  label,
  sub,
  onClick,
  draggable,
  dragClass,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  active: boolean;
  num: string;
  label: string;
  sub?: string;
  onClick: () => void;
  draggable?: boolean;
  dragClass?: string;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}) {
  const cls = [
    'qe-row',
    active && 'qe-row--active',
    draggable && 'qe-row--sortable',
    dragClass,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <Mono v={active ? 'navy' : 'fade'}>{num}</Mono>
      <div style={{ minWidth: 0 }}>
        <div className="qe-row__label">{label}</div>
        {sub && <div className="qe-row__sub">{sub}</div>}
      </div>
      <span
        className="qe-row__dot"
        style={{ background: active ? 'var(--qe-navy)' : 'var(--qe-ink-fade)' }}
      />
    </div>
  );
}
