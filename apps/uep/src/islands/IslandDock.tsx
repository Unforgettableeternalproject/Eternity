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

import { useTerminalUnread } from './concepts/useTerminalUnread';
import {
  UEP_ECHO_SPOT_WAITING_EVENT,
  getEchoSpotWaiting,
} from './echoes/echoPreview';
import { getIslandRuntime } from './islandRuntime';
import { ISLAND_DEFINITIONS } from './types';
import type { IslandId } from './types';
import { useIslandRuntimeState } from './useIslands';
import {
  UEP_CLUE_WAITING_EVENT,
  getClueWaitingCount,
} from './visuals/phantomBridge';

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

  // Visual Clue 等待提示（V-D.31）：島收合中、閱讀位置在 clue 區間內
  // → visuals chip 閃爍。HistoryReader 經 phantomBridge 廣播計數。
  const [clueWaiting, setClueWaiting] = useState(() => getClueWaitingCount());
  useEffect(() => {
    const onChange = () => setClueWaiting(getClueWaitingCount());
    window.addEventListener(UEP_CLUE_WAITING_EVENT, onChange);
    return () => window.removeEventListener(UEP_CLUE_WAITING_EVENT, onChange);
  }, []);
  const [echoSpotWaiting, setEchoSpotWaitingState] = useState(() =>
    getEchoSpotWaiting()
  );
  useEffect(() => {
    const onChange = () => setEchoSpotWaitingState(getEchoSpotWaiting());
    window.addEventListener(UEP_ECHO_SPOT_WAITING_EVENT, onChange);
    return () =>
      window.removeEventListener(UEP_ECHO_SPOT_WAITING_EVENT, onChange);
  }, []);

  if (collapsed.length === 0) return null;

  return (
    <div className="uep-island-dock" role="toolbar" aria-label="浮島工具列">
      {collapsed.map((id) => {
        const def = ISLAND_DEFINITIONS[id];
        const unread = id === 'concepts' ? conceptsUnread : 0;
        const waiting = id === 'visuals' && clueWaiting > 0;
        const echoWaiting = id === 'echoes' && echoSpotWaiting;
        return (
          <button
            key={id}
            className={`uep-island-dock__chip${waiting ? ' is-clue-waiting' : ''}${echoWaiting ? ' is-echo-waiting' : ''}`}
            onClick={() => runtime.open(id)}
            aria-label={
              waiting
                ? `展開${def.title}（有視覺線索等待中）`
                : echoWaiting
                  ? `展開${def.title}（有回聲等待插播）`
                  : unread > 0
                    ? `展開${def.title}（${unread} 項未讀更新）`
                    : `展開${def.title}`
            }
            title={
              waiting
                ? `${def.title} · 有視覺線索等待中`
                : echoWaiting
                  ? `${def.title} · 有回聲等待插播`
                  : unread > 0
                    ? `${def.title} · ${unread} 項未讀更新`
                    : def.title
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
