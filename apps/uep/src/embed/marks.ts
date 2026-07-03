/* global ParentNode */
/**
 * UEP 互動式嵌入 — 標記格式共用層（框架無關）
 *
 * Epic 2 的「內建百科」體驗：History 文章中的角色/地點/術語
 * 標記為 entity，歌曲/圖片標記為 cue。HTML 保存精確位置，
 * page metadata 保存摘要（related/cues）——雙軌設計讓 island
 * 不必解析整篇 HTML 就能知道頁面有哪些關聯資源。
 *
 * 序列化格式只有這一份定義：
 * - entity: `<span data-uep-entity="{kind}" data-ref="{area/slug}">文字</span>`
 * - cue:    `<span data-uep-cue="{kind}" data-ref="{area/slug}">文字</span>`
 * - ref 可帶結構化條目錨點：`concepts/xxx#entry:{entryId}`
 *
 * 編輯器（TipTap mark）與前台（S4 dispatcher）都從這裡取用，
 * 比照 progress/markers.ts 的慣例。
 *
 * 前台在 S4 之前不對這些 span 附加任何樣式與行為——
 * 未接線的 entity 就是普通文字（History 可讀性優先原則）。
 */

/** entity 標記屬性（值 = entity 種類） */
export const UEP_ENTITY_ATTR = 'data-uep-entity';
/** cue 標記屬性（值 = cue 種類） */
export const UEP_CUE_ATTR = 'data-uep-cue';
/** 引用目標屬性（值 = area/slug，可帶 #entry: 錨點） */
export const UEP_REF_ATTR = 'data-ref';

export const UEP_ENTITY_SELECTOR = `span[${UEP_ENTITY_ATTR}]`;
export const UEP_CUE_SELECTOR = `span[${UEP_CUE_ATTR}]`;

/** entity 種類 — 文字型引用（點擊開 Concepts mini view） */
export const ENTITY_KINDS = [
  { value: 'character', label: '角色' },
  { value: 'location', label: '地點' },
  { value: 'term', label: '術語' },
] as const;

/** cue 種類 — 媒體型引用（點擊觸發媒體事件） */
export const CUE_KINDS = [
  { value: 'song', label: '歌曲' },
  { value: 'image', label: '圖片' },
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number]['value'];
export type CueKind = (typeof CUE_KINDS)[number]['value'];

/** 單筆嵌入引用（HTML 標記與 metadata 摘要的共用形狀） */
export interface EmbedRef {
  /** 種類（entity: character/location/term；cue: song/image） */
  kind: string;
  /** 引用目標：`{area}/{slug}`，可帶 `#entry:{entryId}` 錨點 */
  ref: string;
  /** 標記的顯示文字（metadata 摘要用，選填） */
  text?: string;
}

/**
 * ref 形狀驗證：`{area}/{slug...}` + 選填 `#entry:{entryId}`。
 * 只驗形狀不驗存在性——目標頁面是否存在由 picker 保證（0.9.9.3）、
 * 前台 dispatcher 容錯（S4）。
 */
export function isValidRef(ref: string): boolean {
  if (!ref) return false;
  const [path, anchor, ...rest] = ref.split('#');
  if (rest.length > 0) return false;
  if (!/^[a-z0-9-]+\/[a-z0-9-][a-z0-9/_-]*$/i.test(path)) return false;
  if (anchor !== undefined && !/^entry:[^\s#]+$/.test(anchor)) return false;
  return true;
}

/** 拆解 ref 為頁面 id 與條目錨點 */
export function parseRef(ref: string): { pageId: string; entryId?: string } {
  const [path, anchor] = ref.split('#');
  const entryId = anchor?.startsWith('entry:')
    ? anchor.slice('entry:'.length)
    : undefined;
  return entryId ? { pageId: path, entryId } : { pageId: path };
}

/** 從 DOM 元素讀取嵌入引用；非嵌入標記回傳 null */
export function readEmbedFromElement(
  el: Element
): { type: 'entity' | 'cue'; embed: EmbedRef } | null {
  const ref = el.getAttribute(UEP_REF_ATTR) || '';
  const entityKind = el.getAttribute(UEP_ENTITY_ATTR);
  if (entityKind) {
    return {
      type: 'entity',
      embed: { kind: entityKind, ref, text: el.textContent || undefined },
    };
  }
  const cueKind = el.getAttribute(UEP_CUE_ATTR);
  if (cueKind) {
    return {
      type: 'cue',
      embed: { kind: cueKind, ref, text: el.textContent || undefined },
    };
  }
  return null;
}

/** 頁面嵌入摘要（寫入 metadata.related / metadata.cues） */
export interface EmbedSummary {
  /** entity 引用（去重，以 kind+ref 為鍵） */
  related: EmbedRef[];
  /** cue 引用（去重，以 kind+ref 為鍵） */
  cues: EmbedRef[];
}

/**
 * 掃描容器內所有嵌入標記，彙整為去重後的摘要。
 * 存檔時寫入 metadata（0.9.9.3），island 消費（S6+）。
 */
export function collectEmbeds(container: ParentNode): EmbedSummary {
  const related: EmbedRef[] = [];
  const cues: EmbedRef[] = [];
  const seen = new Set<string>();

  const elements = container.querySelectorAll(
    `${UEP_ENTITY_SELECTOR}, ${UEP_CUE_SELECTOR}`
  );
  elements.forEach((el) => {
    const found = readEmbedFromElement(el);
    if (!found || !isValidRef(found.embed.ref)) return;
    const key = `${found.type}:${found.embed.kind}:${found.embed.ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    (found.type === 'entity' ? related : cues).push(found.embed);
  });

  return { related, cues };
}
