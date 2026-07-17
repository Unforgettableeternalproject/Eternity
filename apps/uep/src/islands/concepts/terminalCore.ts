/**
 * Terminal Island — 查詢核心（Epic 2 S7-C）
 *
 * 純函式 + 資料層：索引載入、關鍵字檢索、stack 列表、條目內容解析。
 * 不碰 React、不碰 DOM——UI 接線見 TerminalIsland.tsx，
 * 組織比照 history/historyIslandData.ts（island 資料層前例）。
 *
 * 資料流（設計文件「Sub-session C 開工前定案」）：
 * - 索引：GET /api/concepts/entity-index（輕量摘要，含 revision gate）
 *   → 模組級 promise 快取。索引不因旗標變化重建——gate 摘要已在手上，
 *   解鎖過濾即時求值（定案 B 的自然結果；「flags 變化 invalidate」
 *   是端點定案前的舊設計，已不適用）
 * - 條目內容：命中後按需抓整頁 JSON → revision resolver 抽 effective view
 *   → 剝 HTML 截短。Terminal 不持有完整內容（設計文件 6-1）
 *
 * 解鎖語意（與 revision.ts resolveEntries 完全一致）：
 * - 未解鎖條目 = 從 query/ls 隱藏（dossier「未解鎖=隱藏」定案）
 * - browser placeholder 靠 base 無 gate 保持可見，佔位鎖定由
 *   effective view 的 placeholder 欄位表達 → restricted 呈現
 * - access restricted 是資料失誤的 fallback（劇情節奏理論上不會觸發）
 */

import { evaluateGate } from '../../progress/gating';
import type { GateCondition } from '../../progress/gating';
import type { ProgressState } from '../../progress/types';
import {
  applyRevisions,
  isEntryUnlocked,
  isBrowserContent,
  isChronoContent,
  isDiffContent,
  isDossierContent,
} from '../../components/concepts/revision';
import type {
  CharacterProfile,
  ChronoPeriod,
  ConceptsData,
  ConceptsRevision,
  DiffEntry,
  DossierEntry,
} from '../../components/concepts/types';
import { getApiBase } from '../../lib/apiBase';

// ── 型別 ───────────────────────────────────────────────────────────

export type TerminalStack = 'dossier' | 'browser' | 'chrono' | 'diff';

/** 索引端點的單筆條目摘要（Worker EntityIndexEntry 的前端鏡像） */
export interface TerminalIndexEntry {
  name: string;
  stack: TerminalStack;
  pageId: string;
  pageTitle: string;
  entityKey?: string;
  /** 匹配別名（S7-D-2：query / 補全的補充匹配詞） */
  aliases?: string[];
  /** base 解鎖條件（S7 驗收 #4：條目本身的可見閘門） */
  baseGate?: GateCondition | null;
  /** base 預設顯示：true 時條目不受 base/revision gate 影響（群組 gate 仍前置） */
  baseVisible?: boolean;
  /** 群組解鎖條件（S7 驗收 #3：dossier 群組層，未過整組隱藏） */
  groupGate?: GateCondition | null;
  revisionGates?: { id: string; gate: GateCondition | null }[];
  /** 分類標籤（dossier=subcategory、diff=subcat）——ls 分組用 */
  category?: string;
  /** 群組標籤（dossier=group、diff=section） */
  group?: string;
  /** dossier variant id（era，如 'u'） */
  variantId?: string;
  /** chrono period 事件總數（ls clock 顯著時代排序用） */
  eventCount?: number;
}

/** 條目內容解析結果（Terminal 輸出行的資料來源） */
export interface TerminalEntryDetail {
  name: string;
  stack: TerminalStack;
  pageId: string;
  pageTitle: string;
  /** 條目敘述（已剝 HTML、截短），一項一行 */
  summary: string[];
  /** dossier variant 標示（如 'u'），僅 dossier 有 */
  variantId?: string;
  /** access restricted（placeholder / locked / 資料失誤 fallback） */
  restricted?: boolean;
}

/** stack 指令簡稱 → stack_style（設計文件 6-3） */
export const TERMINAL_STACK_ALIASES: Record<string, TerminalStack> = {
  log: 'dossier',
  browser: 'browser',
  clock: 'chrono',
  compare: 'diff',
};

/** stack 顯示名稱（輸出行用） */
export const TERMINAL_STACK_LABELS: Record<TerminalStack, string> = {
  dossier: 'log/records',
  browser: 'browser',
  chrono: 'clock',
  diff: 'compare',
};

// ── API 基底與快取 ─────────────────────────────────────────────────

const API_BASE = getApiBase();

let indexCache: Promise<TerminalIndexEntry[]> | null = null;
const pageCache = new Map<string, Promise<ConceptsData | null>>();

/** 清空索引與頁面快取（資料端更新後手動重抓用） */
export function invalidateTerminalCache(): void {
  indexCache = null;
  pageCache.clear();
}

/** 載入條目索引（模組級快取；失敗時清除快取讓下次重試） */
export function loadEntityIndex(): Promise<TerminalIndexEntry[]> {
  if (!indexCache) {
    indexCache = (async () => {
      const res = await fetch(`${API_BASE}/api/concepts/entity-index`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: { entries?: TerminalIndexEntry[] };
        error?: string;
      };
      if (!json.ok) throw new Error(json.error || 'API returned ok=false');
      return json.data?.entries || [];
    })().catch((err) => {
      indexCache = null;
      throw err;
    });
  }
  return indexCache;
}

/** 抓取單頁 Concepts 結構化資料（模組級快取） */
function loadPageData(pageId: string): Promise<ConceptsData | null> {
  let cached = pageCache.get(pageId);
  if (!cached) {
    cached = (async () => {
      const res = await fetch(`${API_BASE}/api/content/${pageId}`);
      if (!res.ok) return null;
      const json = (await res.json()) as {
        ok: boolean;
        data?: { content?: { type: string; content: string }[] };
      };
      if (!json.ok) return null;
      const block = (json.data?.content || []).find(
        (b) => b && b.type !== 'rich_text'
      );
      if (!block || typeof block.content !== 'string') return null;
      try {
        return JSON.parse(block.content) as ConceptsData;
      } catch {
        return null;
      }
    })().catch(() => {
      pageCache.delete(pageId);
      return null;
    });
    pageCache.set(pageId, cached);
  }
  return cached;
}

// ── 解鎖判定（索引層） ─────────────────────────────────────────────

/**
 * 索引條目是否已解鎖——與 revision.ts 的求值語意一致：
 * - 群組 gate（S7 驗收 #3）未過 → 整組隱藏（前置 AND，條目層不再看）
 * - baseVisible = true → 無條件解鎖（base 預設顯示；群組 gate 仍前置）
 * - base gate（S7 驗收 #4）：通過即解鎖；未過時任一 revision gate
 *   通過仍解鎖（後期揭露）
 * - 皆無 → 無 gate 摘要 = 無進度閘；否則任一 revision gate 通過即解鎖
 */
export function isIndexEntryUnlocked(
  entry: TerminalIndexEntry,
  progress: ProgressState
): boolean {
  if (entry.groupGate && !evaluateGate(progress, entry.groupGate)) {
    return false;
  }
  if (entry.baseVisible) return true;
  const gates = entry.revisionGates;
  if (entry.baseGate) {
    if (evaluateGate(progress, entry.baseGate)) return true;
    return (gates ?? []).some((g) => evaluateGate(progress, g.gate));
  }
  if (!gates || gates.length === 0) return true;
  return gates.some((g) => evaluateGate(progress, g.gate));
}

/**
 * 已通過的 revision 數（T-05 更動通知水位比對用）。
 * 無 revision 鏈的條目回傳 0（水位機制不適用）。
 */
export function passedRevisionCount(
  entry: TerminalIndexEntry,
  progress: ProgressState
): number {
  const gates = entry.revisionGates;
  if (!gates || gates.length === 0) return 0;
  return gates.filter((g) => evaluateGate(progress, g.gate)).length;
}

// ── 檢索 ───────────────────────────────────────────────────────────

/** stack 指令參數解析：簡稱優先，也容忍 stack_style 原名 */
export function resolveStackAlias(input: string): TerminalStack | null {
  const key = input.trim().toLowerCase();
  if (key in TERMINAL_STACK_ALIASES) return TERMINAL_STACK_ALIASES[key];
  if (['dossier', 'chrono', 'diff'].includes(key)) return key as TerminalStack;
  return null;
}

/**
 * 檢索範圍判定（S7-C 四輪定案）：terminal 以 log entry 為主體——
 * browser 一律不可直接搜尋（詳細內容經 log entry 的連結呈現）；
 * diff 只有掛 entityKey 的名詞對照條目可查（與嵌入目標同規則），
 * 純翻譯條目不掛 key 自然排除，ls compare 仍可瀏覽全部。
 */
function isSearchable(entry: TerminalIndexEntry): boolean {
  if (entry.stack === 'browser') return false;
  if (entry.stack === 'diff') return Boolean(entry.entityKey);
  return true;
}

/**
 * 關鍵字檢索：name / entityKey / aliases 的 case-insensitive
 * substring 比對（aliases 為 S7-D-2 編輯器選填的補充匹配詞）。
 * 未解鎖條目直接隱藏（不進結果）；帶 entityKey 的條目排前。
 * 檢索範圍見 isSearchable。
 */
export function queryIndex(
  entries: TerminalIndexEntry[],
  keyword: string,
  progress: ProgressState
): TerminalIndexEntry[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  return entries
    .filter(isSearchable)
    .filter((e) => isIndexEntryUnlocked(e, progress))
    .filter(
      (e) =>
        e.name.toLowerCase().includes(kw) ||
        (e.entityKey ? e.entityKey.toLowerCase().includes(kw) : false) ||
        (e.aliases ?? []).some((a) => a.toLowerCase().includes(kw))
    )
    .sort((a, b) => {
      const keyDiff =
        Number(Boolean(b.entityKey)) - Number(Boolean(a.entityKey));
      if (keyDiff !== 0) return keyDiff;
      return a.name.localeCompare(b.name);
    });
}

/** 以 entityKey 精準取回索引條目（uep:entity-activate 直達用） */
export function findByEntityKey(
  entries: TerminalIndexEntry[],
  entityKey: string
): TerminalIndexEntry[] {
  return entries.filter((e) => e.entityKey === entityKey);
}

/** ls：列出 stack 的已解鎖條目 + 總數（未解鎖只計數不列名） */
export function listStackEntries(
  entries: TerminalIndexEntry[],
  stack: TerminalStack,
  progress: ProgressState
): { unlocked: TerminalIndexEntry[]; total: number } {
  const inStack = entries.filter((e) => e.stack === stack);
  return {
    unlocked: inStack.filter((e) => isIndexEntryUnlocked(e, progress)),
    total: inStack.length,
  };
}

/** ls 分組結果的單一群組（category/group 取自索引分類欄位） */
export interface StackGroup {
  category?: string;
  group?: string;
  entries: TerminalIndexEntry[];
}

/**
 * ls 結構化分組（S7-C 驗收回饋）：已解鎖條目按 category → group
 * 兩層彙整，分組順序 = 索引出現順序（sort_order + 頁內遍歷序）。
 * 無分類欄位的條目落在「未分類」群組（category/group 皆 undefined）。
 */
export function groupStackEntries(
  entries: TerminalIndexEntry[],
  stack: TerminalStack,
  progress: ProgressState,
  pageId?: string
): { groups: StackGroup[]; unlockedCount: number; total: number } {
  const { unlocked: allUnlocked, total } = listStackEntries(
    entries,
    stack,
    progress
  );
  // pageId 有值時只彙整該來源頁的條目（S7 驗收 #5：頁面層過濾）
  const unlocked = pageId
    ? allUnlocked.filter((e) => e.pageId === pageId)
    : allUnlocked;
  const groups: StackGroup[] = [];
  const byKey = new Map<string, StackGroup>();
  for (const entry of unlocked) {
    const key = `${entry.category ?? ''} ${entry.group ?? ''}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { category: entry.category, group: entry.group, entries: [] };
      byKey.set(key, bucket);
      groups.push(bucket);
    }
    bucket.entries.push(entry);
  }
  return { groups, unlockedCount: unlocked.length, total };
}

/** ls 頂層的分類摘要（category '' = 未分類） */
export interface CategorySummary {
  category: string;
  count: number;
}

/**
 * ls 層級式頂層（S7-C 驗收回饋二輪）：把已解鎖條目聚合成分類摘要，
 * 使用者點分類才展開條目——不一次全部托出。
 * 分類順序 = 索引出現順序；無分類條目歸 ''（未分類）。
 */
export function summarizeCategories(
  entries: TerminalIndexEntry[],
  stack: TerminalStack,
  progress: ProgressState,
  pageId?: string
): {
  categories: CategorySummary[];
  unlockedCount: number;
  total: number;
} {
  const { groups, unlockedCount, total } = groupStackEntries(
    entries,
    stack,
    progress,
    pageId
  );
  const categories: CategorySummary[] = [];
  const byName = new Map<string, CategorySummary>();
  for (const bucket of groups) {
    const name = bucket.category ?? '';
    let summary = byName.get(name);
    if (!summary) {
      summary = { category: name, count: 0 };
      byName.set(name, summary);
      categories.push(summary);
    }
    summary.count += bucket.entries.length;
  }
  return { categories, unlockedCount, total };
}

/** ls 頂層的來源頁摘要（S7 驗收 #5：三層結構的第一層） */
export interface PageSummary {
  pageId: string;
  pageTitle: string;
  count: number;
}

/**
 * ls 頂層改以「列表（來源頁）」分（S7 驗收 #5 定案）：
 * 原本把所有來源頁的分類攤平混列，會出現多個「三區」並排而不知
 * 來自哪個列表。改為 頁 → 分類 → 條目 三層。
 * 頁面順序 = 索引出現順序（sort_order）；只計已解鎖條目。
 */
export function summarizePages(
  entries: TerminalIndexEntry[],
  stack: TerminalStack,
  progress: ProgressState
): { pages: PageSummary[]; unlockedCount: number; total: number } {
  const { unlocked, total } = listStackEntries(entries, stack, progress);
  const pages: PageSummary[] = [];
  const byId = new Map<string, PageSummary>();
  for (const entry of unlocked) {
    let page = byId.get(entry.pageId);
    if (!page) {
      page = { pageId: entry.pageId, pageTitle: entry.pageTitle, count: 0 };
      byId.set(entry.pageId, page);
      pages.push(page);
    }
    page.count += 1;
  }
  return { pages, unlockedCount: unlocked.length, total };
}

/**
 * 條目顯示標籤（S7 驗收 #11）：名稱後方附 aliases。
 * 如「艾斯維爾·科索諾（艾斯、隊長）」；無別名時只回名稱。
 */
export function formatEntryLabel(entry: TerminalIndexEntry): string {
  const aliases = (entry.aliases ?? []).filter((a) => a.trim().length > 0);
  if (aliases.length === 0) return entry.name;
  return `${entry.name}（${aliases.join('、')}）`;
}

/** Tab 補全的指令詞（尾空格 = 帶參數指令） */
const COMPLETION_COMMANDS = ['query ', 'ls ', 'clear', 'help'];

/**
 * 已解鎖條目的補全候選（name/entityKey/aliases，startsWith 優先、
 * includes 補位）。未解鎖條目不進候選——防洩漏（與 query 隱藏語意
 * 一致）。同名去重。檢索範圍同 queryIndex（isSearchable）。
 * 空關鍵字回空陣列——不倒全部（S7-C 四輪定案：預設空）。
 */
function entryCandidates(
  entries: TerminalIndexEntry[],
  keyword: string,
  progress: ProgressState,
  limit: number
): string[] {
  const kw = keyword.toLowerCase();
  if (!kw) return [];
  const starts: string[] = [];
  const includes: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isSearchable(entry)) continue;
    if (!isIndexEntryUnlocked(entry, progress)) continue;
    if (seen.has(entry.name)) continue;
    const terms = [entry.name, entry.entityKey ?? '', ...(entry.aliases ?? [])]
      .filter(Boolean)
      .map((t) => t.toLowerCase());
    if (terms.some((t) => t.startsWith(kw))) {
      starts.push(entry.name);
      seen.add(entry.name);
    } else if (terms.some((t) => t.includes(kw))) {
      includes.push(entry.name);
      seen.add(entry.name);
    }
  }
  return [...starts, ...includes].slice(0, limit);
}

/**
 * Tab 補全候選（S7-C 驗收回饋）：回傳「補全後整行」候選，
 * UI 以 Tab/↑↓ 循環直接替換輸入列。
 * - 空輸入 → 空候選（指令靠 ?/help 查）
 * - `ls <部分參數>` → stack 簡稱
 * - `query <部分關鍵字>` → 已解鎖條目名（未解鎖不出現）
 * - 裸字 → 只補指令前綴（條目候選僅在 query 參數位置出現，
 *   避免任意字元倒出候選清單；裸名「提交」仍為 query 語意）
 */
export function completeInput(
  raw: string,
  entries: TerminalIndexEntry[],
  progress: ProgressState,
  limit = 8
): string[] {
  const input = raw.replace(/^\s+/, '');
  const lower = input.toLowerCase();
  // 空輸入不出候選（S7-C 四輪定案：預設空，指令靠 ?/help 查）
  if (!input) return [];

  if (lower === 'ls' || lower.startsWith('ls ')) {
    const arg = lower === 'ls' ? '' : lower.slice(3).trimStart();
    return Object.keys(TERMINAL_STACK_ALIASES)
      .filter((s) => s.startsWith(arg))
      .map((s) => `ls ${s}`)
      .slice(0, limit);
  }
  if (lower === 'query' || lower.startsWith('query ')) {
    const kw = lower === 'query' ? '' : input.slice(6).trim();
    return entryCandidates(entries, kw, progress, limit).map(
      (name) => `query ${name}`
    );
  }
  // 裸字：只補指令前綴——條目候選必須在 query 參數位置才出現
  return COMPLETION_COMMANDS.filter(
    (c) => c.toLowerCase().startsWith(lower) && c.trimEnd() !== input
  ).slice(0, limit);
}

/**
 * ls clock 的顯著時代（S7-C 驗收回饋）：已解鎖 chrono 條目按
 * eventCount 降序取前 `limit` 個（0 事件不顯著、不列），
 * 同事件數保持索引順序（時間軸序）。
 */
export function significantChronoPeriods(
  entries: TerminalIndexEntry[],
  progress: ProgressState,
  limit = 5
): TerminalIndexEntry[] {
  const { unlocked } = listStackEntries(entries, 'chrono', progress);
  return unlocked
    .map((entry, order) => ({ entry, order }))
    .filter(({ entry }) => (entry.eventCount ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.entry.eventCount ?? 0) - (a.entry.eventCount ?? 0) ||
        a.order - b.order
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}

// ── 條目內容解析（effective view） ─────────────────────────────────

/** 剝除 HTML 標記與常見 entity，壓平空白 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 截短至 max 字（預設 120），尾端補 … */
export function truncate(text: string, max = 120): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * HTML → 段落行（S7-C 驗收定案：dossier/diff 內容不設字數上限）。
 * 以 block 邊界（p/li/div/br/標題）切段後逐段剝標記，濾空段。
 */
export function htmlToLines(html: string): string[] {
  return html
    .split(/<\/(?:p|li|div|h[1-6]|blockquote)>|<br\s*\/?>/gi)
    .map((seg) => stripHtml(seg))
    .filter((seg) => seg.length > 0);
}

/** 條目比對：entityKey 優先，無 key 時退回名稱全等 */
function matchesEntry(
  entry: { entityKey?: string },
  name: string,
  target: TerminalIndexEntry
): boolean {
  if (target.entityKey) return entry.entityKey === target.entityKey;
  return name === target.name;
}

function detailBase(
  target: TerminalIndexEntry
): Pick<TerminalEntryDetail, 'stack' | 'pageId' | 'pageTitle'> {
  return {
    stack: target.stack,
    pageId: target.pageId,
    pageTitle: target.pageTitle,
  };
}

/** dossier 條目 → detail（effective view 已套用；全文不截短，按段落切行） */
function dossierDetail(
  entry: DossierEntry,
  target: TerminalIndexEntry,
  variantId: string
): TerminalEntryDetail {
  const summary = entry.content_html ? htmlToLines(entry.content_html) : [];
  return { ...detailBase(target), name: entry.name, variantId, summary };
}

/** browser profile → detail（placeholder = restricted 佔位，定案 C） */
function browserDetail(
  profile: CharacterProfile,
  target: TerminalIndexEntry
): TerminalEntryDetail {
  if (profile.placeholder === true) {
    return {
      ...detailBase(target),
      name: profile.name,
      summary: [],
      restricted: true,
    };
  }
  const summary: string[] = [];
  for (const [key, value] of Object.entries(profile.basic || {}).slice(0, 4)) {
    summary.push(`${key}：${value}`);
  }
  const sectionCount = profile.sections?.length || 0;
  if (sectionCount > 0) {
    summary.push(`……完整檔案共 ${sectionCount} 個區段，見個性瀏覽器`);
  }
  return { ...detailBase(target), name: profile.name, summary };
}

/** chrono period → detail（items 取前三） */
function chronoDetail(
  period: ChronoPeriod,
  target: TerminalIndexEntry
): TerminalEntryDetail {
  const summary: string[] = [];
  for (const field of Object.values(period.fields || {})) {
    for (const item of field.items || []) {
      summary.push(truncate(item, 80));
      if (summary.length >= 3) break;
    }
    if (summary.length >= 3) break;
  }
  return {
    ...detailBase(target),
    name: period.title || period.year,
    summary,
  };
}

/** diff 條目 → detail（locked = restricted） */
function diffDetail(
  entry: DiffEntry,
  target: TerminalIndexEntry
): TerminalEntryDetail {
  if (entry.locked === true) {
    return {
      ...detailBase(target),
      name: entry.term,
      summary: [],
      restricted: true,
    };
  }
  return {
    ...detailBase(target),
    name: entry.term,
    // S7-C 驗收定案：diff 內容不截短
    summary: [(entry.values || []).join(' ／ ')],
  };
}

/** restricted fallback（條目找不到或 gate 不一致——理論上不發生） */
function restrictedDetail(target: TerminalIndexEntry): TerminalEntryDetail {
  return {
    ...detailBase(target),
    name: target.name,
    summary: [],
    restricted: true,
  };
}

/**
 * 解析索引條目的實際內容：按需抓整頁 JSON → 定位條目 →
 * effective view → 摘要行。dossier 跨 variant 命中會回傳多筆。
 *
 * 回傳空陣列 = 頁面抓不到或條目消失（呼叫端顯示 not-found）。
 */
export async function resolveEntryDetails(
  target: TerminalIndexEntry,
  progress: ProgressState
): Promise<TerminalEntryDetail[]> {
  const data = await loadPageData(target.pageId);
  if (!data) return [];

  const resolve = <T extends Record<string, unknown>>(entry: T): T | null => {
    const revisions = entry.revisions as ConceptsRevision[] | undefined;
    const baseGate = entry.gate as GateCondition | null | undefined;
    if (!isEntryUnlocked(revisions, progress, baseGate)) return null;
    return applyRevisions(entry, revisions, progress);
  };

  const out: TerminalEntryDetail[] = [];

  if (target.stack === 'dossier' && isDossierContent(data)) {
    for (const variant of data.variants) {
      for (const subcat of variant.subcategories) {
        for (const group of subcat.groups) {
          // 群組 gate 未過 → 整組隱藏（與 resolver/索引語意一致）
          if (!evaluateGate(progress, group.gate ?? null)) continue;
          for (const entry of group.entries) {
            if (!matchesEntry(entry, entry.name, target)) continue;
            const resolved = resolve(
              entry as unknown as Record<string, unknown>
            );
            out.push(
              resolved
                ? dossierDetail(
                    resolved as unknown as DossierEntry,
                    target,
                    variant.id
                  )
                : restrictedDetail(target)
            );
          }
        }
      }
    }
  } else if (target.stack === 'browser' && isBrowserContent(data)) {
    for (const profile of data.profiles) {
      if (!matchesEntry(profile, profile.name, target)) continue;
      const resolved = resolve(profile as unknown as Record<string, unknown>);
      out.push(
        resolved
          ? browserDetail(resolved as unknown as CharacterProfile, target)
          : restrictedDetail(target)
      );
    }
  } else if (target.stack === 'chrono' && isChronoContent(data)) {
    for (const period of data.periods) {
      if (!matchesEntry(period, period.title || period.year, target)) continue;
      const resolved = resolve(period as unknown as Record<string, unknown>);
      out.push(
        resolved
          ? chronoDetail(resolved as unknown as ChronoPeriod, target)
          : restrictedDetail(target)
      );
    }
  } else if (target.stack === 'diff' && isDiffContent(data)) {
    for (const subcat of data.subcategories) {
      for (const section of subcat.sections) {
        for (const entry of section.entries) {
          if (entry.hidden === true) continue; // 與索引端排除一致
          if (!matchesEntry(entry, entry.term, target)) continue;
          const resolved = resolve(entry as unknown as Record<string, unknown>);
          out.push(
            resolved
              ? diffDetail(resolved as unknown as DiffEntry, target)
              : restrictedDetail(target)
          );
        }
      }
    }
  }

  return out;
}

// ── browser 完整檔案展開（S7-D-4） ─────────────────────────────────

/**
 * browser 完整檔案的展開結果——與 TerminalEntryDetail 的縮短摘要
 * 不同：basic 全欄位、sections 全段落（htmlToLines 不截短），
 * 供「▸ 展開完整檔案」在 terminal 內展現（取代縮短導向的過渡形態）。
 */
export interface BrowserExpandDetail {
  name: string;
  pageId: string;
  pageTitle: string;
  /** basic 全欄位（「key：value」一項一行） */
  basic: string[];
  /** 自定義區段（label + 段落行，不截短） */
  sections: { label: string; lines: string[] }[];
  /** placeholder 佔位 / gate 未過 → restricted */
  restricted?: boolean;
}

/**
 * 解析 browser profile 的完整檔案（S7-D-4）。
 * 回傳 null = 頁面抓不到或 profile 消失（呼叫端顯示 not-found）；
 * placeholder / gate 未過 → restricted（與 browserDetail 語意一致）。
 */
export async function resolveBrowserExpand(
  target: TerminalIndexEntry,
  progress: ProgressState
): Promise<BrowserExpandDetail | null> {
  if (target.stack !== 'browser') return null;
  const data = await loadPageData(target.pageId);
  if (!data || !isBrowserContent(data)) return null;

  for (const profile of data.profiles) {
    if (!matchesEntry(profile, profile.name, target)) continue;
    const base = {
      name: profile.name,
      pageId: target.pageId,
      pageTitle: target.pageTitle,
    };
    const revisions = profile.revisions;
    if (!isEntryUnlocked(revisions, progress, profile.gate)) {
      return { ...base, basic: [], sections: [], restricted: true };
    }
    const resolved = applyRevisions(
      profile as unknown as Record<string, unknown>,
      revisions,
      progress
    ) as unknown as CharacterProfile;
    if (resolved.placeholder === true) {
      return {
        ...base,
        name: resolved.name,
        basic: [],
        sections: [],
        restricted: true,
      };
    }
    return {
      ...base,
      name: resolved.name,
      basic: Object.entries(resolved.basic || {}).map(
        ([key, value]) => `${key}：${value}`
      ),
      sections: (resolved.sections || []).map((section) => ({
        label: section.label,
        lines: htmlToLines(section.content_html || ''),
      })),
    };
  }
  return null;
}
