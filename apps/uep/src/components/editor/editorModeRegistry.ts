/**
 * editorModeRegistry — 集中管理所有編輯器模式的分派、序列化、渲染
 *
 * RichEditor 只負責 shell（header / toolbar / tree / inspector），
 * 具體的內容解析、序列化、渲染由 registry 中對應的 mode 決定。
 */

// ── 型別定義 ─────────────────────────────────────────────────

export interface ContentBlock {
  id: string;
  type: string;
  content: string;
}

export interface EditorModeContext {
  area: string;
  zoneId: string;
  pageType: string;
  pageSlug: string;
}

/**
 * Inspector PROGRESS GATE 面板分級（S8 下半場 V-B.18，艾斯維爾 07/19 定案）：
 * - full    — 全套（progress page / exempt from container / 條件欄位）
 * - minimal — 只留必要條件欄位（requires completion / custom flag /
 *             pristine only）；progressPage 與容器繼承是 tree 專屬欄位，
 *             對媒體 zone 無意義
 * - none    — 整塊移除
 *
 * 僅動 UI：各 Reader 對既有 metadata.gate 的求值行為不變。
 */
export type GatePanelMode = 'full' | 'minimal' | 'none';

export interface EditorModeDefinition {
  id: string;
  /** 比對函式：給定 context，回傳是否匹配 */
  match: (ctx: EditorModeContext) => boolean;
  /** 是否需要 TipTap 編輯器渲染（false 時 toolbar 隱藏） */
  needsTipTap: boolean;
  /** toolbar 右側顯示的模式名稱 */
  toolbarLabel: string;
  /** 是否需要 subcategory 選擇器（Storage stuff 頁面） */
  needsSubcatSelector?: boolean;
  /** PROGRESS GATE 面板分級；未設定時依 area 規則 fallback */
  gatePanelMode?: GatePanelMode;
}

// ── Mode 定義 ────────────────────────────────────────────────

const modes: EditorModeDefinition[] = [
  {
    id: 'echoes.song',
    match: (ctx) =>
      (ctx.area === 'echoes' || ctx.zoneId === 'echoes') &&
      ctx.pageType === 'song',
    needsTipTap: false,
    toolbarLabel: 'song mode',
    gatePanelMode: 'minimal',
  },
  {
    id: 'echoes.subcategory',
    match: (ctx) =>
      (ctx.area === 'echoes' || ctx.zoneId === 'echoes') &&
      ctx.pageType === 'subcategory',
    needsTipTap: true,
    toolbarLabel: 'playlist mode',
    gatePanelMode: 'minimal',
  },
  {
    id: 'visuals.gallery',
    match: (ctx) =>
      (ctx.area === 'visuals' || ctx.zoneId === 'visuals') &&
      ctx.pageType === 'gallery',
    needsTipTap: false,
    toolbarLabel: 'gallery mode',
    gatePanelMode: 'minimal',
  },
  {
    id: 'visuals.subcategory',
    match: (ctx) =>
      (ctx.area === 'visuals' || ctx.zoneId === 'visuals') &&
      ctx.pageType === 'subcategory',
    needsTipTap: true,
    toolbarLabel: 'subcategory mode',
    gatePanelMode: 'minimal',
  },
  {
    id: 'visuals.division',
    match: (ctx) =>
      (ctx.area === 'visuals' || ctx.zoneId === 'visuals') &&
      ctx.pageType === 'division',
    needsTipTap: true,
    toolbarLabel: 'division mode',
    gatePanelMode: 'minimal',
  },
  {
    id: 'concepts.type',
    match: (ctx) =>
      (ctx.area === 'concepts' || ctx.zoneId === 'concepts') &&
      ctx.pageType === 'type',
    needsTipTap: true,
    toolbarLabel: 'concepts type mode',
    gatePanelMode: 'none',
  },
  {
    id: 'storage.dialogue',
    match: (ctx) =>
      (ctx.area === 'storage' || ctx.zoneId === 'storage') &&
      ctx.pageType === 'stuff' &&
      ctx.pageSlug.startsWith('boxes/'),
    needsTipTap: false,
    toolbarLabel: 'dialogue mode',
    gatePanelMode: 'none',
    needsSubcatSelector: true,
  },
  {
    id: 'storage.changelog',
    match: (ctx) =>
      (ctx.area === 'storage' || ctx.zoneId === 'storage') &&
      ctx.pageType === 'stuff' &&
      ctx.pageSlug.startsWith('changelog/'),
    needsTipTap: false,
    toolbarLabel: 'changelog mode',
    gatePanelMode: 'none',
  },
  {
    id: 'storage.extras',
    match: (ctx) =>
      (ctx.area === 'storage' || ctx.zoneId === 'storage') &&
      ctx.pageType === 'stuff' &&
      ctx.pageSlug.startsWith('extras/'),
    needsTipTap: true,
    toolbarLabel: 'extras mode',
    gatePanelMode: 'none',
    needsSubcatSelector: true,
  },
  {
    id: 'storage.clearing',
    match: (ctx) =>
      (ctx.area === 'storage' || ctx.zoneId === 'storage') &&
      ctx.pageType === 'clearing',
    needsTipTap: true,
    toolbarLabel: 'clearing mode',
    gatePanelMode: 'none',
  },
  {
    id: 'zone',
    match: (ctx) => ctx.pageType === 'zone',
    needsTipTap: true,
    toolbarLabel: 'zone mode',
  },
  {
    id: 'homepage',
    match: (ctx) => ctx.pageType === 'page' || ctx.pageType === 'homepage',
    needsTipTap: true,
    toolbarLabel: 'homepage mode',
  },
  {
    id: 'default',
    match: () => true,
    needsTipTap: true,
    toolbarLabel: 'rich text',
  },
];

/** 從 context 解析對應的 editor mode */
export function resolveEditorMode(
  ctx: EditorModeContext
): EditorModeDefinition {
  return modes.find((m) => m.match(ctx)) || modes[modes.length - 1];
}

/**
 * 各 area 的 PROGRESS GATE 面板分級 fallback（共用 mode——zone/homepage/
 * default——依所屬 area 分派）。未列出的 area（如站台 homepage）維持
 * full，行為與分級前一致。
 */
const AREA_GATE_PANEL_MODES: Record<string, GatePanelMode> = {
  history: 'full',
  echoes: 'minimal',
  visuals: 'minimal',
  concepts: 'none',
  storage: 'none',
};

/**
 * 解析 PROGRESS GATE 面板分級：mode 自身的 gatePanelMode 優先，
 * 否則依 area 規則，最後 fallback full（不影響未分級的區域）。
 * RichEditor gateFields 是唯一注入點；Echoes Spoiler Gate 卡與
 * Concepts baseGate 的獨立 GateConditionEditor 呼叫不受影響。
 */
export function resolveGatePanelMode(ctx: EditorModeContext): GatePanelMode {
  const mode = resolveEditorMode(ctx);
  if (mode.gatePanelMode) return mode.gatePanelMode;
  const area = ctx.area || ctx.zoneId;
  return AREA_GATE_PANEL_MODES[area] ?? 'full';
}

// ── 輔助查詢 ────────────────────────────────────────────────

/** 取得所有已註冊的 mode ID */
export function getAllModeIds(): string[] {
  return modes.map((m) => m.id);
}

/** 根據 mode ID 取得定義 */
export function getModeById(id: string): EditorModeDefinition | undefined {
  return modes.find((m) => m.id === id);
}

// ── Page Tree 相關規則 ──────────────────────────────────────

/** pageType → 顯示字母 */
export const TYPE_LETTERS: Record<string, string> = {
  zone: 'Z',
  chapter: 'C',
  arc: 'A',
  section: 'S',
  page: 'P',
  homepage: 'HP',
  cluster: 'CL',
  subcategory: 'SC',
  song: '♪',
  division: 'DV',
  gallery: 'GA',
  stack: 'ST',
  type: 'TP',
  clearing: 'CL',
  stuff: 'SF',
  context: 'CX',
};

/** 不可拖動排序的 pageType */
export const NO_DRAG_TYPES = new Set([
  'page',
  'homepage',
  'zone',
  'cluster',
  'division',
  'type',
  'clearing',
]);

/** 不可新增子頁面的 pageType */
export const NO_CHILDREN_TYPES = new Set([
  'song',
  'gallery',
  'type',
  'stuff',
  'context',
]);

/** 不顯示在 tree 中的 pageType（由 subcategory editor 管理） */
export const TREE_HIDDEN_TYPES: Record<string, Set<string>> = {
  echoes: new Set(['song']),
  visuals: new Set(['gallery']),
};

/** 不顯示 hover insert zones 的 area */
export const NO_INSERT_ZONE_AREAS = new Set(['echoes', 'visuals']);

/** 各區域可用的頁面類型 */
export const AREA_PAGE_TYPES: Record<
  string,
  { value: string; label: string }[]
> = {
  history: [
    { value: 'page', label: 'Page' },
    { value: 'zone', label: 'Zone' },
    { value: 'chapter', label: 'Chapter' },
    { value: 'arc', label: 'Arc' },
    { value: 'section', label: 'Section' },
  ],
  echoes: [
    { value: 'page', label: 'Page' },
    { value: 'cluster', label: 'Cluster (集群)' },
    { value: 'subcategory', label: 'Subcategory (子分類)' },
    { value: 'song', label: 'Song (歌曲)' },
  ],
  visuals: [
    { value: 'division', label: 'Division (分館)' },
    { value: 'subcategory', label: 'Subcategory (子分類)' },
    { value: 'gallery', label: 'Gallery (畫廊)' },
  ],
  concepts: [
    { value: 'stack', label: 'Stack (模組)' },
    { value: 'type', label: 'Type (分類)' },
    { value: 'subcategory', label: 'Subcategory (子分類)' },
    { value: 'context', label: 'Context (內容)' },
  ],
  storage: [
    { value: 'clearing', label: 'Clearing (空地)' },
    { value: 'stuff', label: 'Stuff (內容)' },
    { value: 'subcategory', label: 'Subcategory (子分類)' },
  ],
};

export const DEFAULT_PAGE_TYPES = [
  { value: 'page', label: 'Page' },
  { value: 'zone', label: 'Zone' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'section', label: 'Section' },
];

/** 新增子頁面時的預設 pageType 推導 */
export function getDefaultChildPageType(
  area: string,
  parentPageType: string
): string {
  if (area === 'concepts' && parentPageType === 'stack') return 'type';
  if (area === 'storage' && parentPageType === 'clearing') return 'stuff';
  return 'section';
}
