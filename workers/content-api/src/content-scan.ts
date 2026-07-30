/**
 * content-scan.ts — 在 Worker 端從 `pages.content` 撈結構化資訊的共用工具
 *
 * D1 的 `content` 欄位存的是序列化後的 HTML 字串（包在 ContentBlock[] JSON
 * 裡），Worker 沒有 ProseMirror／DOM 執行環境，所有「從內容取出標記」的
 * 需求都只能對 HTML 屬性做 regex 掃描。這個模式最早由 `assets.ts` 的
 * `extractAssetKeysFromContentBlock` 驗證，之後 `history-interlink.ts`
 * （互聯錨點）與 `flags-scan.ts`（旗標授予點）都走同一條路。
 *
 * 這裡只放與「怎麼讀 HTML」有關的通用工具，不含任何一種標記的語意——
 * 那屬於各自的掃描器。
 */

/** 解開 HTML 屬性值裡的實體字元（TipTap 序列化時會轉義） */
export function decodeEntities(value: string): string {
  return (
    value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // & 必須最後解，否則 &amp;lt; 這種二次轉義會被解錯
      .replace(/&amp;/g, '&')
  );
}

/** 從屬性字串取單一屬性值；不存在或空值回空字串 */
export function readAttr(attrs: string, name: string): string {
  const match = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return match ? decodeEntities(match[1]).trim() : '';
}

/** 去掉標籤與多餘空白，取元素的顯示文字 */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 逐個 block 取出 content 字串（content 可能是 JSON 字串或已解析的陣列） */
export function collectContentStrings(content: unknown): string[] {
  let blocks: unknown = content;
  if (typeof content === 'string') {
    // 整段就是 HTML（非 ContentBlock[] JSON）時直接掃
    try {
      blocks = JSON.parse(content);
    } catch {
      return [content];
    }
  }
  if (!Array.isArray(blocks)) return [];
  const out: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const value = (block as { content?: unknown }).content;
    if (typeof value === 'string') out.push(value);
  }
  return out;
}
