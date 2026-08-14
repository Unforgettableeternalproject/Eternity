/**
 * UEP 浮島系統 — Dock（收合島的停靠列）
 *
 * 右下角的 chip 列：顯示「已解鎖但目前收合」的浮島，點擊展開。
 * 展開中的島不出現在 dock（視窗自己的收合鈕會把它送回來）。
 * 沒有可顯示的 chip 時整個 dock 不渲染。
 *
 * concepts chip 未讀亮點（S7 驗收 #10）：收合期間的更動通知
 * 由 useTerminalUnread 預計算（只讀水位不寫回），badge 顯示
 * 未讀項數；水位在 terminal 展開、通知文字條列渲染時才推進，
 * badge 隨之自動熄滅。
 */

import React, { useEffect, useState } from 'react';

import { isZoneEntryActive } from '../components/zone/zoneEntryLock';

import IslandIcon from './IslandIcon';
import { useTerminalUnread } from './concepts/useTerminalUnread';
import { getIslandRuntime } from './islandRuntime';
import { ISLAND_DEFINITIONS } from './types';
import type { IslandId } from './types';
import { useChipAttentions } from './useChipAttention';
import { useIslandRuntimeState, useZoneEntryActive } from './useIslands';

import islandsCss from './islands.css?inline';
import { useDeferredStyle } from './useDeferredStyle';

/** dock 離場動畫時長（ms）——必須與 islands.css 的 uep-dock-out 對齊 */
const DOCK_LEAVE_MS = 220;

interface IslandDockProps {
  /** 已解鎖的浮島 id（由 host 依 progress 算好傳入） */
  unlockedIds: IslandId[];
}

export default function IslandDock({ unlockedIds }: IslandDockProps) {
  useDeferredStyle('islands-shell', islandsCss);
  const runtime = getIslandRuntime();
  const state = useIslandRuntimeState();

  const collapsed = unlockedIds.filter((id) => !state.windows[id]?.open);
  // hook 順序穩定：collapsed 為空時 enabled=false，不觸發索引載入
  const conceptsUnread = useTerminalUnread(collapsed.includes('concepts'));

  // 收合期間的提示（S9-D.5）：Visual Clue 區間、Echo Spot 待播、
  // 互動式嵌入的相關內容、進度與便條的變動——全部收在同一支 hook，
  // 一律持續到使用者展開該島或換頁為止。
  const attentions = useChipAttentions();

  /* 轉場讓位（S9-D.2）：與島本體同一套語意，但 dock 是一排小 chip，
     用整列淡出退場即可；回來時每顆 chip 各自重播既有的 chip-in。 */
  const zoneEntryActive = useZoneEntryActive();
  const [dockPhase, setDockPhase] = useState<'visible' | 'hiding' | 'hidden'>(
    () => (isZoneEntryActive() ? 'hidden' : 'visible')
  );
  useEffect(() => {
    if (zoneEntryActive) {
      setDockPhase((p) => (p === 'visible' ? 'hiding' : p));
      return;
    }
    setDockPhase('visible');
  }, [zoneEntryActive]);
  useEffect(() => {
    if (dockPhase !== 'hiding') return;
    // 保底：reduced-motion 下 animationend 不會來
    const timer = window.setTimeout(
      () => setDockPhase((p) => (p === 'hiding' ? 'hidden' : p)),
      DOCK_LEAVE_MS + 80
    );
    return () => window.clearTimeout(timer);
  }, [dockPhase]);

  if (collapsed.length === 0 || dockPhase === 'hidden') return null;

  return (
    <div
      className={`uep-island-dock${dockPhase === 'hiding' ? ' is-hiding' : ''}`}
      role="toolbar"
      aria-label="浮島工具列"
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && dockPhase === 'hiding') {
          setDockPhase('hidden');
        }
      }}
    >
      {collapsed.map((id) => {
        const def = ISLAND_DEFINITIONS[id];
        const unread = id === 'concepts' ? conceptsUnread : 0;
        const attention = attentions[id];
        const note = attention ?? (unread > 0 ? `${unread} 項未讀更新` : null);
        return (
          <button
            key={id}
            data-island={id}
            className={`uep-island-dock__chip${attention ? ' is-attn-waiting' : ''}`}
            onClick={() => runtime.open(id)}
            aria-label={
              note ? `展開${def.title}（${note}）` : `展開${def.title}`
            }
            title={note ? `${def.title} · ${note}` : def.title}
          >
            <IslandIcon id={id} />
            {unread > 0 && (
              <span className="uep-island-dock__badge" aria-hidden>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
