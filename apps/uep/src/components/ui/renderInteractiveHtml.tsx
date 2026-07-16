import type React from 'react';

import { decorateInteractiveHtml } from '../../embed';
import type { ProgressState } from '../../progress';
import renderHtmlWithUep from './renderHtmlWithUep';

/**
 * History 前台渲染器（Epic 2 S4，S7-C 新語意）：在 renderHtmlWithUep
 * 之上追加 entity 互動啟用——concepts 島掛載時所有合法 entity 標記
 * 附加啟用屬性（可點、可鍵盤操作），島未掛載/觀測者維持普通文字。
 * 旗標不卡點擊，內容進度由 Concepts revision 卡控。
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
  proseClass = 'sto-prose'
): React.ReactNode[] {
  return renderHtmlWithUep(
    decorateInteractiveHtml(html, progress),
    keyPrefix,
    proseClass
  );
}
