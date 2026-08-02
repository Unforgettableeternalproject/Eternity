/**
 * 浮島教學的步驟骨架與文案（S10-4 C 段）
 *
 * 同一個檔案但概念上分兩層：**哪幾步、指向哪個元素**屬於程式結構（那是
 * DOM 事實，島改版就要跟著改）；**說什麼**是文案。改文案不該需要碰
 * `anchor`。
 *
 * 文案硬編碼、不進後台：一島 2–3 句，寫定就不太動，為此開一張表 + 一個
 * 分頁 + 一組 CRUD 端點不划算（艾斯維爾 2026-08-02）。
 */

import type { IslandId } from '../types';

export interface GuideStep {
  /**
   * 指向的元素。**是函式不是 selector 字串**——島可拖曳、內容會隨資料
   * 變化，位置要在每步進場時現算。回不到元素時該步降級為無聚光燈的置中卡。
   */
  anchor: () => Element | null;
  title: string;
  body: string;
}

/** 島的根節點。IslandHost 給每座島掛了 `uep-island--{id}` */
export function islandRoot(id: IslandId): Element | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`.uep-island--${id}`);
}

/** 島內元素。查不到回 null，該步自然降級成置中卡 */
function within(id: IslandId, selector: string): () => Element | null {
  return () => islandRoot(id)?.querySelector(selector) ?? null;
}

const HISTORY_STEPS: GuideStep[] = [
  {
    anchor: within('history', '.uep-hisland__resume-btn'),
    title: '書籤停在這裡',
    body: '你最後讀到的位置會留在這裡。從任何一頁按下它，都能回到那個段落。',
  },
  {
    anchor: within('history', '.uep-hisland__chapters'),
    title: '典藏目錄',
    body: '已經走過的篇章會在這裡展開，數字是那一卷讀完的頁數。還沒開啟的部分不會出現。',
  },
  {
    anchor: () => islandRoot('history'),
    title: '它可以移動',
    body: '拖曳上緣就能把書挪到順手的地方，位置會記住。右上角收起來後，它會回到畫面邊緣的停靠列。',
  },
];

const GUIDE_STEPS: Partial<Record<IslandId, GuideStep[]>> = {
  history: HISTORY_STEPS,
};

/** 沒有教學的島回空陣列——呼叫端據此跳過，不必個別判斷 */
export function getGuideSteps(id: IslandId): GuideStep[] {
  return GUIDE_STEPS[id] ?? [];
}

export function hasGuide(id: IslandId): boolean {
  return getGuideSteps(id).length > 0;
}
