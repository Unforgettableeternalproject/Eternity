/**
 * Concepts 條目 →「相關」互聯觸發按鈕（S10-1 T-G3）
 *
 * 艾斯維爾 2026-07-27 定案：**透過 concept 的按鈕去找到對應 entity 的
 * echo 或者 visual**。原本這顆按鈕查的是 History 錨點（「⟡ 段落」），
 * 方向反了——一個 entity 可能在 History 出現數十次，「所有提到他的段落」
 * 對讀者沒有意義；History 島只對劇情點有反應。
 *
 * 點下去會**同時觸發所有能觸發的島**：這個 entity 既有歌又有畫廊時，
 * Echoes 與 Visuals 兩座島都會浮出線索卡。
 *
 * 為什麼是手動而非進頁自動：一頁條目數十筆，mount 時全查等於一次打數十
 * 個請求，而且讀者根本沒表達想看哪一筆。
 *
 * 兩個守門條件缺一就整顆不渲染：
 * 1. 條目沒有 `entityKey` — 沒有 key 就沒有東西可查
 * 2. Echoes 與 Visuals **兩座島都不可用**（觀測者／未解鎖／被停用／手機
 *    寬度）— 事件廣播出去沒有任何消費者，按了不會有反應。入口跟著工具
 *    走，與 embed 互動式嵌入的 decorate 守門同一套哲學
 *
 * 查無結果時給 toast 而不是靜默——自動觸發沒反應是合理的（讀者沒有主動
 * 要求），手動按了沒反應則會被當成壞掉。
 */

import React, { useState } from 'react';

import {
  shouldMountIsland,
  triggerEntityRelated,
  useDesktopIslandViewport,
} from '../../islands';
import { getApiBase } from '../../lib/apiBase';
import { useProgress } from '../../progress/useProgress';
import { uepToast } from '../ui/UepToast';

const API_BASE = getApiBase();

interface Props {
  /** 條目的 entityKey；未掛 key 的條目傳 undefined，元件自行不渲染 */
  entityKey?: string;
  /** 條目顯示名稱（進島內卡片的標題） */
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
  // 只要其中一座島可用就值得給入口——查到的那半仍然送得出去
  const anyTargetMounted =
    shouldMountIsland(progress, 'echoes') ||
    shouldMountIsland(progress, 'visuals');
  if (!desktopViewport || !anyTargetMounted) return null;

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    // 條目卡本身多半也有點擊行為（展開／進詳細頁），這顆按鈕不該連帶觸發
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const found = await triggerEntityRelated({
        apiBase: API_BASE,
        sourceZone: 'concepts',
        entityKey: key as string,
        label,
      });
      if (!found) {
        uepToast.info(`沒有與「${label}」相關的回聲或影像`);
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
      title={`找「${label}」相關的回聲與影像`}
      aria-label={`找「${label}」相關的回聲與影像`}
    >
      <span className="conc-interlink-btn__glyph" aria-hidden="true">
        ⟡
      </span>
      <span className="conc-interlink-btn__text">相關</span>
    </button>
  );
}
