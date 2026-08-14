/**
 * 別名的顯示格式（dossier 條目專用——只有 dossier 條目帶 aliases）。
 *
 * 兩個顯示端共用同一份：Concepts Reader 的條目卡與終端浮島的條目詳情。
 * 這個欄位過去只被拿去做比對（terminal 檢索、自動偵測匹配詞），從沒真的
 * 顯示過，於是讀者看不出某個名字為什麼搜得到。
 *
 * ⚠️ terminalCore 另有一個 `formatEntryLabel`（「名稱（別名）」括號式），
 * 那是**搜尋結果清單**用的單行標籤，與這裡的獨立行不同用途，兩者並存。
 */

/** 去空白、濾空、去重後的別名清單 */
export function normalizeAliases(aliases?: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of aliases ?? []) {
    const alias = raw.trim();
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    out.push(alias);
  }
  return out;
}

/** 「又名：甲、乙」；無別名回 null（呼叫端據此決定要不要渲染那一行） */
export function formatAliasLine(aliases?: string[]): string | null {
  const list = normalizeAliases(aliases);
  return list.length > 0 ? `又名：${list.join('、')}` : null;
}
