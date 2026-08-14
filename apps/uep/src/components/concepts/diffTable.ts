/**
 * Diff 對照表的欄位推導
 *
 * 值欄位標籤定義在 section 層（`valueLabels`），各詞條的 `values` 依序
 * 對位。既有資料沒有標籤，欄數只能從實際值數推導——閱讀器與編輯器
 * 兩邊都要算，規則不能各寫一份，否則同一份資料會出現欄數不一致。
 */
import type { DiffSection, DiffSubcat } from './types';

/**
 * 單一 section 的值欄數：欄位標籤數與詞條實際值數取大者。
 * 取大者是為了不裁掉資料——標籤只填了一欄但詞條有三個值時，
 * 第二、三個值仍要露出來（否則編輯者看不到、也刪不掉）。
 * 至少 1 欄，讓空 section 也能開始填。
 */
export function sectionValueColumns(section: DiffSection): number {
  let max = section.valueLabels?.length ?? 0;
  for (const entry of section.entries) {
    max = Math.max(max, entry.values.length);
  }
  return Math.max(max, 1);
}

/**
 * 整個分類（tab）的值欄數——閱讀器可能把多個 section 展平成一張表，
 * 欄數必須全表統一，否則各列的格子對不齊。
 */
export function subcatValueColumns(subcat: DiffSubcat | undefined): number {
  if (!subcat) return 0;
  let max = 0;
  for (const section of subcat.sections) {
    max = Math.max(max, sectionValueColumns(section));
  }
  return max;
}

/**
 * 分類層的欄位標籤：取同 tab 內第一組已定義的標籤。
 * 單一無名 section 的頁面（如多語系對照）走展平路徑，
 * 拿不到「當前 section」，仍需要一組標籤當表頭。
 */
export function subcatValueLabels(subcat: DiffSubcat | undefined): string[] {
  return subcat?.sections.find((s) => s.valueLabels?.length)?.valueLabels ?? [];
}

/** 標籤補齊到指定欄數（未命名欄位補空字串），供逐欄編輯對位 */
export function padValueLabels(
  labels: string[] | undefined,
  columns: number
): string[] {
  return Array.from({ length: columns }, (_, i) => labels?.[i] ?? '');
}
