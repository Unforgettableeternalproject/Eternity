/**
 * Terminal Island — 輸出行模型與持久化（S7-C 驗收回饋）
 *
 * TermLine 序列化格式的唯一定義（比照 embed/marks.ts 慣例）。
 * 可點擊列以 data-driven 的 TermAction 表達（不掛 function），
 * 讓輸出歷史能整批寫入 localStorage、跨頁/登出重登維持
 * （艾斯維爾定案：本機持久化，不佔 ProgressState blob 額度）。
 *
 * localStorage 失敗一律靜默——終端是輔助工具，不應阻斷閱讀。
 */

import type { TerminalIndexEntry } from './terminalCore';

/** localStorage key（含 schema 版本，比照 uep.islands.v1 慣例） */
export const TERMINAL_LOG_KEY = 'uep.islands.terminal.v1';

/** 輸出行上限（持久化與 UI 共用，防長 session 無界成長） */
export const MAX_TERM_LINES = 200;

/** 可序列化的行為（rehydrate 後由 UI 重建 handler） */
export type TermAction =
  | { type: 'show-entry'; entry: TerminalIndexEntry }
  | { type: 'navigate'; pageId: string }
  /** ls 層級式展開：列出指定分類的條目（category '' = 未分類） */
  | {
      type: 'ls-category';
      stack: 'dossier' | 'browser' | 'chrono' | 'diff';
      category: string;
    };

/** 單行輸出（action 有值時渲染為可點擊列） */
export interface TermLine {
  kind: 'meta' | 'in' | 'ok' | 'err' | 'row' | 'head';
  text: string;
  fade?: boolean;
  action?: TermAction;
  /** 行尾附加動作（如 ↗ 跳頁符號）——與主 action 獨立可點 */
  suffix?: { text: string; action: TermAction };
  /** 捲動置頂錨點（清空式展現用）——UI 一次性標記，不持久化 */
  anchorId?: string;
}

const LINE_KINDS = new Set(['meta', 'in', 'ok', 'err', 'row', 'head']);
const STACKS = new Set(['dossier', 'browser', 'chrono', 'diff']);

/** 驗證單筆 action 形狀；非法時回傳 undefined（該行降級為純文字） */
function normalizeAction(raw: unknown): TermAction | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as {
    type?: unknown;
    entry?: unknown;
    pageId?: unknown;
    stack?: unknown;
    category?: unknown;
  };
  if (obj.type === 'navigate') {
    return typeof obj.pageId === 'string' && obj.pageId
      ? { type: 'navigate', pageId: obj.pageId }
      : undefined;
  }
  if (obj.type === 'ls-category') {
    return typeof obj.stack === 'string' &&
      STACKS.has(obj.stack) &&
      typeof obj.category === 'string'
      ? {
          type: 'ls-category',
          stack: obj.stack as TerminalIndexEntry['stack'],
          category: obj.category,
        }
      : undefined;
  }
  if (obj.type !== 'show-entry') return undefined;
  if (typeof obj.entry !== 'object' || obj.entry === null) return undefined;
  const entry = obj.entry as Partial<TerminalIndexEntry>;
  if (
    typeof entry.name !== 'string' ||
    typeof entry.pageId !== 'string' ||
    typeof entry.pageTitle !== 'string' ||
    typeof entry.stack !== 'string' ||
    !STACKS.has(entry.stack)
  ) {
    return undefined;
  }
  return { type: 'show-entry', entry: entry as TerminalIndexEntry };
}

/** 驗證並過濾讀回的行陣列；整體形狀非法時回傳 null */
export function normalizeTermLines(raw: unknown): TermLine[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TermLine[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Partial<TermLine>;
    if (typeof obj.text !== 'string') continue;
    if (typeof obj.kind !== 'string' || !LINE_KINDS.has(obj.kind)) continue;
    const line: TermLine = { kind: obj.kind, text: obj.text };
    if (obj.fade === true) line.fade = true;
    const action = normalizeAction(obj.action);
    if (action) line.action = action;
    // suffix：text + action 皆合法才保留，否則整個 suffix 丟棄
    if (typeof obj.suffix === 'object' && obj.suffix !== null) {
      const suf = obj.suffix as { text?: unknown; action?: unknown };
      const sufAction = normalizeAction(suf.action);
      if (typeof suf.text === 'string' && suf.text && sufAction) {
        line.suffix = { text: suf.text, action: sufAction };
      }
    }
    out.push(line);
  }
  return out.slice(-MAX_TERM_LINES);
}

/** 讀取輸出歷史；不存在或毀損時回傳 null（呼叫端 fallback boot 行） */
export function loadTerminalLog(): TermLine[] | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(TERMINAL_LOG_KEY);
    if (!raw) return null;
    return normalizeTermLines(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 寫入輸出歷史（截尾至上限，靜默失敗） */
export function saveTerminalLog(lines: TermLine[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      TERMINAL_LOG_KEY,
      JSON.stringify(lines.slice(-MAX_TERM_LINES))
    );
  } catch {
    // localStorage 滿載或被禁用時靜默失敗
  }
}

/** 清除輸出歷史（clear 指令用） */
export function clearTerminalLog(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(TERMINAL_LOG_KEY);
  } catch {
    // 靜默失敗
  }
}
