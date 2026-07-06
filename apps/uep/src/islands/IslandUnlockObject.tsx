/**
 * UEP 浮島系統 — 解鎖小物件
 *
 * 各 zone 首頁的「特別的小物件」：到訪過該 zone 的 Reader（zone:visited:*）
 * 後才浮現，點擊喚醒對應浮島（授予解鎖 + 甦醒動畫 + 首次展開）。
 *
 * 浮現條件（三關）：探索者視角 + 已到訪 + 尚未解鎖。
 * 解鎖後小物件消失——它「變成」了浮島。
 *
 * S6 先做最簡單版（發光物件 + 甦醒動畫）；未來可換成各 zone 專屬的
 * 複雜互動（艾斯維爾定案：解鎖方式先求簡單，機制通用）。
 */

import React, { useState } from 'react';

import { useReaderAuth } from '../auth';
import { useProgress } from '../progress';

import {
  canUseIslands,
  getIslandRuntime,
  hasVisitedZone,
  isIslandUnlocked,
  unlockIsland,
} from './islandRuntime';
import { ISLAND_DEFINITIONS } from './types';
import type { IslandId } from './types';

import './islands.css';

/** 甦醒動畫時長（與 CSS uep-unlock-awaken 對齊） */
const AWAKEN_MS = 1400;

/** 各島解鎖物件的意象文案（hover 提示） */
const UNLOCK_HINTS: Record<IslandId, { object: string; hint: string }> = {
  history: { object: '一本遺落的書', hint: '書頁間彷彿有微光流動……' },
  concepts: { object: '一台靜默的終端', hint: '螢幕上游標仍在閃爍……' },
  echoes: { object: '一枚迴響的音叉', hint: '空氣中殘留著微弱的共鳴……' },
  visuals: { object: '一只空白的畫框', hint: '框中似乎映著什麼……' },
  storage: { object: '一疊泛黃的便條', hint: '最上面那張寫了一半……' },
};

interface IslandUnlockObjectProps {
  zoneId: string;
}

export default function IslandUnlockObject({
  zoneId,
}: IslandUnlockObjectProps) {
  const progress = useProgress();
  // 訂閱 auth 變化——canUseIslands 含登入判定（浮島限已登入探索者）
  useReaderAuth();
  const [awakening, setAwakening] = useState(false);

  // zoneId 不是浮島 zone（如 portal）時不渲染
  const def = ISLAND_DEFINITIONS[zoneId as IslandId];
  if (!def) return null;
  const id = def.id;

  // 浮現三關：探索者 + 已到訪 + 尚未解鎖（甦醒動畫進行中例外保留）
  const visible =
    canUseIslands(progress) &&
    hasVisitedZone(progress, id) &&
    (!isIslandUnlocked(progress, id) || awakening);
  if (!visible) return null;

  const lore = UNLOCK_HINTS[id];

  function handleAwaken() {
    if (awakening) return;
    setAwakening(true);
    window.setTimeout(() => {
      unlockIsland(id);
      getIslandRuntime().open(id);
      window.__uepToastManager?.info(`${def.title}甦醒了，加入了你的浮島。`);
      setAwakening(false);
    }, AWAKEN_MS);
  }

  return (
    <button
      type="button"
      className={`uep-unlock-object${awakening ? ' is-awakening' : ''}`}
      onClick={handleAwaken}
      aria-label={`喚醒${def.title}`}
      title={`${lore.object}。${lore.hint}`}
    >
      <span className="uep-unlock-object__glow" aria-hidden />
      <span className="uep-unlock-object__icon" aria-hidden>
        {def.icon}
      </span>
    </button>
  );
}
