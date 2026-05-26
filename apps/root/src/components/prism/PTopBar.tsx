/**
 * Prism TopBar — Sticky navigation bar
 * blur backdrop, grid layout, nav links with active underline
 */
import React from 'react';
import { PMono } from './atoms';

interface NavItem {
  label: string;
  href: string;
  key: string;
}

interface PTopBarProps {
  currentPath: string;
  locale: 'zh-tw' | 'en';
}

const NAV_ZH: NavItem[] = [
  { label: '首頁', href: '/', key: 'home' },
  { label: '作品', href: '/projects', key: 'projects' },
  { label: '關於', href: '/about', key: 'about' },
  { label: '連結', href: '/links', key: 'links' },
  { label: '動態', href: '/updates', key: 'updates' },
  { label: '聯繫', href: '/contact', key: 'contact' },
];

const NAV_EN: NavItem[] = [
  { label: 'Home', href: '/en', key: 'home' },
  { label: 'Projects', href: '/en/projects', key: 'projects' },
  { label: 'About', href: '/en/about', key: 'about' },
  { label: 'Links', href: '/en/links', key: 'links' },
  { label: 'Updates', href: '/en/updates', key: 'updates' },
  { label: 'Contact', href: '/en/contact', key: 'contact' },
];

function isActive(href: string, currentPath: string): boolean {
  const clean = currentPath.replace(/\/$/, '') || '/';
  if (href === '/' || href === '/en') return clean === href;
  return clean.startsWith(href);
}

export default function PTopBar({ currentPath, locale }: PTopBarProps) {
  const nav = locale === 'en' ? NAV_EN : NAV_ZH;
  const altLocaleHref =
    locale === 'en'
      ? currentPath.replace(/^\/en/, '') || '/'
      : `/en${currentPath}`;

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 36,
        padding: '20px 56px',
        borderBottom: '1px solid var(--prism-line)',
        background: 'var(--prism-topbar-bg)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        fontFamily: 'var(--prism-font)',
      }}
    >
      {/* Logo */}
      <a
        href={locale === 'en' ? '/en' : '/'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          textDecoration: 'none',
          color: 'var(--prism-ink)',
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '-0.012em',
            fontFamily: 'var(--prism-font)',
          }}
        >
          Eternity
        </span>
        <span
          style={{
            fontFamily: 'var(--prism-mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            color: 'var(--prism-ink-mute)',
            textTransform: 'uppercase',
          }}
        >
          · BERNIE
        </span>
      </a>

      {/* Nav */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          justifyContent: 'center',
        }}
      >
        {nav.map((item) => {
          const active = isActive(item.href, currentPath);
          return (
            <a
              key={item.key}
              href={item.href}
              style={{
                position: 'relative',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--prism-ink)' : 'var(--prism-ink-soft)',
                fontFamily: 'var(--prism-font)',
                transition: 'color 0.15s',
              }}
            >
              {item.label}
              {active && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: -20,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: 'var(--prism-ink)',
                  }}
                />
              )}
            </a>
          );
        })}
      </nav>

      {/* Right side: locale switch + theme toggle + search hint */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* Locale switch */}
        <a
          href={altLocaleHref}
          style={{
            fontFamily: 'var(--prism-mono)',
            fontSize: 10.5,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--prism-ink-mute)',
            textDecoration: 'none',
            padding: '4px 8px',
            border: '1px solid var(--prism-line)',
            borderRadius: 6,
          }}
        >
          {locale === 'en' ? '中文' : 'EN'}
        </a>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={() => {
            const html = document.documentElement;
            const isDark = html.classList.contains('dark');
            html.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'light' : 'dark');
          }}
          style={{
            background: 'none',
            border: '1px solid var(--prism-line)',
            borderRadius: 6,
            padding: '4px 8px',
            cursor: 'pointer',
            fontFamily: 'var(--prism-mono)',
            fontSize: 12,
            color: 'var(--prism-ink-mute)',
          }}
        >
          ◐
        </button>

        {/* Search hint */}
        <span
          style={{
            fontFamily: 'var(--prism-mono)',
            fontSize: 10.5,
            color: 'var(--prism-ink-mute)',
            padding: '6px 12px',
            border: '1px solid var(--prism-line)',
            borderRadius: 6,
            letterSpacing: '0.06em',
          }}
        >
          ⌘K
        </span>
      </div>
    </header>
  );
}
