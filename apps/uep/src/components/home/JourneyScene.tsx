import React, { useEffect, useRef, useState } from 'react';
import type { ZoneData } from '../../data/zones';
import type { JourneyNarrative } from '../../data/journey';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import type ZoneAtmosphereType from '../ui/ZoneAtmosphere';
import UepDialogue from '../ui/UepDialogue';
import renderHtmlWithUep from '../ui/renderHtmlWithUep';
import './JourneyScene.css';

/**
 * 背景氛圍層延後載入——首頁一次渲染五個 zone，每個都掛一份，而首屏是
 * Hero，五份氛圍層沒有一個在第一眼看得到。它退出首屏 JS，SSR 也不再
 * 輸出這五份的 DOM。純裝飾層晚一點浮現不影響功能與版面（absolute 疊層）。
 *
 * ⚠️ **不能用 React.lazy + Suspense。** 首頁是 client:load，五個
 * JourneyScene 在 hydration 期間就存在，Suspense 邊界會在 hydration
 * 完成前收到 lazy 的解析更新 → React error #421，該邊界整個退回客戶端
 * 渲染。代價是五個 zone 的子樹丟棄 SSR 的 HTML 重畫，遠大於省下的體積。
 * （BigMapModal 那邊可以用 Suspense，因為它是點擊後才渲染，那時
 * hydration 早就結束。）
 *
 * 改用 state + effect 動態 import：SSR 與客戶端首次渲染都是 null，
 * 兩邊一致不會有 hydration mismatch，effect 之後才補上。
 *
 * 其餘 Reader 各自只掛一份、且就在首屏，維持直接 import。
 */
type AtmosphereComponent = typeof ZoneAtmosphereType;

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

  /* 見檔頭：延後載入氛圍層，但不經 Suspense */
  const [Atmosphere, setAtmosphere] = useState<AtmosphereComponent | null>(
    null
  );
  useEffect(() => {
    let alive = true;
    void import('../ui/ZoneAtmosphere').then((mod) => {
      /* setState 傳函式會被當成 updater，元件型別要包一層 */
      if (alive) setAtmosphere(() => mod.default);
    });
    return () => {
      alive = false;
    };
  }, []);

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
      {Atmosphere && (
        <Atmosphere zone={zone} intensity={isMobile ? 'subtle' : 'rich'} />
      )}
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
