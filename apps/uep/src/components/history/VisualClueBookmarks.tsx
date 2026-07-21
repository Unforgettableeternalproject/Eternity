/**
 * VisualClueBookmarks — 側邊視覺線索插卡（S8 下半場 V-D，#6 重新設計）。
 *
 * 掃描線進入 clue 起訖區間時浮現、離開即收起。多 clue 區間重疊時
 * 折疊成一落（後方卡片縮小、往下錯位堆疊，仍全部可見），滑鼠 hover
 * 或鍵盤 focus 時展開成完整卡片列。堆疊與展開都在同一個 .uep-clue-stack
 * 連續 hover 區內，展開後滑鼠移動不會讓卡片消失、可穩定點擊。
 *
 * 卡片右側是插卡本體，左側連接線以 flex 撐長，末端針腳圓點落到文章
 * 右緣——視覺上像從內文牽出的線索，刻意與史學紅的「上次位置」scroll
 * marker（右緣細線小標籤）拉開語彙區隔，改用幻影紫插卡＋畫框縮圖。
 *
 * 卡片內的畫框縮圖區為 #8（每次引用的起始圖片）預留版面，目前以模糊
 * 佔位呈現，待 #8 定案後接入真實起始圖片的模糊縮圖。
 *
 * 定位維持固定高度釘位（不追個別 clue 錨點像素），確保多 clue 穩定
 * 堆疊、捲動不亂跳（設計文件 §七風險 1 的迴避解）。守門（島未掛載/
 * 未展開/觀測者不出現）由呼叫端負責，這裡是純渲染。
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
      <div
        className="uep-clue-stack"
        style={{ '--clue-count': clues.length } as React.CSSProperties}
      >
        {clues.map((clue, i) => (
          <button
            key={clue.clueId}
            type="button"
            className="uep-clue-card"
            style={{ '--clue-i': i } as React.CSSProperties}
            onClick={() => onClueClick(clue)}
            title={clue.title ? `檢視插圖：${clue.title}` : '檢視插圖'}
            aria-label={clue.title ? `檢視插圖：${clue.title}` : '檢視插圖'}
          >
            {/* 連接線：flex 撐長，末端針腳圓點落到文章右緣 */}
            <span className="uep-clue-card__line" aria-hidden />
            <span className="uep-clue-card__frame">
              {/* #8 預留：未來放起始圖片的模糊縮圖；目前為畫框佔位 */}
              <span className="uep-clue-card__thumb" aria-hidden>
                <span className="uep-clue-card__glyph">❏</span>
              </span>
              <span className="uep-clue-card__text">
                <span className="uep-clue-card__label">視覺線索</span>
                <span className="uep-clue-card__title">
                  {clue.title || '未命名畫廊'}
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
