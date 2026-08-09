import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { ZoneData } from '../../data/zones';
import { zoneTextColor } from '../../data/zones';
import { preloadZoneArt } from '../zone/ZoneBootArt';
import { acquireZoneEntryLock } from '../zone/zoneEntryLock';
import UepDialogue from './UepDialogue';
import introCss from './IntroOverlay.css?inline';
import { useDeferredStyle } from '../../islands/useDeferredStyle';

interface IntroOverlayProps {
  zone: ZoneData | null;
  onClose: () => void;
  onEnter: () => void;
}

export default function IntroOverlay({
  zone,
  onClose,
  onEnter,
}: IntroOverlayProps) {
  useDeferredStyle('intro-overlay', introCss);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const prevZoneRef = useRef<ZoneData | null>(null);

  // 只在 zone 從 null → 非 null（重新開啟）時同步重置殘留的 closing 狀態
  // 正在退場時 prevZoneRef 仍為非 null，不會被這裡攔截
  if (zone && !prevZoneRef.current && closing) {
    closingRef.current = false;
    setClosing(false);
  }
  prevZoneRef.current = zone;

  // 開啟期間隱藏浮島層（body class，見 zoneEntryLock）
  useEffect(() => {
    if (!zone) return;
    return acquireZoneEntryLock();
  }, [zone]);

  /*
   * 先把該區入場動畫要用的立繪載好。
   *
   * 立繪有 70~160KB，而 boot 只播 1800ms 且要與其他資源搶頻寬——等導頁
   * 之後才開始下載，很可能她浮現到一半 boot 就收掉了。這張卡是進入該區域
   * 的必經之路，而且使用者至少會停留幾秒讀 U.E.P 的開場白，時間綽綽有餘。
   */
  useEffect(() => {
    if (!zone) return;
    preloadZoneArt(zone.id);
  }, [zone]);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(() => onClose(), 280);
  }, [onClose]);

  const handleEnter = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(() => onEnter(), 280);
  }, [onEnter]);

  if (!zone) return null;

  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'dark';

  return (
    <div
      className={`intro-overlay${closing ? ' intro-overlay--closing' : ''}`}
      onClick={handleClose}
    >
      <div
        className="intro-overlay__card"
        onClick={(e) => e.stopPropagation()}
        style={
          {
            width: 'min(640px, 86%)',
            background: 'var(--bg-card)',
            border: `1px solid ${zone.main}`,
            borderRadius: 2,
            position: 'relative',
            padding: '36px 36px 28px',
          } as React.CSSProperties
        }
      >
        {/* corner accents */}
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <span
            key={c}
            style={{
              position: 'absolute',
              width: 14,
              height: 14,
              borderColor: zone.main,
              borderStyle: 'solid',
              borderWidth: 0,
              ...(c[0] === 't'
                ? { top: -1, borderTopWidth: 2 }
                : { bottom: -1, borderBottomWidth: 2 }),
              ...(c[1] === 'l'
                ? { left: -1, borderLeftWidth: 2 }
                : { right: -1, borderRightWidth: 2 }),
            }}
          />
        ))}

        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: zoneTextColor(zone.main, isDark),
            letterSpacing: '0.24em',
            textTransform: 'uppercase' as const,
            marginBottom: 6,
          }}
        >
          {zone.kicker} · {zone.en.toUpperCase()}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 38,
            fontWeight: 600,
            lineHeight: 1.05,
            color: 'var(--ink-title)',
            letterSpacing: '-0.01em',
          }}
        >
          {zone.label}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-serif-tc)',
            fontSize: 13,
            color: 'var(--ink-soft)',
            marginTop: 6,
            marginBottom: 22,
          }}
        >
          {zone.blurb}
        </div>

        <hr className="hairline" />

        <div className="intro-overlay__dialogues" style={{ paddingTop: 8 }}>
          <UepDialogue
            side="left"
            text={zone.uep[0]}
            effects={['shimmer', 'halo']}
          />
          <UepDialogue side="right" text={zone.uep[1]} effects={['shimmer']} />
          {zone.uep[2] && (
            <UepDialogue
              side="left"
              text={zone.uep[2]}
              effects={['shimmer', 'glow']}
            />
          )}
        </div>

        <div
          className="intro-overlay__footer"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 18,
            paddingTop: 16,
            borderTop: '1px solid var(--hairline)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--ink-mute)',
              letterSpacing: '0.16em',
              textTransform: 'uppercase' as const,
            }}
          >
            {zone.atmos}
          </div>

          <div
            className="intro-overlay__actions"
            style={{ display: 'flex', gap: 10 }}
          >
            <button className="btn-outline" onClick={handleClose}>
              返回地圖
            </button>
            <button
              className="btn-outline btn-outline--gold"
              style={{ borderColor: zone.main, color: zone.main }}
              onClick={handleEnter}
            >
              進入 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
