/**
 * 「不在目錄中的畫廊」的浮現規則（S9-B 解鎖儀式）
 *
 * 決策層抽成純函式——這條規則有數個互相牽扯的條件（進來 vs 切標籤、資格、
 * 是否已中、機率），埋在 VisualsReader 的 effect 裡既測不到也讀不出意圖。
 * VisualsReader 只負責把狀態餵進來、把結果寫進 state。
 */

import { getSetting } from '../../lib/uepSettings';

/** 使用者停留的位置：哪個 subcat 的第幾個分類標籤 */
export interface GroupSlot {
  subcatId: string;
  groupIdx: number;
}

/**
 * 進入一個區塊時的浮現機率。
 *
 * S9-B 原設計只在「切換分類標籤」時擲骰，且限定兩個標籤以上的區塊——
 * 結果是單標籤區塊永遠擲不到，而 fallback 的解鎖小物件當時是關著的，
 * 那些區塊就成了解不開的死路（Codex 2026-07-25 review）。
 * 艾斯維爾 07/25 定案：**每個區塊都要擲得到**，切標籤只是加碼。
 */
export const PHANTOM_ENTER_CHANCE = 0.08;

/**
 * 在多標籤區塊裡切換分類標籤時的浮現機率。
 *
 * 比進入時高一個量級——切標籤是使用者主動翻找的動作，那是最適合讓東西
 * 「剛好被翻出來」的時機。比 Echoes 灰球的 6% 高，是因為那顆球在播放中
 * 每 2~4.5 秒就自己擲一次，這裡卻要人動手才擲一次。
 */
export const PHANTOM_SWITCH_CHANCE = 0.18;

/** @deprecated 沿用舊名的呼叫端請改用 PHANTOM_SWITCH_CHANCE */
export const PHANTOM_GALLERY_CHANCE = PHANTOM_SWITCH_CHANCE;

/*
 * 兩個常數是**預設值**；實際生效的是站台設定
 * `visuals.phantomEnterChancePct` / `visuals.phantomSwitchChancePct`
 * （整數百分比，8 = 8%），設定未載入時退回常數。換算在這兩個函式裡做，
 * 判定本體維持純函式（測試注入 random 的形狀不變）。
 */

/** 進入區塊時的現行機率（0–1） */
export function phantomEnterChance(): number {
  return (
    getSetting('visuals.phantomEnterChancePct', PHANTOM_ENTER_CHANCE * 100) /
    100
  );
}

/** 切換分類標籤時的現行機率（0–1） */
export function phantomSwitchChance(): number {
  return (
    getSetting('visuals.phantomSwitchChancePct', PHANTOM_SWITCH_CHANCE * 100) /
    100
  );
}

export interface PhantomRollInput {
  /** 上一次停留的位置；null = 剛掛載，還沒有「上一次」 */
  prev: GroupSlot | null;
  /** 目前停留的位置；null = 不在 subcat 頁 */
  current: GroupSlot | null;
  /** 是否有資格解鎖浮動幻影 */
  eligible: boolean;
  /** 本次停留的 subcat 是否已經中過 */
  alreadyWon: boolean;
  /** 擲骰函式（測試可注入） */
  random?: () => number;
}

/**
 * 判斷這次位置變化該不該讓特別的畫廊浮現。
 *
 * 兩種擲骰時機（其餘情況一律不擲）：
 * - **進入一個區塊**（剛掛載，或從別的 subcat 換過來）→ `PHANTOM_ENTER_CHANCE`
 * - **在同一區塊內切換分類標籤** → `PHANTOM_SWITCH_CHANCE`（較高）
 *
 * 前置條件：有解鎖資格、這輪還沒中過。
 */
export function shouldRevealPhantomCard(input: PhantomRollInput): boolean {
  const { prev, current, eligible, alreadyWon, random = Math.random } = input;

  if (!current) return false;
  if (!eligible) return false;
  if (alreadyWon) return false;

  const sameSubcat = prev !== null && prev.subcatId === current.subcatId;
  if (sameSubcat) {
    // 同一區塊內：只有真的換了標籤才擲（同一格重渲染不該一直擲骰）
    if (prev.groupIdx === current.groupIdx) return false;
    return random() < phantomSwitchChance();
  }

  // 換區塊或剛進來
  return random() < phantomEnterChance();
}
