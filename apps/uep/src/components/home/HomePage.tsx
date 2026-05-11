import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ZONES, VERSES, RECENTS, zoneTextColor } from '../../data/zones';
import type { ZoneData } from '../../data/zones';
import TopBar from '../ui/TopBar';
import UepAvatar from '../ui/UepAvatar';
import UepDialogue from '../ui/UepDialogue';
import PieMap3D from '../map/PieMap3D';
import Minimap from '../ui/Minimap';
import BigMapModal from '../ui/BigMapModal';
import IntroOverlay from '../ui/IntroOverlay';
import PortalTransition from '../ui/PortalTransition';
import { useIsMobile } from '../../utils/useIsMobile';

const homePageCss = `
  .home-hero {
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: 56px;
    padding: 90px 64px;
    min-height: 540px;
    align-items: center;
    position: relative;
    max-width: 1400px;
    margin: 0 auto;
  }
  .home-hero-h1 { font-size: 76px; }
  .home-atlas { padding: 72px 64px 100px; }
  .home-legend-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0;
    max-width: 920px;
    margin: 40px auto 0;
    border-top: 1px solid var(--hairline);
  }
  .home-verse { padding: 90px 64px 110px; }
  .home-recents { padding: 60px 64px 90px; }
  .home-recents-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }

  @media (max-width: 760px) {
    .home-hero {
      grid-template-columns: 1fr;
      padding: 40px 20px 48px;
      gap: 32px;
      min-height: unset;
    }
    .home-hero-right { display: none; }
    .home-hero-h1 { font-size: 44px !important; }
    .home-atlas { padding: 40px 20px 56px; }
    .home-legend-grid { grid-template-columns: repeat(2, 1fr); }
    .home-verse { padding: 48px 20px 56px; }
    .home-recents { padding: 32px 20px 56px; }
    .home-recents-grid { grid-template-columns: 1fr; }
  }

  @keyframes zone-arrival {
    0%   { backdrop-filter: blur(18px); background: rgba(10,10,14,0.5); }
    60%  { backdrop-filter: blur(4px);  background: rgba(10,10,14,0.12); }
    100% { backdrop-filter: blur(0px);  background: transparent; }
  }
`;

export default function HomePage({ isDev = false }: { isDev?: boolean }) {
  const isMobile = useIsMobile();
  const [hover, setHover] = useState<string | null>(null);
  const [intro, setIntro] = useState<ZoneData | null>(null);
  const [portal, setPortal] = useState<ZoneData | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [ready, setReady] = useState(false);
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'dark';

  // 進場淡入：mount 後一小段延遲啟動 zone-arrival 動畫
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(t);
  }, []);

  // 檢查是否已登入（透過前端可讀的指示 cookie）
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useEffect(() => {
    setIsLoggedIn(document.cookie.includes('uep-admin-active=1'));
  }, []);

  // 隱藏入口：四角字符點擊序列
  // 境(1) 際(2) / 觀(3) 測(4) — 密碼 2214134
  const GLYPH_SEQ = [2, 2, 1, 4, 1, 3, 4];
  const [glyphInput, setGlyphInput] = useState<number[]>([]);
  const [hoveredGlyph, setHoveredGlyph] = useState<number | null>(null);
  const glyphTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleGlyphClick = useCallback((index: number) => {
    const pos = index + 1; // 轉換成 1-based

    setGlyphInput((prev) => {
      const next = [...prev, pos];

      // 檢查是否符合目標前綴
      const matches = next.every((v, i) => v === GLYPH_SEQ[i]);
      if (!matches) {
        // 不符合 — 如果當前點擊是序列開頭，從頭開始
        return pos === GLYPH_SEQ[0] ? [pos] : [];
      }

      // 序列完成
      if (next.length === GLYPH_SEQ.length) {
        setTimeout(() => {
          window.location.href = '/admin/login';
        }, 0);
        return [];
      }

      return next;
    });

    // 5 秒無動作重置
    if (glyphTimer.current) clearTimeout(glyphTimer.current);
    glyphTimer.current = setTimeout(() => setGlyphInput([]), 5000);
  }, []);

  const handleEnterZone = useCallback(() => {
    if (!intro) return;
    setPortal(intro);
    setIntro(null);
    setTimeout(() => {
      window.location.href = `/${intro.slug}`;
    }, 1100);
  }, [intro]);

  const handlePortalDone = useCallback(() => {
    setPortal(null);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        overflow: 'hidden',
      }}
    >
      <style>{homePageCss}</style>

      {/* 進場霧化淡入 */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          pointerEvents: 'none',
          ...(ready
            ? { animation: 'zone-arrival 0.8s var(--ease-out) forwards' }
            : { backdropFilter: 'blur(18px)', background: 'rgba(10,10,14,0.5)' }),
        }}
      />

      <TopBar onOpenMap={() => setShowMap(true)} />

      <div
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        {/* ── HERO ── */}
        <section className="home-hero">
          {/* dust particles */}
          <div
            className="dust-field"
            style={{ color: 'var(--uep-gold)', opacity: 0.4 }}
          >
            {[...Array(18)].map((_, i) => (
              <i
                key={i}
                style={
                  {
                    left: `${(i * 47) % 100}%`,
                    top: `${(i * 29) % 100}%`,
                    animationDuration: `${14 + (i % 6)}s`,
                    animationDelay: `${(i * 0.4) % 8}s`,
                    '--drift-y': '-30px',
                    '--drift-opacity': '0.4',
                  } as React.CSSProperties
                }
              />
            ))}
          </div>

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--uep-gold)',
                letterSpacing: '0.32em',
                textTransform: 'uppercase' as const,
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span
                style={{ width: 32, height: 1, background: 'var(--uep-gold)' }}
              />
              U.E.P · Imaginary Space
            </div>

            <h1
              className="home-hero-h1"
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 500,
                lineHeight: 1.0,
                color: 'var(--ink-title)',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              世界的
              <span style={{ fontStyle: 'italic', fontWeight: 400 }}>邊際</span>
              <br />
              <span
                style={{
                  fontSize: 36,
                  fontWeight: 400,
                  fontStyle: 'italic',
                  color: 'var(--uep-gold)',
                  letterSpacing: '0.04em',
                  display: 'inline-block',
                  marginTop: 12,
                }}
              >
                edge · world · observed
              </span>
            </h1>

            <p
              style={{
                fontFamily: 'var(--font-serif-tc)',
                fontSize: 16,
                lineHeight: 2,
                color: 'var(--ink-soft)',
                maxWidth: 440,
                marginTop: 28,
                fontWeight: 400,
              }}
            >
              你掉到了一個空白的空間，
              <br />
              周圍甚麼都沒有 ——
              <br />
              一名有著金色頭髮的少女從虛無當中顯現。
            </p>

            <div style={{ marginTop: 28, maxWidth: 460 }}>
              <UepDialogue
                side="left"
                effects={['shimmer', 'halo']}
                text="你好啊! ╰(*°▽°*)╯ 我的名字叫U.E.P，跟我來，我來跟你介紹一下這裡!"
              />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                className="btn-outline btn-outline--gold"
                onClick={() => setShowMap(true)}
              >
                ✦ 開啟大地圖
              </button>
              <a
                href="#atlas"
                className="btn-outline"
                style={{ textDecoration: 'none' }}
              >
                ↓ 沿著卷軸走
              </a>
              {(isDev || isLoggedIn) && (
                <a
                  href="/admin"
                  className="btn-outline"
                  style={{ textDecoration: 'none', opacity: 0.7 }}
                >
                  ⚙ 後台管理
                </a>
              )}
            </div>
          </div>

          {/* portrait with outline rings */}
          <div
            className="home-hero-right"
            style={{
              position: 'relative',
              display: 'grid',
              placeItems: 'center',
              minHeight: 460,
            }}
          >
            <div
              style={{
                position: 'absolute',
                width: 380,
                height: 380,
                borderRadius: '50%',
                border: '1px solid var(--uep-gold)',
                opacity: 0.35,
              }}
            />
            <div
              style={{
                position: 'absolute',
                width: 420,
                height: 420,
                borderRadius: '50%',
                border: '1px dashed var(--uep-gold)',
                opacity: 0.18,
                animation: 'slow-rotate 90s linear infinite',
              }}
            />
            <div
              style={{
                position: 'absolute',
                width: '100%',
                height: 1,
                background:
                  'linear-gradient(90deg, transparent, var(--hairline), transparent)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                width: 1,
                height: '100%',
                background:
                  'linear-gradient(180deg, transparent, var(--hairline), transparent)',
              }}
            />

            <img
              src="/uep/Big UEP.png"
              alt="U.E.P"
              style={{
                width: 340,
                height: 'auto',
                position: 'relative',
                zIndex: 1,
                filter: 'drop-shadow(0 0 32px rgba(213,182,24,0.2))',
              }}
              draggable={false}
            />

            {['境', '際', '觀', '測'].map((g, i) => (
              <div
                key={i}
                onMouseEnter={() => setHoveredGlyph(i)}
                onMouseLeave={() => setHoveredGlyph(null)}
                onClick={() => handleGlyphClick(i)}
                style={{
                  position: 'absolute',
                  ...[
                    { top: 30, left: 30 },
                    { top: 30, right: 30 },
                    { bottom: 30, left: 30 },
                    { bottom: 30, right: 30 },
                  ][i],
                  fontFamily: 'var(--font-display)',
                  fontSize: 22,
                  color: 'var(--uep-gold)',
                  opacity: hoveredGlyph === i ? 0.85 : 0.45,
                  transition: 'opacity 0.3s ease',
                  cursor: 'default',
                  userSelect: 'none' as const,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {g}
              </div>
            ))}
          </div>
        </section>

        <hr className="hairline" />

        {/* ── ATLAS ── */}
        <section
          id="atlas"
          className="home-atlas"
          style={{
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            className="dust-field"
            style={{ color: 'var(--uep-gold)', opacity: 0.5 }}
          >
            {[...Array(40)].map((_, i) => (
              <i
                key={i}
                style={
                  {
                    left: `${(i * 43) % 100}%`,
                    top: `${(i * 23) % 100}%`,
                    animationDuration: `${12 + (i % 8)}s`,
                    animationDelay: `${(i * 0.3) % 10}s`,
                    '--drift-y': '-50px',
                    '--drift-opacity': '0.5',
                  } as React.CSSProperties
                }
              />
            ))}
          </div>

          <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.32em',
                textTransform: 'uppercase' as const,
                color: 'var(--uep-gold)',
                marginBottom: 14,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span
                style={{ width: 28, height: 1, background: 'var(--uep-gold)' }}
              />
              the atlas
              <span
                style={{ width: 28, height: 1, background: 'var(--uep-gold)' }}
              />
            </div>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 56,
                fontWeight: 500,
                margin: '0 0 8px',
                letterSpacing: '-0.02em',
                color: 'var(--ink-title)',
              }}
            >
              邊際世界
            </h2>
            <div
              style={{
                fontFamily: 'var(--font-serif-tc)',
                fontSize: 13.5,
                color: 'var(--ink-mute)',
                marginBottom: 56,
                fontStyle: 'italic',
              }}
            >
              地圖即導航 · 拖曳旋轉 · 上下傾斜 · 點擊區塊進入
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              position: 'relative',
              minHeight: isMobile ? 340 : 600,
            }}
          >
            <PieMap3D
              zones={ZONES}
              size={isMobile ? 320 : 580}
              hoveredId={hover}
              onHover={setHover}
              baseTone="light"
              onPickIntro={(z) => setIntro(z)}
            />
          </div>

          {/* legend */}
          <div className="home-legend-grid">
            {ZONES.map((z, idx) => (
              <div
                key={z.id}
                onMouseEnter={() => setHover(z.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setIntro(z)}
                style={{
                  padding: '18px 14px',
                  borderRight: idx < 4 ? '1px solid var(--hairline)' : 'none',
                  cursor: 'pointer',
                  background: hover === z.id ? 'var(--bg-soft)' : 'transparent',
                  transition: 'background .25s var(--ease)',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: zoneTextColor(z.main, isDark),
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase' as const,
                  }}
                >
                  {String(idx + 1).padStart(2, '0')} · {z.en}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 17,
                    fontWeight: 600,
                    color: 'var(--ink-title)',
                    marginTop: 4,
                  }}
                >
                  {z.label}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-serif-tc)',
                    fontSize: 12,
                    color: 'var(--ink-mute)',
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  {z.atmos}
                </div>
              </div>
            ))}
          </div>
        </section>

        <hr className="hairline-thick" />

        {/* ── ETERNAL VERSE ── */}
        <section className="home-verse" style={{ position: 'relative' }}>
          <div
            style={{ maxWidth: 720, margin: '0 auto', position: 'relative' }}
          >
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.32em',
                  textTransform: 'uppercase' as const,
                  color: 'var(--uep-gold)',
                }}
              >
                · The Eternal Verse ·
              </div>
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 36,
                  fontWeight: 500,
                  color: 'var(--ink-title)',
                  margin: '14px 0 6px',
                  letterSpacing: '-0.01em',
                }}
              >
                永恆的意義
              </h2>
              <div
                style={{
                  width: 1,
                  height: 50,
                  background: 'var(--uep-gold)',
                  margin: '18px auto 36px',
                  opacity: 0.4,
                }}
              />
            </div>

            <div
              style={{
                fontFamily: 'var(--font-serif-tc)',
                fontSize: 18,
                lineHeight: 2.4,
                color: 'var(--ink)',
                textAlign: 'center',
                position: 'relative',
                padding: '0 30px',
              }}
            >
              {VERSES.map((v, i) =>
                v === '—' ? (
                  <div
                    key={i}
                    style={{
                      width: 32,
                      height: 1,
                      margin: '20px auto',
                      background: 'var(--uep-gold)',
                      opacity: 0.5,
                    }}
                  />
                ) : (
                  <div
                    key={i}
                    style={
                      /輪迴|創世|毀滅|聚合|反饋|置換|虛無/.test(v)
                        ? {
                            fontWeight: 600,
                            color: 'var(--uep-gold)',
                            fontStyle: 'italic',
                          }
                        : undefined
                    }
                  >
                    {v}
                  </div>
                )
              )}
            </div>

            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--ink-mute)',
                textAlign: 'center',
                marginTop: 32,
                letterSpacing: '0.22em',
                textTransform: 'uppercase' as const,
              }}
            >
              —— inscribed on the wall ——
            </div>
          </div>
        </section>

        <hr className="hairline" />

        {/* ── RECENTS ── */}
        <section
          className="home-recents"
          style={{
            maxWidth: 1400,
            margin: '0 auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 26,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--uep-gold)',
                  letterSpacing: '0.24em',
                  textTransform: 'uppercase' as const,
                  marginBottom: 4,
                }}
              >
                · Recent ·
              </div>
              <h3
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 28,
                  fontWeight: 600,
                  color: 'var(--ink-title)',
                  margin: 0,
                }}
              >
                最近的觀測
              </h3>
            </div>
          </div>
          <div className="home-recents-grid">
            {RECENTS.map((r, i) => {
              const z = ZONES.find((z) => z.id === r.zone);
              return (
                <div
                  key={i}
                  style={{
                    padding: '20px 18px',
                    borderRight: i < 4 ? '1px solid var(--hairline)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: zoneTextColor(z?.main ?? '', isDark),
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase' as const,
                    }}
                  >
                    · {z?.en}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-serif-tc)',
                      fontSize: 14,
                      color: 'var(--ink-title)',
                      lineHeight: 1.4,
                      fontWeight: 500,
                    }}
                  >
                    {r.title}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--ink-mute)',
                      marginTop: 'auto',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {r.note}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* minimap */}
      <Minimap
        zones={ZONES}
        currentId={hover}
        onExpand={() => setShowMap(true)}
        onPickZone={(zid) => setIntro(ZONES.find((z) => z.id === zid) || null)}
        position="bottom-right"
      />

      {/* modals */}
      {showMap && (
        <BigMapModal
          zones={ZONES}
          tone="dark"
          onClose={() => setShowMap(false)}
          onPick={(z) => {
            setShowMap(false);
            setIntro(z);
          }}
        />
      )}

      <IntroOverlay
        zone={intro}
        onClose={() => setIntro(null)}
        onEnter={handleEnterZone}
      />
      <PortalTransition zone={portal} onDone={handlePortalDone} />
    </div>
  );
}
