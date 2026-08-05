import React, { Suspense, lazy, useRef } from 'react';
import type { ZoneData } from '../../data/zones';
import type { JourneyNarrative } from '../../data/journey';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import UepDialogue from '../ui/UepDialogue';
import renderHtmlWithUep from '../ui/renderHtmlWithUep';
import './JourneyScene.css';

/**
 * 背景氛圍層走 lazy——首頁一次渲染五個 zone，每個都掛一份，
 * 而首屏是 Hero，五份氛圍層沒有一個在第一眼看得到。
 *
 * 兩個收益：它退出首屏 JS（是第二波裡最大的一塊），
 * 而且 SSR 不再輸出這五份的 DOM，HTML 跟著變小。
 * 純裝飾層晚一點浮現不影響任何功能與版面（它是 absolute 疊層）。
 *
 * 其餘 Reader 各自只掛一份、且就在首屏，維持直接 import。
 */
const ZoneAtmosphere = lazy(() => import('../ui/ZoneAtmosphere'));

interface JourneySceneProps {
  zone: ZoneData;
  narrative: JourneyNarrative;
  /** 從 D1 取得的 TipTap HTML 敘事內容（有值時取代靜態 narrative） */
  bodyHtml?: string;
  index: number;
  total: number;
  onEnterZone: () => void;
  isMobile?: boolean;
}

export default function JourneyScene({
  zone,
  narrative,
  bodyHtml,
  index,
  total,
  onEnterZone,
  isMobile = false,
}: JourneySceneProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const { triggered } = useScrollReveal(sectionRef, {
    threshold: 0.22,
    rootMargin: '0px 0px -18px 0px',
  });

  const uepLines = isMobile
    ? narrative.uepLines.slice(0, 2)
    : narrative.uepLines;
  const narrationCount = narrative.narration.length;
  const handleNarrativeWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const canScroll = el.scrollHeight > el.clientHeight;

    event.stopPropagation();
    if (!canScroll) {
      event.preventDefault();
      return;
    }

    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const scrollingUp = event.deltaY < 0;
    const scrollingDown = event.deltaY > 0;

    if ((scrollingUp && atTop) || (scrollingDown && atBottom)) {
      event.preventDefault();
    }
  };

  return (
    <section
      ref={sectionRef}
      className={`journey-scene ${triggered ? 'is-visible' : ''}`}
      style={
        {
          '--zone-main': zone.main,
          '--zone-soft': zone.soft,
        } as React.CSSProperties
      }
      data-zone-id={zone.id}
    >
      <Suspense fallback={null}>
        <ZoneAtmosphere zone={zone} intensity={isMobile ? 'subtle' : 'rich'} />
      </Suspense>
      <div className="journey-scene__bg" />

      <div className="journey-scene__inner">
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

        {/* 有 D1 HTML 時用 renderHtmlWithUep 渲染；否則 fallback 靜態敘事 */}
        {bodyHtml ? (
          <div
            className="journey-scene__body"
            data-reading-scroll="true"
            onWheel={handleNarrativeWheel}
          >
            {renderHtmlWithUep(bodyHtml, `zone-${zone.id}`, 'journey-prose')}
          </div>
        ) : (
          <div
            className="journey-scene__narrative"
            data-reading-scroll="true"
            onWheel={handleNarrativeWheel}
          >
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
        )}
      </div>

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
    </section>
  );
}
