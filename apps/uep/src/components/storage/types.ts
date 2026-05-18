// ═══════════════════════════════════════════════════════════════════
// Storage 區域型別定義
// ═══════════════════════════════════════════════════════════════════

/** Storage 的空地定義 — 前端硬編碼的結構對照 */
export interface ClearingDef {
  id: string;
  slug: string;
  label: string;
  labelEn: string;
  icon: string;
  /** 閱讀器風格：dialogue = 劇本式, log = 列表式, blog = 文章式 */
  style: 'dialogue' | 'log' | 'blog';
  intro: string;
  uepNote: string;
}

// ── 對話劇本（boxes）──────────────────────────────────────────────

export type ScriptRole = 'narrator' | 'you' | 'uep' | 'sfx' | 'break';

export interface ScriptLine {
  role: ScriptRole;
  text: string;
  side?: 'left' | 'right';
}

// ── 更新公告（changelog）────────────────────────────────────────────

export interface LogItemType {
  id: string;
  label: string;
  color: string;
  shortLabel: string;
}

export type LogItemState = 'ok' | 'wip' | 'risk' | 'sealed';

export interface LogItem {
  type: string;
  subject: string;
  text: string;
  state: LogItemState;
}

// ── 部落格（extras）──────────────────────────────────────────────

export interface BlogOutlineItem {
  id: string;
  label: string;
}
