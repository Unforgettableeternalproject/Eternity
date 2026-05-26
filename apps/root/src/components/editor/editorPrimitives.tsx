import React from 'react';

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
}: {
  tags: string[];
  onChange: (t: string[]) => void;
}) {
  return (
    <div className="qe-tags">
      {tags.map((t, i) => (
        <span key={i} className="qe-tag">
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
          const t = window.prompt('新增 tag：');
          if (t?.trim()) onChange([...tags, t.trim()]);
        }}
      >
        + tag
      </button>
    </div>
  );
}

export function OutlineRow({
  active,
  num,
  label,
  sub,
  onClick,
}: {
  active: boolean;
  num: string;
  label: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <div
      className={`qe-row${active ? ' qe-row--active' : ''}`}
      onClick={onClick}
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
