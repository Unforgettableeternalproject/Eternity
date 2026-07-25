/**
 * 「不在目錄中的畫廊」的浮現規則（S9-B 解鎖儀式）
 *
 * 決策層抽成純函式——這條規則有五個互相牽扯的條件（切換 vs 剛進來、
 * 資格、分組數、是否已中、機率），埋在 VisualsReader 的 effect 裡既測不到
 * 也讀不出意圖。VisualsReader 只負責把狀態餵進來、把結果寫進 state。
 */

/** 使用者停留的位置：哪個 subcat 的第幾個分類標籤 */
export interface GroupSlot {
  subcatId: string;
  groupIdx: number;
}

/**
 * 「不在目錄中的畫廊」出現機率。
 *
 * 比 Echoes 灰球的 6% 高一個量級——那顆球在播放中每 2~4.5 秒就擲一次骰，
 * 這裡卻要使用者手動切一次標籤才擲一次。同樣不做累加保底（fallback 的
 * 解鎖小物件仍在，不會有人被永久卡住）。
 */
export const PHANTOM_GALLERY_CHANCE = 0.18;

export interface PhantomRollInput {
  /** 上一次停留的位置；null = 剛掛載，還沒有「上一次」 */
  prev: GroupSlot | null;
  /** 目前停留的位置；null = 不在 subcat 頁 */
  current: GroupSlot | null;
  /** 是否有資格解鎖浮動幻影 */
  eligible: boolean;
  /** 這個 subcat 有幾個分類標籤 */
  groupCount: number;
  /** 本次停留的 subcat 是否已經中過 */
  alreadyWon: boolean;
  /** 擲骰函式（測試可注入） */
  random?: () => number;
}

/**
 * 判斷這次位置變化該不該讓特別的畫廊浮現。
 *
 * 四道門，全過才擲骰：
 * 1. **確實是切換標籤**——同一個 subcat 內換了 groupIdx。首次進入不算：
 *    艾斯維爾的設計是「切標籤的時候有機會出現」，一進來就撞見會失去那個
 *    翻找的動作。換 subcat 也不算（那是換區塊不是換標籤）。
 * 2. 有解鎖資格
 * 3. 這個區塊有兩個以上分類標籤（艾斯維爾明確限定）
 * 4. 這輪還沒中過
 */
export function shouldRevealPhantomCard(input: PhantomRollInput): boolean {
  const {
    prev,
    current,
    eligible,
    groupCount,
    alreadyWon,
    random = Math.random,
  } = input;

  if (!current || !prev) return false;
  const switchedTab =
    prev.subcatId === current.subcatId && prev.groupIdx !== current.groupIdx;
  if (!switchedTab) return false;
  if (!eligible) return false;
  if (groupCount <= 1) return false;
  if (alreadyWon) return false;

  return random() < PHANTOM_GALLERY_CHANCE;
}
