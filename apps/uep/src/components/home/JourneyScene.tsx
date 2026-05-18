import React, { useRef, useEffect } from 'react';
import type { ZoneData } from '../../data/zones';
import type { JourneyNarrative } from '../../data/journey';
import ZoneAtmosphere from '../ui/ZoneAtmosphere';
import UepDialogue from '../ui/UepDialogue';
import './JourneyScene.css';

interface JourneySceneProps {
  zone: ZoneData;
  narrative: JourneyNarrative;
  index: number;
  total: number;
  onEnterZone: () => void;
  isMobile?: boolean;
}

export default function JourneyScene({
  zone,
  narrative,
  index,
  total,
  onEnterZone,
  isMobile = false,
}: JourneySceneProps) {
  const sectionRef = useRef<HTMLElement>(null);

  // ── 滾動驅動轉場：追蹤 scroll progress 並設定 CSS 變數 ──
  useEffect(() => {
    const section = sectionRef.current;
    const container = section?.closest('.journey-scroll') as HTMLElement | null;
    if (!section || !container) return;

    let raf = 0;

    const update = () => {
      const rect = section.getBoundingClientRect();
      const sectionH = section.offsetHeight;
      const vh = window.innerHeight;
      const maxScroll = sectionH - vh;
      if (maxScroll <= 0) return;

      // rawProgress: 0 = 區塊頂部對齊視窗頂部, 1 = 區塊底部對齊視窗底部
      const scrolled = -rect.top;
      const rawProgress = Math.max(0, Math.min(1, scrolled / maxScroll));

      // ── 新邏輯：前 50% = 轉場遮罩「揭開」, 後 50% = 看內容 ──
      // 遮罩一開始蓋住畫面，滾動時逐漸退去露出內容
      let veilProgress: number;
      let veilOpacity: number;

      if (rawProgress <= 0.5) {
        // 轉場揭開階段：veilProgress 0→1，opacity 1→0
        veilProgress = rawProgress * 2; // 0→1
        veilOpacity = 1 - veilProgress; // 1→0
      } else {
        // 內容閱讀階段：遮罩完全消失
        veilProgress = 1;
        veilOpacity = 0;
      }

      section.style.setProperty('--veil-progress', String(veilProgress));
      section.style.setProperty(
        '--veil-opacity',
        String(Math.max(0, veilOpacity))
      );

      // 內容 reveal 動畫：遮罩差不多退去時觸發
      if (rawProgress > 0.35 && !section.classList.contains('is-visible')) {
        section.classList.add('is-visible');
      }
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    update();

    return () => {
      container.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const uepLines = isMobile
    ? narrative.uepLines.slice(0, 2)
    : narrative.uepLines;
  const narrationCount = narrative.narration.length;

  return (
    <section
      ref={sectionRef}
      className="journey-scene"
      style={
        {
          '--zone-main': zone.main,
          '--zone-soft': zone.soft,
        } as React.CSSProperties
      }
      data-zone-id={zone.id}
    >
      {/* ── Sticky 內容層：釘住在視窗中 ── */}
      <div className="journey-scene__sticky">
        {/* 背景氛圍粒子 */}
        <ZoneAtmosphere zone={zone} intensity={isMobile ? 'subtle' : 'rich'} />

        {/* zone 主色背景漸層 */}
        <div className="journey-scene__bg" />

        <div className="journey-scene__inner">
          {/* 左側：區域標題 */}
          <div className="journey-scene__label reveal-left">
            <div className="journey-kicker">
              {zone.kicker} · {zone.en}
            </div>
            <h2 className="journey-zone-title">{zone.label}</h2>
            <div className="journey-glyphs">
              {zone.glyphs.map((g, i) => (
                <span key={i}>{g}</span>
              ))}
            </div>
            <p className="journey-zone-blurb">{zone.blurb}</p>
            <button
              className="journey-enter-btn"
              onClick={onEnterZone}
              type="button"
            >
              進入{zone.label} →
            </button>
          </div>

          {/* 右側：敘事內容 */}
          <div className="journey-scene__narrative">
            {narrative.narration.map((para, i) => (
              <p
                key={`n-${i}`}
                className="journey-narration reveal-up"
                style={{ '--delay': `${i * 120}ms` } as React.CSSProperties}
              >
                {para}
              </p>
            ))}
            {uepLines.map((line, i) => (
              <div
                key={`u-${i}`}
                className="journey-uep-block reveal-up"
                style={
                  {
                    '--delay': `${(narrationCount + i) * 150 + 100}ms`,
                  } as React.CSSProperties
                }
              >
                <UepDialogue
                  side={i % 2 === 0 ? 'left' : 'right'}
                  text={line}
                  effects={['shimmer', 'halo']}
                />
              </div>
            ))}
          </div>
        </div>

        {/* 底部場景編號 */}
        <div
          className="journey-scene__footer reveal-up"
          style={{ '--delay': '600ms' } as React.CSSProperties}
        >
          <span>
            {String(index + 1).padStart(2, '0')} /{' '}
            {String(total).padStart(2, '0')}
          </span>
          <hr />
        </div>

        {/* ── 轉場遮罩：由 --veil-progress 驅動 ── */}
        <div className={`zone-veil zone-veil--${zone.id}`}>
          {zone.id === 'history' && (
            <>
              <div className="veil-ink-blot veil-ink-blot--1" />
              <div className="veil-ink-blot veil-ink-blot--2" />
              <div className="veil-brush-stroke" />
            </>
          )}
          {zone.id === 'echoes' && (
            <>
              <div className="veil-ripple veil-ripple--1" />
              <div className="veil-ripple veil-ripple--2" />
              <div className="veil-ripple veil-ripple--3" />
            </>
          )}
          {zone.id === 'visuals' && (
            <>
              <div className="veil-flash veil-flash--1" />
              <div className="veil-flash veil-flash--2" />
              <div className="veil-grain" />
            </>
          )}
          {zone.id === 'concepts' && (
            <>
              <div className="veil-scanlines" />
              <div className="veil-sweep" />
            </>
          )}
          {zone.id === 'storage' && <div className="veil-dust-settle" />}
        </div>
      </div>
    </section>
  );
}
