/**
 * 網站首頁可編輯內容的型別定義
 * 對應 D1 site_homepage 表的 JSON 結構
 *
 * 設計原則：
 * - 結構欄位（kicker, title, zone meta）= 簡單字串，影響版面佈局
 * - body = TipTap HTML 富文本，包含段落、UEP 對話、富文本格式
 * - 前端用 renderHtmlWithUep 渲染 body
 */

// ── Hero 區塊 ──

export interface HeroContent {
  /** 頂部裝飾標籤 */
  kicker: string;
  /** 主標題 */
  titleMain: string;
  /** 主標題斜體強調字 */
  titleAccent: string;
  /** 英文副標 */
  subtitleEn: string;
  /** 描述段落 + UEP 對話（TipTap HTML） */
  body: string;
  /** 按鈕文字 */
  buttons: {
    openMap: string;
    startJourney: string;
    admin: string;
  };
}

// ── Atlas 區塊（純結構欄位，無 TipTap）──

export interface AtlasContent {
  kicker: string;
  title: string;
  hint: string;
}

// ── 旅程入口 ──

export interface JourneyContent {
  kicker: string;
  title: string;
  /** 旁白段落 + UEP 台詞（TipTap HTML） */
  body: string;
}

// ── Zone 區塊（×5）──

export interface ZoneMetaContent {
  label: string;
  en: string;
  kicker: string;
  blurb: string;
  atmos: string;
  glyphs: string[];
  uepShort: string[];
  stats: Record<string, number>;
}

export interface ZoneSectionContent {
  /** 影響卡片 / 導航的結構資料 */
  meta: ZoneMetaContent;
  /** 旅程場景敘事（TipTap HTML） */
  body: string;
}

// ── 永恆之詩 ──

export interface VerseContent {
  kicker: string;
  title: string;
  inscription: string;
  /** 詩句（TipTap HTML，含富文本格式：粗體、斜體、金色關鍵字、分隔線） */
  body: string;
}

// ── 全部首頁資料 ──

export interface HomepageData {
  hero?: HeroContent;
  atlas?: AtlasContent;
  journey?: JourneyContent;
  'zone-history'?: ZoneSectionContent;
  'zone-echoes'?: ZoneSectionContent;
  'zone-visuals'?: ZoneSectionContent;
  'zone-concepts'?: ZoneSectionContent;
  'zone-storage'?: ZoneSectionContent;
  verse?: VerseContent;
}

/** API 回傳格式：每個 section 包裹在 { content, updatedAt } 裡 */
export type HomepageApiResponse = {
  [K in keyof HomepageData]: {
    content: NonNullable<HomepageData[K]>;
    updatedAt: string;
  };
};

/** 從 API 回傳中提取純內容（去掉 updatedAt 包裝） */
export function extractHomepageData(
  api: Partial<HomepageApiResponse>
): HomepageData {
  const result: HomepageData = {};
  for (const [key, val] of Object.entries(api)) {
    if (val && 'content' in val) {
      (result as Record<string, unknown>)[key] = val.content;
    }
  }
  return result;
}
