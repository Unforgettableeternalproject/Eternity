/**
 * UEP 浮島系統 — 解鎖小物件
 *
 * 各 zone 首頁的「特別的小物件」：到訪過該 zone 的 Reader（zone:visited:*）
 * 後才浮現，點擊喚醒對應浮島（授予解鎖 + 甦醒動畫 + 首次展開）。
 *
 * 浮現條件（三關）：探索者視角 + 已到訪 + 尚未解鎖。
 * 解鎖後小物件消失——它「變成」了浮島。
 *
 * **S9-B 起本元件是 fallback**：各 zone 已有專屬解鎖儀式（concepts 斷線終端、
 * echoes 迷失灰球、visuals 特別畫廊、storage 孤零零紙條），但那些儀式多半帶
 * 機率或特定頁面條件，使用者有可能長期遇不到（最明顯的是 visuals——該區塊
 * 沒有兩個以上分類標籤就不會觸發）。艾斯維爾 2026-07-25 定案保留本元件當
 * 保底入口，不移除。
 */

import React, { useState } from 'react';

import { ISLAND_DEFINITIONS } from './types';
import type { IslandId } from './types';
import {
  AWAKEN_MS,
  completeUnlockRitual,
  useUnlockEligibility,
} from './unlockRitual';

import './islands.css';

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
  // 資格判定（含 auth／viewport 訂閱）統一走 unlockRitual primitive
  const { eligible, canUse, visited } = useUnlockEligibility(zoneId);
  const [awakening, setAwakening] = useState(false);

  // zoneId 不是浮島 zone（如 portal）時不渲染
  const def = ISLAND_DEFINITIONS[zoneId as IslandId];
  if (!def) return null;
  const id = def.id;

  // 浮現＝有資格；甦醒動畫進行中例外保留（此時已解鎖、eligible 已翻假）
  const visible = eligible || (awakening && canUse && visited);
  if (!visible) return null;

  const lore = UNLOCK_HINTS[id];

  function handleAwaken() {
    if (awakening) return;
    setAwakening(true);
    window.setTimeout(() => {
      completeUnlockRitual(id);
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
