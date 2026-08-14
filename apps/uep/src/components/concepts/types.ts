/**
 * Concepts 區域的結構化資料型別
 *
 * 內容階層：Stack → Type → Variation (D1 頁面) → Subcat (嵌入 tab) → Context (嵌入條目)
 * 每個 Stack 有各自的 content 格式與 Reader/Editor 風格。
 */

import type { GateCondition } from '../../progress/gating';

// ── 共用 ──────────────────────────────────────────────────────────

// ── Revision 系統（Epic 2 S7：條目級進度閘） ──────────────────────
//
// Concepts 條目隨讀者的 History 進度演進：同一條目在不同旗標持有
// 狀態下呈現不同內容。設計文件：docs/agent/S7_CONCEPTS_DESIGN.md
//
// - Revision 是 patch 不是 append：可整段替換（set）或移除（remove）欄位
// - Effective view = 按宣告順序套用所有 gate 通過的 revision patch
// - 旗標慣例：`{entityKey}:{stage}`（如 xavier-colsono:01）
// - Variants（era u/e/p）與 Revision 正交：各 variant 的條目維護自己的鏈

/** 單一 Revision 的 patch 操作 */
export interface RevisionPatch {
  /**
   * 欄位級整段替換（key = 欄位路徑，支援 dot-notation 如 'basic.種族'，
   * value = 新內容）。陣列欄位（sections/values/items）一律整段替換。
   */
  set?: Record<string, unknown>;
  /** 欄位刪除（欄位路徑陣列，支援 dot-notation） */
  remove?: string[];
}

/** 單一 Revision 條目 */
export interface ConceptsRevision {
  /** 版本辨識（慣例用對應旗標名，如 'xavier-colsono:01'；base 慣例 'base'） */
  id: string;
  /** 解鎖條件；null = 無條件（base revision） */
  gate: GateCondition | null;
  /** 本 revision 對「前面所有已通過 revision 疊加結果」的 patch */
  patch: RevisionPatch;
}

/** 帶 entityKey 與 revision 鏈的條目包裝（四種 stack 條目共用） */
export interface WithRevision {
  /**
   * 跨 stack 統一實體身分識別碼（kebab-case 小寫英文/數字/連字號）。
   * 範例：'xavier-colsono'、'rain-sea-tower'、'essence'
   * 用途：embed ref（entity:{entityKey}）、terminal 檢索、
   * 旗標命名慣例（{entityKey}:{stage}）、跨 stack 深連。
   * 選填——無深連/解鎖需求的條目可不掛。
   */
  entityKey?: string;
  /**
   * Base 解鎖條件（S7 驗收 #4，2026-07-17 語意修正）：條目可見性的
   * **唯一**閘門——未通過前條目整條隱藏，通過即可見。
   * null / 未定義 = 條目永遠可見。
   * revision gate 對可見性零影響（不能鎖條目、也不能反向開鎖）；
   * dossier 群組 gate 仍為前置 AND。
   * （舊的 baseVisible 欄位已廢除——「無 baseGate = 永遠可見」後
   * 該開關失去意義，舊資料殘留的 key 由 resolver 剝除。）
   */
  gate?: GateCondition | null;
  /**
   * Revision 鏈（宣告順序 = 劇情揭露順序）。
   * 未定義或空陣列 = 內容不隨進度演進。
   * revision gate 只控制各自 patch 的套用時機（通過就疊），
   * 不影響條目本身的可見性（2026-07-17 語意修正）。
   */
  revisions?: ConceptsRevision[];
}

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
  type:
    | 'dossier'
    | 'browser_profile'
    | 'chronograph'
    | 'diff_table'
    | 'rich_text';
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
  /**
   * 群組解鎖條件（S7 驗收 #3）：未通過前整組隱藏（含底下全部條目，
   * 條目自身的 gate/revision 不再求值）。null / 未定義 = 無條件可見。
   */
  gate?: GateCondition | null;
  /** 條目列表 */
  entries: DossierEntry[];
}

export interface DossierEntry extends WithRevision {
  /** 條目名稱 */
  name: string;
  /**
   * 匹配別名（S7-D）：自動偵測與 terminal 檢索的補充匹配詞。
   * 自動拆名（中文全名/中文首段/英文全名）之外的暱稱、異寫由此補充；
   * 姓氏單獨匹配刻意不進預設（家族同姓誤傷），需要時在此顯式列出。
   */
  aliases?: string[];
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

export interface CharacterProfile extends WithRevision {
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

/**
 * 時間軸上的一個時期。
 *
 * chrono stack 是「事件的時序排列」，時期本身不是實體——故不帶 entityKey，
 * 也不參與跨 stack 實體身分體系（同一個角色會在多個時期出現，時期不能
 * 代表他）。實體身分只由 dossier 與 browser 承擔。
 * gate / revisions 仍保留：時期內容可隨劇情進度揭露。
 */
export interface ChronoPeriod extends Omit<WithRevision, 'entityKey'> {
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
  /**
   * 值欄位標籤（如 ['英文', '日文']）——本 section 內所有 entry 的
   * values 依序對位到這些欄位。未定義或空陣列時 UI 退回匿名的
   * 「值 1 / 值 2」呈現，既有單值資料不受影響。
   */
  valueLabels?: string[];
  /** 條目列表 */
  entries: DiffEntry[];
}

/**
 * 對照表條目。
 *
 * diff stack 定位為「一個詞對多個值」的純對照表，不參與跨 stack 實體
 * 身分體系——故不帶 entityKey，也不提供 aliases 匹配詞。名詞解釋類
 * 內容改由 dossier + revision 承擔。
 * gate / revisions 仍保留：譯名可隨劇情進度揭露。
 */
export interface DiffEntry extends Omit<WithRevision, 'entityKey'> {
  /** 術語/詞條名稱 */
  term: string;
  /** 定義或翻譯值（依 section 的 valueLabels 對位） */
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
