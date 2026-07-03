/**
 * UEP 代稱系統 — 詞庫與隨機組裝（Epic 2 S5）
 *
 * 代稱 = 前綴詞 + 名詞（如「拾光的旅人」），註冊時由伺服器端 roll，
 * 使用者可重 roll 直到滿意。詞庫是代稱合法性的唯一來源——
 * 註冊時若客戶端傳入代稱，必須能被 isValidAlias 驗證（防止任意字串繞過世界觀）。
 *
 * 顯示規則（不存入 alias 欄位，顯示時計算）：
 * - 未登入訪客統一稱呼：「初入世界的朋友」
 * - 有觀測者印記的註冊使用者：代稱前加「已見證的」
 *
 * ⚠️ 詞庫內容為諾薇亞草擬，待艾斯維爾審定後可直接增刪。
 */

/** 前綴詞（形容狀態/姿態） */
export const ALIAS_PREFIXES = [
  '拾光的',
  '未名的',
  '徘徊的',
  '遠行的',
  '傾聽的',
  '逐頁的',
  '守夜的',
  '藏星的',
  '執燈的',
  '緘默的',
  '迷途的',
  '掠影的',
  '銜葉的',
  '觀潮的',
  '描邊的',
  '拂塵的',
] as const;

/** 名詞（身分/角色） */
export const ALIAS_NOUNS = [
  '旅人',
  '記述者',
  '引路人',
  '織夢者',
  '抄寫員',
  '收藏家',
  '漫遊者',
  '測繪師',
  '譯讀者',
  '過客',
  '燈手',
  '尋跡者',
] as const;

/** 未登入訪客的統一稱呼 */
export const GUEST_ALIAS = '初入世界的朋友';

/** 觀測者印記持有者的前綴（顯示時加在代稱前，不入庫） */
export const WITNESSED_PREFIX = '已見證的';

/** 從詞庫隨機組裝一個代稱 */
export function rollAlias(): string {
  const prefix =
    ALIAS_PREFIXES[Math.floor(Math.random() * ALIAS_PREFIXES.length)];
  const noun = ALIAS_NOUNS[Math.floor(Math.random() * ALIAS_NOUNS.length)];
  return `${prefix}${noun}`;
}

/** 驗證代稱是否為詞庫的合法組合（前綴 + 名詞，恰好一組） */
export function isValidAlias(alias: string): boolean {
  for (const prefix of ALIAS_PREFIXES) {
    if (!alias.startsWith(prefix)) continue;
    const rest = alias.slice(prefix.length);
    if ((ALIAS_NOUNS as readonly string[]).includes(rest)) return true;
  }
  return false;
}
