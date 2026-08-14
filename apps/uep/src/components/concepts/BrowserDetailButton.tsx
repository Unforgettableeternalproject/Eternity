/**
 * dossier 條目 →「詳細」按鈕（S10-1，艾斯維爾 2026-07-27 定案）
 *
 * 「如果該 entity 在 browser 有內容，則多加一個按鈕叫做詳細」——點下去
 * **直接導向到 browser 頁面**並展開該 entity 的檔案。
 *
 * ⚠️ 這條路不經浮島：Terminal 島的 `resolveBrowserExpand` 是島內查詢用的
 * 純資料函式，與這裡無關。Concepts 是單一路由 SPA（`/concepts?page=…`），
 * 所以「導向」實際上是呼叫 Reader 內部的 `navigateToPage`。
 *
 * 出現條件：該 entityKey 在 browser stack 有**已解鎖**的條目。
 * 解鎖判定一定要疊——索引回的是全部條目摘要，不分是否已解鎖，少了這層
 * 就會替還沒讀到的角色長出一顆入口按鈕。
 *
 * 已知限制：browser 的 placeholder（佔位角色）依設計「沒有 gate 保持可見」，
 * 在索引摘要上看不出來。所以這顆按鈕只能保證「key 掛在某個 browser 頁且
 * 沒被 gate 擋住」，無法在不多打一次頁面請求的前提下排除「按下去其實是
 * 佔位卡」的情況。與 Terminal 島現行行為一致（按了才知道）。
 */

import React from 'react';

import {
  findByEntityKey,
  isIndexEntryUnlocked,
  type TerminalIndexEntry,
} from '../../islands/concepts/terminalCore';
import { useProgress } from '../../progress/useProgress';

interface Props {
  /** 條目的 entityKey；未掛 key 的條目傳 undefined，元件自行不渲染 */
  entityKey?: string;
  /** 條目顯示名稱（無障礙標籤用） */
  label: string;
  /**
   * Concepts entity 索引；null＝尚未載入完成，一律不渲染
   * （由 ReaderDossier 統一載入後往下傳，不讓數十個條目各自持有一份）
   */
  index: TerminalIndexEntry[] | null;
  /** 導向該 entity 的 browser 頁並展開對應檔案 */
  onNavigate: (pageId: string, entityKey: string) => void;
}

export default function BrowserDetailButton({
  entityKey,
  label,
  index,
  onNavigate,
}: Props) {
  const progress = useProgress();

  const key = entityKey?.trim();
  if (!key || !index) return null;

  const target = findByEntityKey(index, key).find(
    (entry) =>
      entry.stack === 'browser' && isIndexEntryUnlocked(entry, progress)
  );
  if (!target) return null;

  return (
    <button
      type="button"
      className="conc-interlink-btn conc-detail-btn"
      onClick={(event) => {
        // 條目卡本身也是拖曳來源與點擊目標，這顆按鈕不該連帶觸發
        event.stopPropagation();
        onNavigate(target.pageId, key);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={`前往「${label}」的完整檔案`}
      aria-label={`前往「${label}」的完整檔案`}
    >
      <span className="conc-interlink-btn__glyph" aria-hidden="true">
        ▤
      </span>
      <span className="conc-interlink-btn__text">詳細</span>
    </button>
  );
}
