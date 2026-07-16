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
 * - ref 可帶結構化條目錨點：`concepts/xxx#entry:{entryId}`（S3 舊格式）
 * - ref 新格式（S7-C）：`entity:{entityKey}`——以跨 stack 穩定識別碼指向
 *   Concepts 條目，頁面路徑從 ref 消失（搬動/新增列表不斷連結）
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

/** entity 種類的顯示名稱（未知種類 fallback「條目」） */
export function entityKindLabel(kind: string): string {
  return ENTITY_KINDS.find((k) => k.value === kind)?.label ?? '條目';
}

/**
 * entity「認識」旗標的命名慣例：`met:` + 完整 ref（含 #entry: 錨點）。
 *
 * 授予端：FlagMarker 認識點的 grantsFlags 填相同字串（S2 掃描線授予）；
 * 消費端：前台 dispatcher 判定 entity 解鎖（S4）。
 * 採全 ref 而非簡短 id——零歧義、零額外欄位，
 * 且與 metadata.related 摘要的 ref 天然對齊（2026-07-03 艾斯維爾定案）。
 *
 * ⚠️ S7-C 起 met:* 在嵌入判定線退役（嵌入全可點，內容由 Concepts
 * revision 卡控）——僅 isEntityUnlocked 的舊格式 fallback 仍消費，
 * 停增不刪（2026-07-06 定案）。
 */
export function metFlag(ref: string): string {
  return `met:${ref}`;
}

/** entity ref 新格式前綴（S7-C）：`entity:{entityKey}` */
export const ENTITY_KEY_REF_PREFIX = 'entity:';

/**
 * entityKey 格式：kebab-case 小寫英文/數字，連字號分段。
 * 唯一事實來源——編輯器 EntityKeyField 與 ref 驗證共用。
 */
export const ENTITY_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
 * ref 形狀驗證：`{area}/{slug...}` + 選填 `#entry:{entryId}`，
 * 或新格式 `entity:{entityKey}`（S7-C）。
 * 只驗形狀不驗存在性——目標頁面是否存在由 picker 保證（0.9.9.3）、
 * 前台 dispatcher 容錯（S4）。
 */
export function isValidRef(ref: string): boolean {
  if (!ref) return false;
  if (ref.startsWith(ENTITY_KEY_REF_PREFIX)) {
    return ENTITY_KEY_PATTERN.test(ref.slice(ENTITY_KEY_REF_PREFIX.length));
  }
  const [path, anchor, ...rest] = ref.split('#');
  if (rest.length > 0) return false;
  if (!/^[a-z0-9-]+\/[a-z0-9-][a-z0-9/_-]*$/i.test(path)) return false;
  if (anchor !== undefined && !/^entry:[^\s#]+$/.test(anchor)) return false;
  return true;
}

/** 拆解 ref 為頁面 id 與條目錨點（僅適用路徑型 ref；新格式走 parseEntityRef） */
export function parseRef(ref: string): { pageId: string; entryId?: string } {
  const [path, anchor] = ref.split('#');
  const entryId = anchor?.startsWith('entry:')
    ? anchor.slice('entry:'.length)
    : undefined;
  return entryId ? { pageId: path, entryId } : { pageId: path };
}

/** parseEntityRef 的解析結果（新舊格式統一出口） */
export type EntityRefResult =
  /** 新格式 `entity:{entityKey}`（S7-C）——以穩定識別碼指向 Concepts 條目 */
  | { type: 'entity-key'; entityKey: string }
  /** 舊格式 `{area}/{slug}#entry:{entryId}`——條目級錨點 */
  | { type: 'concepts-entry'; pageId: string; entryId: string }
  /** 一般頁面 ref `{area}/{slug}`（無條目錨點） */
  | { type: 'page'; pageId: string }
  /** 形狀不合法 */
  | { type: 'invalid' };

/**
 * 解析 entity ref（新舊格式相容，S7-C）。
 * 消費端（dispatcher / Terminal Island）以此取代直接呼叫 parseRef，
 * 一次判定格式並取得對應欄位。
 */
export function parseEntityRef(ref: string): EntityRefResult {
  if (!isValidRef(ref)) return { type: 'invalid' };
  if (ref.startsWith(ENTITY_KEY_REF_PREFIX)) {
    return {
      type: 'entity-key',
      entityKey: ref.slice(ENTITY_KEY_REF_PREFIX.length),
    };
  }
  const { pageId, entryId } = parseRef(ref);
  return entryId
    ? { type: 'concepts-entry', pageId, entryId }
    : { type: 'page', pageId };
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
