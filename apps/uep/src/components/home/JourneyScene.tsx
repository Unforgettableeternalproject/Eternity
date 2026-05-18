import React, { useRef } from 'react';
import type { ZoneData } from '../../data/zones';
import type { JourneyNarrative } from '../../data/journey';
import { useScrollReveal } from '../../hooks/useScrollReveal';
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
      <ZoneAtmosphere zone={zone} intensity={isMobile ? 'subtle' : 'rich'} />
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

        <div
          className="journey-scene__narrative"
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
