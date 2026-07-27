/**
 * 跨區互聯線索卡（S10-1）
 *
 * 三座島都要顯示同一種東西——「和你剛才那個東西相關的，在這裡」——
 * 結構完全一樣（kicker + 可點清單 + 關閉鈕），差別只在調色與版位。
 * 所以結構共用、樣式由呼叫端給 class prefix 各自定義。
 *
 * 標題跟著 payload 走（見 `IslandRelatedItem`），島端不需要各自維護
 * 頁面索引；只有 History 島會拿自己的目錄樹覆寫，好讓卡片上的標題與
 * 下方目錄一致。
 */

import React from 'react';

import type { IslandRelatedItem } from './types';

interface Props {
  /** BEM block 名（如 `uep-hisland__related`），修飾子由本元件補 */
  block: string;
  /** 卡片抬頭，如「《曲名》相關的段落」 */
  kicker: React.ReactNode;
  /** 要列出的頁面 */
  items: IslandRelatedItem[];
  /** 覆寫顯示標題；回 undefined 或未提供時用 item 自帶的 */
  resolveTitle?: (item: IslandRelatedItem) => string | undefined;
  /** 點擊某一列 */
  onSelect: (pageId: string) => void;
  /** 關閉卡片 */
  onClose: () => void;
}

export default function RelatedClueCard({
  block,
  kicker,
  items,
  resolveTitle,
  onSelect,
  onClose,
}: Props) {
  if (items.length === 0) return null;
  return (
    <div className={block}>
      <button
        type="button"
        className={`${block}-close`}
        onClick={onClose}
        aria-label="關閉線索"
      >
        ×
      </button>
      <div className={`${block}-kicker`}>{kicker}</div>
      <div className={`${block}-list`}>
        {items.map((item) => (
          <button
            key={item.pageId}
            type="button"
            className={`${block}-item`}
            onClick={() => {
              // 先收卡再導航——導航可能是同頁 pushState，卡片留著會跨頁殘留
              onClose();
              onSelect(item.pageId);
            }}
          >
            {resolveTitle?.(item) ?? item.title}
          </button>
        ))}
      </div>
    </div>
  );
}
