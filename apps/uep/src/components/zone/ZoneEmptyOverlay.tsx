import React from 'react';

import {
  CONSTRUCTION_COPY,
  EMPTY_STATE_ART,
  pickConstructionVariant,
  pickSealedCopy,
} from './zoneEmptyState';
import type { ZoneEmptyKind } from './zoneEmptyState';
import './ZoneEmptyOverlay.css';

interface ZoneEmptyOverlayProps {
  /** null = 有可見內容，原樣渲染 children */
  kind: ZoneEmptyKind | null;
  /** 變體與文案的穩定種子，建議 `${zone}:${子頁面路徑}` */
  seed: string;
  /** zone 主色（CSS 色值或 var(--xxx-main)） */
  accent?: string;
  className?: string;
  /** 被告示牌蓋住的主內容區；空狀態時降透明度、模糊並禁止互動 */
  children?: React.ReactNode;
}

/**
 * 子頁面的空狀態告示牌。
 *
 * 蓋住傳入的主內容區（標題以下），麵包屑、zone 頁首與返回導航留在外面；
 * 判定由 `resolveZoneEmptyState` 在呼叫端完成。
 */
export function ZoneEmptyOverlay({
  kind,
  seed,
  accent,
  className = '',
  children,
}: ZoneEmptyOverlayProps) {
  if (!kind) return <>{children}</>;

  const isSealed = kind === 'sealed';
  const variant = pickConstructionVariant(seed);
  const copy = isSealed ? pickSealedCopy(seed) : CONSTRUCTION_COPY[variant];
  const art = isSealed ? EMPTY_STATE_ART.sealed : EMPTY_STATE_ART[variant];

  return (
    <div
      className={[
        'zone-empty',
        isSealed ? 'zone-empty--sealed' : 'zone-empty--construction',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-empty-kind={kind}
      style={
        accent
          ? ({ '--zone-empty-accent': accent } as React.CSSProperties)
          : undefined
      }
    >
      {children && (
        // React 18 不認得 inert，以空字串屬性傳入
        <div
          className="zone-empty__under"
          aria-hidden="true"
          {...({ inert: '' } as Record<string, string>)}
        >
          {children}
        </div>
      )}
      <div className="zone-empty__sign" role="status">
        <img
          className={`zone-empty__art zone-empty__art--${isSealed ? 'sealed' : variant}`}
          src={art}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
        <div className="zone-empty__plate">
          <div className="zone-empty__kicker">
            {isSealed ? 'NOT YET · 尚未開放' : 'UNDER CONSTRUCTION · 建設中'}
          </div>
          <div className="zone-empty__title">{copy.title}</div>
          <p className="zone-empty__subtitle">{copy.subtitle}</p>
        </div>
      </div>
    </div>
  );
}

export default ZoneEmptyOverlay;
