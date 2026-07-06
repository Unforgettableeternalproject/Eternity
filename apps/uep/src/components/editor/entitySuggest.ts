/**
 * entitySuggest — entity 自動偵測的匹配核心（Epic 2 S7-D-3）
 *
 * 純函式層（不碰 ProseMirror）：從可嵌入條目建匹配索引、
 * 對游標前文字做「最長後綴比對」。Plugin 接線見
 * EntitySuggestExtension.ts。
 *
 * 匹配詞規則（S7-D 定案 3）：
 * - 自動拆名：中文全名（「艾斯維爾·科索諾」）、中文首段（「艾斯維爾」）、
 *   英文全名（「Xavier Colsono」）
 * - 姓氏單獨匹配（「科索諾」）刻意不進預設——家族同姓誤傷，
 *   需要時由條目 aliases 顯式補充
 * - aliases（編輯器選填）原樣納入
 * - diff 詞條的外框方括號（「[遣返]」）另加剝殼版本
 *
 * 後綴比對（matchSuffix）：只比對游標前文字的結尾——打字打完
 * 匹配詞的瞬間命中，天然只掃游標段落、成本 O(詞數)，
 * 不需要全文掃描與 debounce。
 */

import type { EntityPickerEntry } from './EntityIndexPicker';

// ── 匹配詞拆解 ─────────────────────────────────────────────────────

/** 自動拆名派生的最短長度（單字元太氾濫；aliases 為顯式輸入不受限） */
const MIN_DERIVED_LENGTH = 2;

/**
 * 從條目 name + aliases 拆出匹配詞。
 * name 慣例：「中文名 English Name」——中文段與英文段以首個拉丁字母分界。
 */
export function buildMatchTerms(name: string, aliases?: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (term: string, derived: boolean) => {
    const t = term.trim();
    if (!t || seen.has(t)) return;
    if (derived && t.length < MIN_DERIVED_LENGTH) return;
    seen.add(t);
    out.push(t);
  };

  let base = name.trim();
  // diff 詞條外框方括號：剝殼後照一般規則拆
  const bracketed = base.match(/^\[(.+)\]$/);
  if (bracketed) {
    push(base, true); // 原樣（含括號）也可匹配
    base = bracketed[1].trim();
  }

  // 中文段 = 首個拉丁字母之前；英文段 = 其後
  const latinStart = base.search(/[A-Za-z]/);
  const cjk = (latinStart === -1 ? base : base.slice(0, latinStart)).trim();
  const latin = latinStart === -1 ? '' : base.slice(latinStart).trim();

  push(cjk, true); // 中文全名
  // 中文首段（間隔號前）——姓氏（後段）刻意不進預設
  const firstSegment = cjk.split(/[·・]/)[0]?.trim() ?? '';
  if (firstSegment && firstSegment !== cjk) push(firstSegment, true);
  push(latin, true); // 英文全名

  for (const alias of aliases ?? []) push(alias, false);
  return out;
}

// ── 匹配索引 ───────────────────────────────────────────────────────

/** 匹配索引：詞 → 命中條目（同詞多條目 = 多候選） */
export interface SuggestIndex {
  terms: Map<string, EntityPickerEntry[]>;
  /** 最長匹配詞長度（後綴比對的掃描上限） */
  maxTermLength: number;
}

/**
 * 建匹配索引。呼叫端應先過 embeddableEntries（dossier/diff 帶
 * entityKey + 同 key 去重）——本函式不重複過濾。
 */
export function buildSuggestIndex(entries: EntityPickerEntry[]): SuggestIndex {
  const terms = new Map<string, EntityPickerEntry[]>();
  let maxTermLength = 0;
  for (const entry of entries) {
    for (const term of buildMatchTerms(entry.name, entry.aliases)) {
      let bucket = terms.get(term);
      if (!bucket) {
        bucket = [];
        terms.set(term, bucket);
      }
      if (!bucket.some((e) => e.entityKey === entry.entityKey)) {
        bucket.push(entry);
      }
      if (term.length > maxTermLength) maxTermLength = term.length;
    }
  }
  return { terms, maxTermLength };
}

// ── 後綴比對 ───────────────────────────────────────────────────────

/** 後綴命中結果（offset 相對於傳入文字的結尾） */
export interface SuggestMatch {
  /** 命中的匹配詞 */
  term: string;
  /** 候選條目（同詞多條目時依索引順序） */
  candidates: EntityPickerEntry[];
  /** 匹配詞長度（呼叫端換算 doc 位置：from = cursor - length） */
  length: number;
}

/**
 * 游標前文字的最長後綴比對。
 * 英文詞要求「詞邊界」——前一字元不得是拉丁字母/數字
 * （避免 Nov 命中 Renovate 的尾巴）；中文詞無此限制。
 */
export function matchSuffix(
  textBefore: string,
  index: SuggestIndex
): SuggestMatch | null {
  if (!textBefore || index.terms.size === 0) return null;
  const max = Math.min(index.maxTermLength, textBefore.length);
  for (let len = max; len >= 1; len--) {
    const tail = textBefore.slice(-len);
    const candidates = index.terms.get(tail);
    if (!candidates || candidates.length === 0) continue;
    // 英文詞的左邊界檢查
    if (/^[A-Za-z0-9]/.test(tail)) {
      const before = textBefore.charAt(textBefore.length - len - 1);
      if (/[A-Za-z0-9]/.test(before)) continue;
    }
    return { term: tail, candidates, length: len };
  }
  return null;
}
