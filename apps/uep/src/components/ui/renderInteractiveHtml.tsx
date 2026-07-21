import type React from 'react';

import { decorateInteractiveHtml } from '../../embed';
import type { ProgressState } from '../../progress';
import renderHtmlWithUep from './renderHtmlWithUep';

/**
 * History 前台渲染器（Epic 2 S4，S7-C 語意 + 2026-07-17 修正）：
 * 在 renderHtmlWithUep 之上追加 entity 互動啟用——相應浮島（Concepts /
 * Echoes / Visuals）任一掛載時，合法 entity 標記附加啟用屬性（可點、可
 * 鍵盤操作），全數未掛載/觀測者維持普通文字。isRefUnlocked（選填）做
 * 條目級守門：未在任一相應浮島解鎖的 entity 不啟用（「可點 ⟺ 相應浮島
 * 查得到內容」不變量，跨島聯集），來源見 islands/useEntityRefUnlock。
 *
 * 只追加不刪除：UEP 對話、音訊播放器、資產 URL 正規化
 * 全部沿用 renderHtmlWithUep，行為不退化。
 *
 * 呼叫端需在進度變化時重新渲染（HistoryReader 已訂閱
 * useProgress()，島解鎖/停用切換即時生效）。
 */
export default function renderInteractiveHtml(
  html: string,
  progress: ProgressState,
  keyPrefix: string | number = 0,
  proseClass = 'sto-prose',
  isRefUnlocked?: (ref: string) => boolean
): React.ReactNode[] {
  return renderHtmlWithUep(
    decorateInteractiveHtml(html, progress, isRefUnlocked),
    keyPrefix,
    proseClass
  );
}
