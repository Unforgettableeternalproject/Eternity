import type React from 'react';

import { decorateInteractiveHtml } from '../../embed';
import type { ProgressState } from '../../progress';
import renderHtmlWithUep from './renderHtmlWithUep';

/**
 * History 前台渲染器（Epic 2 S4）：在 renderHtmlWithUep 之上
 * 追加 entity 互動啟用——已解鎖的 entity 標記附加啟用屬性
 * （可點、可鍵盤操作），未解鎖維持普通文字。
 *
 * 只追加不刪除：UEP 對話、音訊播放器、資產 URL 正規化
 * 全部沿用 renderHtmlWithUep，行為不退化。
 *
 * 呼叫端需在進度變化時重新渲染（HistoryReader 已訂閱
 * useProgress()，旗標授予即時生效）。
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
