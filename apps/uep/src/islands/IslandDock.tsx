/**
 * UEP 浮島系統 — Dock（收合島的停靠列）
 *
 * 右下角的 chip 列：顯示「已解鎖但目前收合」的浮島，點擊展開。
 * 展開中的島不出現在 dock（視窗自己的收合鈕會把它送回來）。
 * 沒有可顯示的 chip 時整個 dock 不渲染。
 */

import React from 'react';

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
  if (collapsed.length === 0) return null;

  return (
    <div className="uep-island-dock" role="toolbar" aria-label="浮島工具列">
      {collapsed.map((id) => {
        const def = ISLAND_DEFINITIONS[id];
        return (
          <button
            key={id}
            className="uep-island-dock__chip"
            onClick={() => runtime.open(id)}
            aria-label={`展開${def.title}`}
            title={def.title}
          >
            <span aria-hidden>{def.icon}</span>
          </button>
        );
      })}
    </div>
  );
}
