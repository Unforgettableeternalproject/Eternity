/**
 * UEP 浮島系統 — 拖曳定位共用 helpers
 *
 * 機制沿用 Minimap 的成熟做法（pointer capture + viewport clamp +
 * 比例式 resize 重定位），抽出為純函式供 DraggableIsland 使用；
 * 後續 Minimap 行為對齊時可回頭改吃這份。
 *
 * 座標約定：永遠只用 left/top（viewport 座標，position: fixed），
 * 不用 right/bottom，避免四值同時存在時被合併為 inset。
 */

import type { IslandCorner } from './types';

export interface XYPosition {
  left: number;
  top: number;
}

/** 視窗中的比例位置，resize 時等比移動用 */
export interface PositionRatio {
  lr: number;
  tr: number;
}

/** 邊界內縮（px） */
const PAD = 8;

/** 將座標 clamp 進 viewport（保留 PAD 邊距） */
export function clampToViewport(
  left: number,
  top: number,
  width: number,
  height: number
): XYPosition {
  return {
    left: Math.max(PAD, Math.min(window.innerWidth - width - PAD, left)),
    top: Math.max(PAD, Math.min(window.innerHeight - height - PAD, top)),
  };
}

/** 從絕對座標算出視窗比例 */
export function toRatio(left: number, top: number): PositionRatio {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    lr: vw > 0 ? left / vw : 0,
    tr: vh > 0 ? top / vh : 0,
  };
}

/** 從比例還原為絕對座標（再 clamp） */
export function fromRatio(
  ratio: PositionRatio,
  width: number,
  height: number
): XYPosition {
  return clampToViewport(
    ratio.lr * window.innerWidth,
    ratio.tr * window.innerHeight,
    width,
    height
  );
}

/** 依預設角落換算初始 left/top（需要元件實際尺寸） */
export function resolveCornerPosition(
  corner: IslandCorner,
  width: number,
  height: number
): XYPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const MARGIN = 20;
  return {
    'bottom-right': { left: vw - width - MARGIN, top: vh - height - MARGIN },
    'bottom-left': { left: MARGIN, top: vh - height - MARGIN },
    'top-right': { left: vw - width - MARGIN, top: MARGIN },
    'top-left': { left: MARGIN, top: MARGIN },
  }[corner];
}
