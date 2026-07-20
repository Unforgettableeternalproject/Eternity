/**
 * VisualClueBookmarks — 側邊書籤按鈕列（S8 下半場 V-D）。
 *
 * 掃描線進入 clue 起訖區間時浮現、離開即收起；多 clue 區間重疊時
 * 垂直堆疊。掛在 .history-main 右緣（同「上次位置」scroll marker 的
 * 錨定層），viewport 釘位不追蹤錨點像素——連接線指向內容方向但
 * 不碰字，在不同視窗寬度下穩定（設計文件 §七風險 1 的迴避解）。
 *
 * 守門（島未掛載/未展開/觀測者不出現）由呼叫端負責，這裡是純渲染。
 */

import React from 'react';

import type { VisualClueEntry } from './useVisualClues';

import './VisualClueBookmarks.css';

interface VisualClueBookmarksProps {
  clues: VisualClueEntry[];
  onClueClick: (clue: VisualClueEntry) => void;
}

export default function VisualClueBookmarks({
  clues,
  onClueClick,
}: VisualClueBookmarksProps) {
  if (clues.length === 0) return null;

  return (
    <div className="uep-clue-rail" role="complementary" aria-label="視覺線索">
      {clues.map((clue) => (
        <button
          key={clue.clueId}
          type="button"
          className="uep-clue-bookmark"
          onClick={() => onClueClick(clue)}
          title={clue.title ? `檢視插圖：${clue.title}` : '檢視插圖'}
          aria-label={clue.title ? `檢視插圖：${clue.title}` : '檢視插圖'}
        >
          <span className="uep-clue-bookmark__line" aria-hidden />
          <span className="uep-clue-bookmark__tab">
            <span className="uep-clue-bookmark__icon" aria-hidden>
              ❏
            </span>
            {clue.title && (
              <span className="uep-clue-bookmark__label">{clue.title}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
