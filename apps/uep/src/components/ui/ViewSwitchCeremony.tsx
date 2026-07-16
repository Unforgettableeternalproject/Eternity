/**
 * 切換身分儀式動畫（Epic 2 S5 打磨輪 3）
 *
 * 觀看世界的方式改變時的全屏儀式感反饋——不再是輕描淡寫的 toast，
 * 而是一段短促但正式的視覺轉換：中央 glyph 從舊視角淡出、新視角淡入，
 * 光暈環從中心擴散消融，全屏 blur veil 短暫罩住背景。
 *
 * 刻意不加字幕——glyph 本身就是身分的符號，畫面自己會說話。
 *
 * 走 createPortal 掛到 body：識別證翻面用 preserve-3d 建 3D stacking
 * context，會鎖住 fixed 定位的元素。
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import './ViewSwitchCeremony.css';

type View = 'explorer' | 'observer';

interface Props {
  from: View;
  to: View;
  onDone: () => void;
}

const GLYPH: Record<View, string> = {
  explorer: '◈',
  observer: '◉',
};

/** 儀式總時長；reduced-motion 縮短到 500ms */
const CEREMONY_MS = 1800;
const CEREMONY_MS_REDUCED = 500;

export default function ViewSwitchCeremony({ from, to, onDone }: Props) {
  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(onDone, reduced ? CEREMONY_MS_REDUCED : CEREMONY_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="uep-vsc"
      role="status"
      aria-live="polite"
      aria-label={`視角切換為${to === 'observer' ? '觀測者' : '探索者'}`}
    >
      <div className="uep-vsc__veil" />

      <div className="uep-vsc__stage">
        {/* 光暈環：從中心擴散、隨後淡出 */}
        <div className="uep-vsc__halo" aria-hidden="true" />
        <div
          className="uep-vsc__halo uep-vsc__halo--delayed"
          aria-hidden="true"
        />

        {/* 舊 glyph：淡出縮小 */}
        <span
          className={`uep-vsc__glyph uep-vsc__glyph--out uep-vsc__glyph--${from}`}
          aria-hidden="true"
        >
          {GLYPH[from]}
        </span>

        {/* 新 glyph：延遲淡入、微幅放大到定位 */}
        <span
          className={`uep-vsc__glyph uep-vsc__glyph--in uep-vsc__glyph--${to}`}
          aria-hidden="true"
        >
          {GLYPH[to]}
        </span>
      </div>
    </div>,
    document.body
  );
}
