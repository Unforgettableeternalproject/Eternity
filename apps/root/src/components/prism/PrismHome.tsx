/**
 * PrismHome — Welcome page (not a dashboard)
 * 歡迎頁面，提供清楚的導航路徑，不重複其他頁面的內容
 */
import React from 'react';
import {
  PMono,
  PRule,
  PDot,
  PPill,
  PLive,
  PCard,
  PGlow,
  PGradText,
  getAccent,
  type AccentName,
} from './atoms';

interface PrismHomeProps {
  locale: 'zh-tw' | 'en';
}

// ===== Navigation destinations =====

interface Destination {
  key: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  href: string;
  accent: AccentName;
  external?: boolean;
  mono: string;
}

const DESTINATIONS: Destination[] = [
  {
    key: 'projects',
    titleZh: '作品集',
    titleEn: 'Projects',
    descZh: '我做過的專案與創作，從全端平台到小遊戲都有。',
    descEn: "Things I've built — from full-stack platforms to small games.",
    href: '/projects',
    accent: 'sky',
    mono: '01',
  },
  {
    key: 'about',
    titleZh: '關於我',
    titleEn: 'About',
    descZh: '開發者、音樂人、寫作者——以及背後的故事。',
    descEn: 'Developer, musician, writer — and the story behind it all.',
    href: '/about',
    accent: 'indigo',
    mono: '02',
  },
  {
    key: 'links',
    titleZh: '連結',
    titleEn: 'Links',
    descZh: '我的各個平台帳號與聯絡方式。',
    descEn: 'My profiles across platforms and ways to reach me.',
    href: '/links',
    accent: 'violet',
    mono: '03',
  },
  {
    key: 'updates',
    titleZh: '動態',
    titleEn: 'Updates',
    descZh: '最新的進展與公告。',
    descEn: 'Latest progress and announcements.',
    href: '/updates',
    accent: 'fuchsia',
    mono: '04',
  },
  {
    key: 'contact',
    titleZh: '聯繫',
    titleEn: 'Contact',
    descZh: '有任何想法或建議，歡迎跟我說。',
    descEn: 'Got ideas or suggestions? Let me know.',
    href: '/contact',
    accent: 'green',
    mono: '05',
  },
  {
    key: 'imaginary-space',
    titleZh: 'Imaginary Space',
    titleEn: 'Imaginary Space',
    descZh: '我的世界觀文件站——故事、音樂、設定、創作的集合體。',
    descEn: 'My worldbuilding docs — stories, music, lore, and creations.',
    href: 'https://uep.unforgettableeternalproject.com',
    accent: 'sky',
    external: true,
    mono: '↗',
  },
];

// ===== Destination card =====

function DestCard({
  dest,
  locale,
}: {
  dest: Destination;
  locale: 'zh-tw' | 'en';
}) {
  const isEn = locale === 'en';
  const accent = getAccent(DESTINATIONS.indexOf(dest));
  const prefix = isEn ? '/en' : '';
  const href = dest.external ? dest.href : `${prefix}${dest.href}`;

  return (
    <a
      href={href}
      {...(dest.external
        ? { target: '_blank', rel: 'noopener noreferrer' }
        : {})}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <PCard
        style={{
          padding: '20px 24px',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          transition: 'border-color 0.2s',
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PDot size={9} color={accent.base} glow />
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--prism-ink)',
                fontFamily: 'var(--prism-font)',
              }}
            >
              {isEn ? dest.titleEn : dest.titleZh}
            </span>
          </div>
          <PMono color={accent.deep}>{dest.mono}</PMono>
        </div>
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--prism-ink-mute)',
            margin: 0,
            fontFamily: 'var(--prism-font)',
          }}
        >
          {isEn ? dest.descEn : dest.descZh}
        </p>
      </PCard>
    </a>
  );
}

// ===== Main =====

export default function PrismHome({ locale }: PrismHomeProps) {
  const isEn = locale === 'en';

  // Split: regular destinations + Imaginary Space (special)
  const regularDests = DESTINATIONS.filter((d) => !d.external);
  const portalDest = DESTINATIONS.find((d) => d.external);

  return (
    <div
      style={{
        fontFamily: 'var(--prism-font)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        paddingTop: 24,
        paddingBottom: 48,
      }}
    >
      {/* ===== Hero ===== */}
      <section
        style={{
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--prism-surface)',
          border: '1px solid var(--prism-line)',
          borderRadius: 'var(--prism-radius, 14px)',
          padding: '56px 40px 48px',
          textAlign: 'center',
        }}
      >
        <PGlow
          size={400}
          opacity={0.45}
          style={{ top: '-30%', left: '50%', transform: 'translateX(-50%)' }}
        />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <PMono
            color="var(--prism-navy)"
            style={{ display: 'block', marginBottom: 16 }}
          >
            —— personal site · 2026
          </PMono>

          <h1
            style={{
              fontSize: isEn ? 44 : 48,
              lineHeight: 1.1,
              fontWeight: 700,
              letterSpacing: '-0.025em',
              color: 'var(--prism-ink)',
              fontFamily: 'var(--prism-font)',
              margin: '0 0 12px',
            }}
          >
            {isEn ? (
              <>
                Welcome to <PGradText>Eternity</PGradText>
              </>
            ) : (
              <>
                歡迎來到 <PGradText>Eternity</PGradText>
              </>
            )}
          </h1>

          <p
            style={{
              fontSize: 15,
              lineHeight: 1.65,
              color: 'var(--prism-ink-soft)',
              margin: '0 auto',
              maxWidth: 480,
            }}
          >
            {isEn ? (
              <>
                I'm <b style={{ color: 'var(--prism-ink)' }}>Bernie Yen</b> —
                developer, music creator, storyteller. This is where everything
                begins.
              </>
            ) : (
              <>
                我是<b style={{ color: 'var(--prism-ink)' }}>顏榕嶙</b>
                ——開發者、音樂創作者、說故事的人。這裡是一切的起點。
              </>
            )}
          </p>

          <div
            style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}
          >
            <PLive />
          </div>
        </div>
      </section>

      {/* ===== Navigation Grid ===== */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        {regularDests.map((dest) => (
          <DestCard key={dest.key} dest={dest} locale={locale} />
        ))}
      </div>

      {/* ===== Imaginary Space Portal ===== */}
      {portalDest && (
        <a
          href={portalDest.href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
        >
          <section
            style={{
              position: 'relative',
              overflow: 'hidden',
              background: 'var(--prism-surface)',
              border: '1px solid var(--prism-line)',
              borderRadius: 'var(--prism-radius, 14px)',
              padding: '24px 32px',
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 24,
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.2s',
            }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 6,
                }}
              >
                <PDot size={9} color="#0EA5E9" glow />
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: 'var(--prism-ink)',
                    fontFamily: 'var(--prism-font)',
                  }}
                >
                  {isEn ? portalDest.titleEn : portalDest.titleZh}
                </span>
                <PPill accent="sky">world docs</PPill>
              </div>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'var(--prism-ink-mute)',
                  margin: 0,
                  fontFamily: 'var(--prism-font)',
                }}
              >
                {isEn ? portalDest.descEn : portalDest.descZh}
              </p>
            </div>
            <span
              style={{
                fontSize: 20,
                color: 'var(--prism-navy)',
                fontWeight: 500,
              }}
            >
              ↗
            </span>
          </section>
        </a>
      )}

      {/* ===== Closing verse ===== */}
      <section
        style={{
          textAlign: 'center',
          padding: '32px 40px',
        }}
      >
        <PRule style={{ marginBottom: 24 }} />
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.7,
            color: 'var(--prism-ink-mute)',
            fontStyle: 'italic',
            maxWidth: 400,
            margin: '0 auto',
            fontFamily: 'var(--prism-font)',
          }}
        >
          {isEn
            ? '"There is an unfinished story that lives within me."'
            : '「對我而言，有一個尚未完成的故事存在著。」'}
        </p>
        <PMono style={{ display: 'block', marginTop: 12 }}>—— bernie yen</PMono>
      </section>
    </div>
  );
}
