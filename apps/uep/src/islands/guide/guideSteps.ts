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

/**
 * 其餘四島各兩步，只講自己的功能。
 *
 * 「可以拖曳、可以收回停靠列」只寫在 History 那一步——那是所有島共通的
 * 視窗行為，學一次就會，五座島各講一次是噪音。History 幾乎必然是第一座
 * 解鎖的島（唯一有專屬儀式從 S6 就存在的），適合承擔這件事。
 *
 * 指向的元素若因狀態而不存在（沒在播放的回聲、還沒投影的幻影），該步會
 * 自動降級成置中卡，文案仍然成立——這是可接受的降級，不是故障。
 */
const GUIDE_STEPS: Partial<Record<IslandId, GuideStep[]>> = {
  history: HISTORY_STEPS,

  concepts: [
    {
      anchor: within('concepts', '.uep-terminal__input'),
      title: '直接打字問它',
      body: '輸入 query 加上名字就能查詢已知的條目，ls 列出有哪些。Tab 會補完你打到一半的字。',
    },
    {
      anchor: within('concepts', '.uep-terminal__body'),
      title: '回應留在這裡',
      body: '查詢結果會往下堆疊，可以往回捲。指向條目的那幾行是可以點的，會帶你到完整的檔案。',
    },
  ],

  echoes: [
    {
      anchor: within('echoes', '.uep-eisland__stage'),
      title: '聲音跟著你走',
      body: '正在播的曲子不會因為換頁而中斷。收藏過的回聲都能從這裡回放。',
    },
    {
      anchor: within('echoes', '.uep-eisland__controls'),
      title: '播放與音量',
      body: '偶爾會有一顆灰色的球體浮出來——那是還沒被收藏的回聲，點它就收下了。',
    },
  ],

  visuals: [
    {
      anchor: within('visuals', '.uep-visland__stage'),
      title: '投影台',
      body: '被展示的畫會投在這裡，跟著你到任何一頁。在別的區域讀到相關的段落時，它會自己亮起來。',
    },
    {
      anchor: within('visuals', '.uep-visland__strip'),
      title: '同一組畫作',
      body: '同一個展間的其他畫在下方排開，點縮圖就能換。還沒解鎖的不會出現在這裡。',
    },
  ],

  storage: [
    {
      anchor: within('storage', '.uep-stoland__form'),
      title: '隨手記下來',
      body: '想到什麼就寫在這裡，跟著帳號走，換裝置也還在。從內文把名字拖進來會自動填好。',
    },
    {
      anchor: within('storage', '.uep-stoland__list'),
      title: '便條可以釘出去',
      body: '每張便條都能標上當時的地點與時間。釘住的便條會留在畫面上，離開這座島也看得到。',
    },
  ],
};

/** 沒有教學的島回空陣列——呼叫端據此跳過，不必個別判斷 */
export function getGuideSteps(id: IslandId): GuideStep[] {
  return GUIDE_STEPS[id] ?? [];
}

export function hasGuide(id: IslandId): boolean {
  return getGuideSteps(id).length > 0;
}
