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

import React from 'react';

import { useTerminalUnread } from './concepts/useTerminalUnread';
import { getIslandRuntime } from './islandRuntime';
import { ISLAND_DEFINITIONS } from './types';
import type { IslandId } from './types';
import { useIslandRuntimeState } from './useIslands';

import './islands.css';

interface IslandDockProps {
  /** 已解鎖的浮島 id（由 host 依 progress 算好傳入） */
  unlockedIds: IslandId[];
}

export default function IslandDock({ unlockedIds }: IslandDockProps) {
  const runtime = getIslandRuntime();
  const state = useIslandRuntimeState();

  const collapsed = unlockedIds.filter((id) => !state.windows[id]?.open);
  // hook 順序穩定：collapsed 為空時 enabled=false，不觸發索引載入
  const conceptsUnread = useTerminalUnread(collapsed.includes('concepts'));

  if (collapsed.length === 0) return null;

  return (
    <div className="uep-island-dock" role="toolbar" aria-label="浮島工具列">
      {collapsed.map((id) => {
        const def = ISLAND_DEFINITIONS[id];
        const unread = id === 'concepts' ? conceptsUnread : 0;
        return (
          <button
            key={id}
            className="uep-island-dock__chip"
            onClick={() => runtime.open(id)}
            aria-label={
              unread > 0
                ? `展開${def.title}（${unread} 項未讀更新）`
                : `展開${def.title}`
            }
            title={
              unread > 0 ? `${def.title} · ${unread} 項未讀更新` : def.title
            }
          >
            <span aria-hidden>{def.icon}</span>
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
