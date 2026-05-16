/**
 * Concepts 區域的結構化資料型別
 *
 * 內容階層：Stack → Type → Variation (D1 頁面) → Subcat (嵌入 tab) → Context (嵌入條目)
 * 每個 Stack 有各自的 content 格式與 Reader/Editor 風格。
 */

// ── 共用 ──────────────────────────────────────────────────────────

/** 所有 variation 頁面的 metadata 結構 */
export interface ConceptsVariationMeta {
  /** 類型群組 ID（不含 era），如 "character_list" */
  type_group: string;
  /** 時代代號，如 "u" | "e" | "p" */
  era: string;
  /** 所屬 stack 的閱讀器風格 */
  stack_style: 'dossier' | 'browser' | 'chrono' | 'diff';
  /** 前端可見的圖示 */
  icon?: string;
  /** 頁面描述 */
  description?: string;
  /** 是否隱藏 */
  hidden?: boolean;
}

/** D1 content 欄位中單一 block 的結構（與其他區域相同） */
export interface ConceptsContentBlock {
  id: string;
  type: 'dossier' | 'browser_profile' | 'chronograph' | 'diff_table' | 'rich_text';
  /** JSON.stringify 過的結構化資料 */
  content: string;
}

// ── Stack 定義 ─────────────────────────────────────────────────────

export interface StackDef {
  id: string;
  slug: string;
  label: string;
  labelEn: string;
  icon: string;
  style: 'dossier' | 'browser' | 'chrono' | 'diff';
  intro: string;
  uepNote: string;
}

// ── 1. Records — Dossier ──────────────────────────────────────────

/**
 * 人物列表、地區列表等「條目型」頁面的內容。
 *
 * 多 variant 結構：同一個 type（如 character_list）可能因不同故事/時代
 * 而有不同的資料集（U/E/P 等），每個 variant 各自獨立。
 */
export interface DossierContent {
  /**
   * 變體列表。第一個 variant 為預設顯示。
   * 至少要有一個 variant；若解析到舊版（直接 subcategories）會自動包成
   * 單一 variant（id: 'default', label: 'DEFAULT'）。
   */
  variants: DossierVariant[];
}

export interface DossierVariant {
  /** 變體識別碼（自由命名，慣例為小寫 era，如 'u'/'e'/'p'） */
  id: string;
  /** 顯示用標籤（會顯示在 reader 標題旁的循環按鈕中，慣例為大寫） */
  label: string;
  /** 各 tab 分類 */
  subcategories: DossierSubcat[];
}

export interface DossierSubcat {
  /** tab 標題，如「三區」 */
  label: string;
  /** 分組（如派系、象限等） */
  groups: DossierGroup[];
}

export interface DossierGroup {
  /** 群組標題，如「無組織」「政府相關」 */
  label: string;
  /** 條目列表 */
  entries: DossierEntry[];
}

export interface DossierEntry {
  /** 條目名稱 */
  name: string;
  /** 富文本描述（各列表內容不同，由用戶自由填寫） */
  content_html?: string;
  /** 劇透等級 0-3 */
  spoiler?: number;
}

// ── 2. Browser — Character Profiles ──────────────────────────────

/** 角色詳細檔案頁面的內容 */
export interface BrowserContent {
  /** 分類樹定義（用於 Reader 的層級篩選 UI） */
  category_tree?: TagNode[];
  /** 角色檔案列表 */
  profiles: CharacterProfile[];
}

/** 層級標籤節點，用於分類過濾（如 era → faction → group） */
export interface TagNode {
  /** 標籤名稱 */
  label: string;
  /** 子標籤 */
  children?: TagNode[];
}

/** 角色檔案中的自定義區段 */
export interface ProfileSection {
  /** 區段標題（如「內在特質」「角色背景」「角色解析」） */
  label: string;
  /** 富文本內容 */
  content_html: string;
}

export interface CharacterProfile {
  /** 角色全名 */
  name: string;
  /** 分類路徑（從根到葉，如 ['U時代', '三區', '無組織']） */
  categories?: string[];
  /** 是否為佔位符 */
  placeholder?: boolean;
  /** 角色頭像圖片（R2 asset key，如 'images/avatar-xxx.png'） */
  avatar?: string;
  /** 基本資料欄位（短欄位，如種族、生日等） */
  basic?: Record<string, string>;
  /** 自定義區段（由用戶自由建立，取代固定的 personality/background/analysis） */
  sections?: ProfileSection[];
  /** 劇透等級 */
  spoiler?: number;
}

// ── 3. Oscillator — Chronograph ──────────────────────────────────

/** 時間軸頁面的內容 */
export interface ChronoContent {
  /** 欄位類別定義（可擴充，pool 級共用） */
  fieldDefs: ChronoFieldDef[];
  /** 時間節點池 */
  periods: ChronoPeriod[];
}

/** 欄位類別定義 */
export interface ChronoFieldDef {
  /** 唯一 ID（如 'main', 'regional', 'character'） */
  id: string;
  /** 圖示 */
  icon: string;
  /** 標題（如「主線事件 / 核心敘事」） */
  label: string;
  /** 'flat' = 純條列事件, 'grouped' = 帶子分組的條列（如區域動態） */
  style: 'flat' | 'grouped';
}

/** 時期代號 */
export type ChronoEra = 'pre-ad' | 'ad' | 'fa' | 'nw';

export interface ChronoPeriod {
  /** 時期代號 */
  era: ChronoEra;
  /** 年份數字 */
  yearNum: number;
  /** 顯示用年份字串（由 era + yearNum 生成，也供 Reader 向後相容） */
  year: string;
  /** 標題（選填） */
  title?: string;
  /** 各欄位的內容，key = fieldDef.id */
  fields: Record<string, ChronoField>;
}

/** 單一欄位的內容 */
export interface ChronoField {
  /** flat 模式：直接條列 */
  items?: string[];
  /** grouped 模式：分組條列（如各區域） */
  groups?: ChronoFieldGroup[];
}

/** 分組內的條列（如「三區」下的事件） */
export interface ChronoFieldGroup {
  /** 分組名稱（如「三區」「五區」） */
  label: string;
  /** 事件列表 */
  items: string[];
}

/** @deprecated 舊格式相容，遷移後移除 */
export interface ChronoSection {
  icon: string;
  label: string;
  events: string[];
}

// ── 4. Compare — Diff Tables ─────────────────────────────────────

/** 對照表/術語解釋頁面的內容 */
export interface DiffContent {
  /** 各 tab 分類 */
  subcategories: DiffSubcat[];
}

export interface DiffSubcat {
  /** tab 標題，如「理論」「技術」 */
  label: string;
  /** 內容區塊（可以是表格或術語列表） */
  sections: DiffSection[];
}

export interface DiffSection {
  /** 區段標題（group 標題），如「未被歸類」 */
  label: string;
  /** 條目列表 */
  entries: DiffEntry[];
}

export interface DiffEntry {
  /** 術語/詞條名稱 */
  term: string;
  /** 定義或翻譯值（多欄時為陣列） */
  values: string[];
  /** 劇透等級 */
  spoiler?: number;
  /** 是否隱藏（故事中尚未出現的概念） */
  hidden?: boolean;
  /** 是否鎖定（已出現但尚未解釋的概念） */
  locked?: boolean;
}

// ── 共用輔助型別 ──────────────────────────────────────────────────

/** content block 的聯合型別 */
export type ConceptsData =
  | DossierContent
  | BrowserContent
  | ChronoContent
  | DiffContent;

/** 從 JSON 字串解析 content block */
export function parseConceptsContent(
  block: ConceptsContentBlock
): ConceptsData | null {
  try {
    return JSON.parse(block.content) as ConceptsData;
  } catch {
    return null;
  }
}
