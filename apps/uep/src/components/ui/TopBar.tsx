import React, { useState, useEffect } from 'react';

interface TopBarProps {
  onOpenMap?: () => void;
  dark?: boolean;
}

export default function TopBar({ onOpenMap, dark }: TopBarProps) {
  const [theme, setTheme] = useState<string>('dark');

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('uep-theme', next);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '18px 36px',
        borderBottom: '1px solid var(--hairline)',
        fontFamily: 'var(--font-sans)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'var(--bg)',
      }}
    >
      <a
        href="/"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: '1px solid var(--uep-gold)',
            color: 'var(--uep-gold)',
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          U
        </div>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--ink-title)',
              lineHeight: 1,
              letterSpacing: '0.01em',
            }}
          >
            Imaginary Space
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9.5,
              color: 'var(--ink-mute)',
              letterSpacing: '0.22em',
              textTransform: 'uppercase' as const,
              marginTop: 2,
            }}
          >
            邊際世界 · 觀測誌
          </div>
        </div>
      </a>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {onOpenMap && (
          <button
            className="btn-outline"
            onClick={onOpenMap}
            style={{ padding: '8px 14px' }}
          >
            ✦ 大地圖
          </button>
        )}
        <span
          style={{
            width: 1,
            height: 16,
            background: 'var(--hairline)',
            margin: '0 4px',
          }}
        />
        <button
          className="btn-outline"
          onClick={toggleTheme}
          style={{ padding: '8px 14px' }}
          title={theme === 'dark' ? '切換至白晝模式' : '切換至夜間模式'}
        >
          {theme === 'dark' ? '☀ 白晝' : '☾ 夜間'}
        </button>
      </div>
    </div>
  );
}
