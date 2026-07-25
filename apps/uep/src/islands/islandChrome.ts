/**
 * 浮島外殼契約（S9-C.1）
 *
 * 背景：v2 設計稿把四座島的中性白框 header 全部拿掉——旅程之書是一張紙、
 * 流浪回聲是一池水、浮動幻影是投影裝置、便條紙就是一張便條。標題、收合鈕、
 * 拖曳把手全部要長進各島自己的材質裡，位置與文案也各不相同
 * （闔上／收起／散去）。
 *
 * 所以 `DraggableIsland` 在 bare 模式不再渲染任何 chrome，改用本 context
 * 把「視窗行為」交還給島：島自畫把手與收合鈕，行為仍由外殼統一實作
 * （pointer capture、viewport clamp、離場動畫收束都不重寫）。
 *
 * 把手的 cursor 與 touch-action 走 `[data-island-grip]` 全域選取器，
 * 不走 className——島要把把手掛在自己的元素上（書名列、水面、膠帶），
 * 若用 className 傳遞，島每次都得手動合併字串，漏掉就變成不能拖。
 */

import { createContext, useContext } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** 掛在島自畫拖曳把手上的 props（直接 spread） */
export interface IslandGripProps {
  'data-island-grip': string;
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: (e: ReactPointerEvent) => void;
}

export interface IslandChromeValue {
  /**
   * bare = 島要自畫標頭／收合鈕／拖曳把手。
   * false 時島不該重複畫——外殼已經給了 header（手機 bottom sheet 即是）。
   */
  bare: boolean;
  /** 拖曳把手 props；bare 為 false 時是一組 no-op，spread 上去無副作用 */
  dragHandleProps: IslandGripProps;
  /** 收合：播離場動畫，播完才通知 runtime 真正關閉 */
  requestClose: () => void;
  /** 離場動畫進行中——島可據此暫停內部動畫或改變材質 */
  leaving: boolean;
}

const noop = () => {};

const FALLBACK: IslandChromeValue = {
  bare: false,
  dragHandleProps: {
    'data-island-grip': '',
    onPointerDown: noop,
    onPointerMove: noop,
    onPointerUp: noop,
    onPointerCancel: noop,
  },
  requestClose: noop,
  leaving: false,
};

export const IslandChromeContext = createContext<IslandChromeValue | null>(
  null
);

/**
 * 取得外殼控制權。
 *
 * 島元件在測試中常被單獨渲染（不包 DraggableIsland），所以 provider 缺席時
 * 回 no-op fallback 而非 throw——視覺測試不該被迫套一層外殼。
 */
export function useIslandChrome(): IslandChromeValue {
  return useContext(IslandChromeContext) ?? FALLBACK;
}
