/**
 * Prism Design System — Atom Components
 * 所有基礎 UI 元素，對應 Eternity-Design/main-styles/prism-shell.jsx
 */
import React from 'react';
import type { CSSProperties, ReactNode } from 'react';

// ===== Accent System =====

export const PRISM_ACCENTS = {
  sky: { base: '#0EA5E9', soft: '#38BDF8', deep: '#0284C7' },
  indigo: { base: '#6366F1', soft: '#818CF8', deep: '#4F46E5' },
  violet: { base: '#8B5CF6', soft: '#A78BFA', deep: '#7C3AED' },
  fuchsia: { base: '#D946EF', soft: '#E879F9', deep: '#C026D3' },
  green: { base: '#467C5B', soft: '#6CA088', deep: '#345E45' },
  coral: { base: '#D6442E', soft: '#E47565', deep: '#A8331E' },
} as const;

export type AccentName = keyof typeof PRISM_ACCENTS;

const ACCENT_CYCLE: AccentName[] = [
  'sky',
  'indigo',
  'violet',
  'fuchsia',
  'green',
];

export function getAccent(index: number): (typeof PRISM_ACCENTS)[AccentName] {
  return PRISM_ACCENTS[ACCENT_CYCLE[index % ACCENT_CYCLE.length]];
}

// ===== PMono — Monospace label =====

interface PMonoProps {
  children: ReactNode;
  style?: CSSProperties;
  color?: string;
  className?: string;
}

export function PMono({ children, style, color, className }: PMonoProps) {
  return (
    <span
      className={className}
      style={{
        fontFamily: 'var(--prism-mono)',
        fontSize: 11,
        letterSpacing: '0.16em',
        textTransform: 'uppercase' as const,
        color: color ?? 'var(--prism-ink-mute)',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ===== PRule — Horizontal rule =====

interface PRuleProps {
  height?: number;
  style?: CSSProperties;
}

export function PRule({ height = 1, style }: PRuleProps) {
  return (
    <div
      style={{
        height,
        width: '100%',
        background: 'var(--prism-line)',
        ...style,
      }}
    />
  );
}

// ===== PDot — Accent dot =====

interface PDotProps {
  size?: number;
  color?: string;
  glow?: boolean;
  pulse?: boolean;
  style?: CSSProperties;
}

export function PDot({
  size = 7,
  color = 'var(--prism-navy)',
  glow,
  pulse,
  style,
}: PDotProps) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        ...(glow
          ? { boxShadow: `0 0 8px ${color}40, 0 0 4px ${color}80` }
          : {}),
        ...(pulse ? { animation: 'p-pulse 2.4s ease-in-out infinite' } : {}),
        ...style,
      }}
    />
  );
}

// ===== PPill — Tag / badge =====

interface PPillProps {
  children: ReactNode;
  accent?: AccentName;
  filled?: boolean;
  style?: CSSProperties;
}

export function PPill({ children, accent, filled, style }: PPillProps) {
  const a = accent ? PRISM_ACCENTS[accent] : null;

  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 999,
    fontFamily: 'var(--prism-mono)',
    fontSize: 10.5,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.6,
  };

  if (filled && a) {
    return (
      <span
        style={{
          ...base,
          background: a.deep,
          color: 'var(--prism-paper)',
          border: 'none',
          ...style,
        }}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      style={{
        ...base,
        background: 'transparent',
        color: a?.deep ?? 'var(--prism-ink-soft)',
        border: `1px solid ${a?.deep ?? 'var(--prism-line)'}`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ===== PLive — Online indicator =====

interface PLiveProps {
  label?: string;
  color?: string;
}

export function PLive({ label = 'online', color = '#467C5B' }: PLiveProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          position: 'relative',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: '50%',
            border: `1px solid ${color}`,
            opacity: 0.4,
            animation: 'p-ping 2.4s ease-in-out infinite',
          }}
        />
      </span>
      <PMono color={color}>{label}</PMono>
    </span>
  );
}

// ===== PStat — Statistic number + label =====

interface PStatProps {
  value: string | number;
  label: string;
  accent?: boolean;
  style?: CSSProperties;
}

export function PStat({ value, label, accent, style }: PStatProps) {
  return (
    <div style={style}>
      <div
        style={{
          fontFamily: 'var(--prism-mono)',
          fontSize: 24,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: accent ? 'var(--prism-navy)' : 'var(--prism-ink)',
        }}
      >
        {value}
      </div>
      <PMono style={{ marginTop: 6, display: 'block' }}>{label}</PMono>
    </div>
  );
}

// ===== PCard — Hairline bordered card =====

interface PCardProps {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  as?: 'div' | 'a';
  href?: string;
}

export function PCard({
  children,
  style,
  className,
  as: Tag = 'div',
  href,
}: PCardProps) {
  const props: Record<string, unknown> = {
    className,
    style: {
      background: 'var(--prism-surface)',
      border: '1px solid var(--prism-line)',
      borderRadius: 'var(--prism-radius, 14px)',
      ...style,
    },
  };
  if (Tag === 'a' && href) props.href = href;
  return <Tag {...(props as any)}>{children}</Tag>;
}

// ===== PPlate — Image placeholder with hatch =====

interface PPlateProps {
  ratio?: string;
  label?: string;
  sub?: string;
  accent?: AccentName;
  style?: CSSProperties;
  children?: ReactNode;
}

export function PPlate({
  ratio = '16/9',
  label,
  sub,
  accent = 'indigo',
  style,
  children,
}: PPlateProps) {
  const a = PRISM_ACCENTS[accent];
  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: ratio,
        width: '100%',
        background: 'var(--prism-paper-soft)',
        border: '1px solid var(--prism-line)',
        borderRadius: 'var(--prism-radius, 14px)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Hatch texture */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(135deg, transparent 49.5%, var(--prism-line-soft) 49.5%, var(--prism-line-soft) 50.5%, transparent 50.5%)`,
          backgroundSize: '22px 22px',
          opacity: 0.7,
        }}
      />
      {/* Top-left dot */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: a.base,
        }}
      />
      {/* Bottom-left label */}
      {(label || sub) && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            padding: 18,
            zIndex: 1,
          }}
        >
          {sub && <PMono>{sub}</PMono>}
          {label && (
            <div
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: 'var(--prism-ink)',
                marginTop: sub ? 4 : 0,
              }}
            >
              {label}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

// ===== PGlow — Radial blur glow =====

interface PGlowProps {
  size?: number;
  opacity?: number;
  style?: CSSProperties;
}

export function PGlow({ size = 600, opacity = 0.7, style }: PGlowProps) {
  return (
    <div
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, var(--prism-glow-color) 0%, transparent 65%)`,
        filter: 'blur(70px)',
        opacity: `calc(${opacity} * var(--prism-glow, 1))`,
        pointerEvents: 'none',
        zIndex: 0,
        ...style,
      }}
    />
  );
}

// ===== PGradText — Gradient text =====

type GradPreset = 'sky-indigo-violet' | 'indigo-violet-fuchsia' | 'sky-indigo';

const GRAD_MAP: Record<GradPreset, string> = {
  'sky-indigo-violet': 'linear-gradient(100deg, #0EA5E9, #6366F1, #8B5CF6)',
  'indigo-violet-fuchsia': 'linear-gradient(100deg, #6366F1, #8B5CF6, #D946EF)',
  'sky-indigo': 'linear-gradient(100deg, #0EA5E9, #6366F1)',
};

interface PGradTextProps {
  children: ReactNode;
  preset?: GradPreset;
  style?: CSSProperties;
  as?: 'span' | 'h1' | 'h2' | 'div';
}

export function PGradText({
  children,
  preset = 'sky-indigo-violet',
  style,
  as: Tag = 'span',
}: PGradTextProps) {
  return (
    <Tag
      style={{
        background: GRAD_MAP[preset],
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        fontWeight: 700,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

// ===== PSection — Section header with number =====

interface PSectionProps {
  num: string;
  en: string;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}

export function PSection({ num, en, title, meta, action }: PSectionProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 24,
        paddingBottom: 12,
        marginBottom: 24,
        borderBottom: '1px solid var(--prism-line)',
        alignItems: 'end',
      }}
    >
      <div>
        <PMono color="var(--prism-navy)">
          —— {num} / {en}
        </PMono>
        <h2
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--prism-ink)',
            letterSpacing: '-0.018em',
            lineHeight: 1.1,
            marginTop: 6,
            fontFamily: 'var(--prism-font)',
          }}
        >
          {title}
        </h2>
      </div>
      {(meta || action) && (
        <div style={{ textAlign: 'right' }}>
          {meta}
          {action}
        </div>
      )}
    </div>
  );
}
