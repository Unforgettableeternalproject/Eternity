/**
 * UEP 浮島系統 — 五島圖示（S9-D.4）
 *
 * 原本 dock chip 直接印 `ISLAND_DEFINITIONS.icon` 的字元，但那組字元
 * 有一半是 emoji（📖 🖼）、一半是純符號（›_ ♫ ✎）——emoji 由系統字型
 * 渲染，跨平台長相與粗細都不受控，跟旁邊的線條符號並排時份量差一截
 * （艾斯維爾 2026-07-26）。統一改成同一套線稿 SVG：24 格、1.5 描邊、
 * currentColor，於是 chip 的 hover／閃爍配色能直接吃到圖示上。
 *
 * `ISLAND_DEFINITIONS.icon` 保留為文字後備（測試與非視覺場合仍可讀）。
 */

import React from 'react';

import type { IslandId } from './types';

interface IslandIconProps {
  id: IslandId;
  /** 邊長（px），預設 20 */
  size?: number;
}

/** 五島各自的線稿路徑（都在 24×24 座標系內） */
const PATHS: Record<IslandId, React.ReactNode> = {
  // 旅程之書：攤開的書，中央書脊
  history: (
    <>
      <path d="M12 6.5v13" />
      <path d="M12 6.5C10.4 5.2 8.3 4.6 5.5 4.6H3.5v13h2c2.8 0 4.9.6 6.5 1.9" />
      <path d="M12 6.5c1.6-1.3 3.7-1.9 6.5-1.9h2v13h-2c-2.8 0-4.9.6-6.5 1.9" />
    </>
  ),
  // 移動終端：機殼 + 提示符游標
  concepts: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7.5 10l2.5 2-2.5 2" />
      <path d="M12.5 14.5h4" />
    </>
  ),
  // 流浪回聲：八分音符
  echoes: (
    <>
      <path d="M9 17.5V6.5l9-2v11" />
      <circle cx="6.75" cy="17.5" r="2.25" />
      <circle cx="15.75" cy="15.5" r="2.25" />
    </>
  ),
  // 浮動幻影：畫框內的影像
  visuals: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M3.5 16.5l4.5-4 3.5 3 3-2.5 6 5" />
    </>
  ),
  // 便條紙：右下折角的一張紙
  storage: (
    <>
      <path d="M5 3.5h9l5 5v12H5z" />
      <path d="M14 3.5v5h5" />
      <path d="M8.5 12.5h7M8.5 16h4.5" />
    </>
  ),
};

export default function IslandIcon({ id, size = 20 }: IslandIconProps) {
  return (
    <svg
      className="uep-island-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {PATHS[id]}
    </svg>
  );
}
