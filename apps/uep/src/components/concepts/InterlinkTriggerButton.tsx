/**
 * Concepts 條目 → History 互聯觸發按鈕（S10-1 T-G3）
 *
 * Echoes／Visuals 是「進頁就自動查」，Concepts 不能照抄——一頁條目數十
 * 筆，mount 時全查等於一次打數十個請求，而且讀者根本沒表達想看哪一筆。
 * 所以這裡是**條目旁的手動觸發**，點了才查。
 *
 * 兩個守門條件缺一就整顆不渲染：
 * 1. 條目沒有 `entityKey` — 沒有 key 就沒有東西可查
 * 2. History 島沒掛載（觀測者／未解鎖／被停用／手機寬度）— 事件廣播出去
 *    沒有消費者，按了不會有任何反應。入口跟著工具走，與 embed 互動式
 *    嵌入的 decorate 守門同一套哲學
 *
 * 查無錨點時給 toast 而不是靜默——自動觸發沒反應是合理的（讀者沒有
 * 主動要求），手動按了沒反應則會被當成壞掉。
 */

import React, { useState } from 'react';

import {
  shouldMountIsland,
  triggerHistoryRelated,
  useDesktopIslandViewport,
} from '../../islands';
import { getApiBase } from '../../lib/apiBase';
import { useProgress } from '../../progress/useProgress';
import { uepToast } from '../ui/UepToast';

const API_BASE = getApiBase();

interface Props {
  /** 條目的 entityKey；未掛 key 的條目傳 undefined，元件自行不渲染 */
  entityKey?: string;
  /** 條目顯示名稱（進 History 島卡片的標題） */
  label: string;
  /** 額外 class（各 stack 版面微調用） */
  className?: string;
}

export default function InterlinkTriggerButton({
  entityKey,
  label,
  className,
}: Props) {
  const progress = useProgress();
  const desktopViewport = useDesktopIslandViewport();
  const [busy, setBusy] = useState(false);

  const key = entityKey?.trim();
  if (!key) return null;
  if (!desktopViewport || !shouldMountIsland(progress, 'history')) return null;

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    // 條目卡本身多半也有點擊行為（展開／進詳細頁），這顆按鈕不該連帶觸發
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const found = await triggerHistoryRelated({
        apiBase: API_BASE,
        sourceZone: 'concepts',
        keyType: 'entity',
        key: key as string,
        label,
      });
      if (!found) {
        uepToast.info(`沒有段落提到「${label}」`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`conc-interlink-btn${busy ? ' is-busy' : ''}${
        className ? ` ${className}` : ''
      }`}
      onClick={handleClick}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={busy}
      title={`查「${label}」在哪些段落出現過`}
      aria-label={`查「${label}」在哪些段落出現過`}
    >
      <span className="conc-interlink-btn__glyph" aria-hidden="true">
        ⟡
      </span>
      <span className="conc-interlink-btn__text">段落</span>
    </button>
  );
}
