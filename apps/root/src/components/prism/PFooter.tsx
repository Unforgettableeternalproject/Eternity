/**
 * Prism Footer — 4-column grid footer
 */
import React from 'react';
import { PMono, PRule } from './atoms';

interface PFooterProps {
  locale: 'zh-tw' | 'en';
}

export default function PFooter({ locale }: PFooterProps) {
  const isEn = locale === 'en';
  const prefix = isEn ? '/en' : '';

  const navigate = [
    { label: isEn ? 'Home' : '首頁', href: prefix || '/' },
    { label: isEn ? 'Projects' : '作品', href: `${prefix}/projects` },
    { label: isEn ? 'About' : '關於', href: `${prefix}/about` },
    { label: isEn ? 'Contact' : '聯繫', href: `${prefix}/contact` },
  ];

  const worlds = [
    {
      label: isEn ? 'Imaginary Space' : '幻想空間',
      href: 'https://uep.unforgettableeternalproject.com',
    },
    {
      label: isEn ? 'History Archive' : '歷史典藏庫',
      href: 'https://uep.unforgettableeternalproject.com/history',
    },
    {
      label: isEn ? 'Echo Collection' : '回音蒐藏間',
      href: 'https://uep.unforgettableeternalproject.com/echoes',
    },
    {
      label: isEn ? 'Visual Chamber' : '幻影重現室',
      href: 'https://uep.unforgettableeternalproject.com/visuals',
    },
  ];

  const connect = [
    { label: 'GitHub', href: 'https://github.com/Unforgettableeternalproject' },
    { label: 'YouTube', href: 'https://www.youtube.com/@u.e.p_bernie' },
    { label: 'Facebook', href: 'https://www.facebook.com/u.e.p.bernie/' },
    { label: 'Email', href: 'mailto:ptyc4076@gmail.com' },
  ];

  const linkStyle: React.CSSProperties = {
    color: 'var(--prism-ink-soft)',
    textDecoration: 'none',
    fontSize: 14,
    lineHeight: 2.2,
    display: 'block',
    fontFamily: 'var(--prism-font)',
  };

  const colTitleStyle: React.CSSProperties = {
    fontFamily: 'var(--prism-mono)',
    fontSize: 11,
    letterSpacing: '0.16em',
    textTransform: 'uppercase' as const,
    color: 'var(--prism-ink-mute)',
    marginBottom: 16,
  };

  return (
    <footer
      style={{
        padding: '72px 56px 32px',
        background: 'var(--prism-footer-bg)',
        borderTop: '1px solid var(--prism-line)',
        fontFamily: 'var(--prism-font)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 1fr 1fr 1fr',
          gap: 56,
          maxWidth: 1280,
          margin: '0 auto',
        }}
      >
        {/* Brand column */}
        <div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: '-0.018em',
              color: 'var(--prism-ink)',
            }}
          >
            Eternity
          </div>
          <div
            style={{
              color: 'var(--prism-ink-mute)',
              fontSize: 20,
              fontWeight: 500,
              marginTop: 4,
            }}
          >
            Bernie Yen
          </div>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--prism-ink-soft)',
              marginTop: 20,
              maxWidth: 320,
            }}
          >
            {isEn
              ? 'A personal space for creation, development, and storytelling. Where code meets narrative.'
              : '一個屬於創作、開發與故事的個人空間。程式與敘事在此交會。'}
          </p>
        </div>

        {/* Navigate */}
        <div>
          <div style={colTitleStyle}>Navigate</div>
          {navigate.map((l) => (
            <a key={l.href} href={l.href} style={linkStyle}>
              {l.label}
            </a>
          ))}
        </div>

        {/* Worlds */}
        <div>
          <div style={colTitleStyle}>Worlds</div>
          {worlds.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              {l.label}
            </a>
          ))}
        </div>

        {/* Connect */}
        <div>
          <div style={colTitleStyle}>Connect</div>
          {connect.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>

      <PRule style={{ marginTop: 56, marginBottom: 20 }} />

      {/* Copyright */}
      <div style={{ textAlign: 'center' }}>
        <PMono>© 2026 · BERNIE · 顏榕嶙 · v0.9.6</PMono>
      </div>
    </footer>
  );
}
