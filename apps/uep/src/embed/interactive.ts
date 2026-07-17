/**
 * UEP 互動式嵌入 — 前台啟用層（Epic 2 S4）
 *
 * 職責：把資料庫 HTML 中的 entity 標記（S3 編輯器產出）轉為
 * 前台可互動的元素，並定義啟動事件的合約。
 *
 * 啟用模型（S7-C 定案：嵌入全可點，旗標不卡點擊）：
 * - decorate 守門 = concepts 島已掛載（shouldMountIsland 語意：
 *   探索者＋已解鎖＋未停用）——入口跟著工具走，避免「可點但沒反應」
 * - 島未掛載／觀測者視角 = 普通文字——不加樣式、不可點、無任何提示
 *   （History 可讀性優先原則不變）
 * - 內容進度一律由 Concepts 條目的 revision 鏈卡控（effective view），
 *   met:{ref} 旗標判定在嵌入線退役（2026-07-06 定案，停增不刪）
 *
 * 事件模型：
 * - 點擊已啟用 entity → window dispatch `uep:entity-activate`
 * - 消費端是 Terminal Island（S7-C）；無消費端時事件靜默消失
 * - dispatch 在 window 層，浮島不必掛在 Reader 的 React 樹內
 *
 * 此檔案不碰 React——前台渲染器與測試都從這裡取用。
 * 依賴方向備註：embed（前台渲染層）→ islands/islandRuntime（守門純函式）
 * 是單向引用，islands 不反向 import embed，無循環。
 */

import { shouldMountIsland } from '../islands/islandRuntime';
import { evaluateGate } from '../progress/gating';
import type { ProgressState } from '../progress/types';

import {
  UEP_ENTITY_ATTR,
  UEP_ENTITY_SELECTOR,
  UEP_REF_ATTR,
  entityKindLabel,
  isValidRef,
  metFlag,
  parseEntityRef,
  readEmbedFromElement,
} from './marks';

/** 已解鎖 entity 的啟用屬性（前台渲染時附加，資料庫 HTML 不含） */
export const UEP_ENTITY_ACTIVE_ATTR = 'data-uep-entity-active';

/** 已啟用 entity 的選擇器（dispatcher 事件委派用） */
export const UEP_ENTITY_ACTIVE_SELECTOR = `span[${UEP_ENTITY_ACTIVE_ATTR}]`;

/** entity 啟動事件名（window 層 CustomEvent） */
export const UEP_ENTITY_ACTIVATE_EVENT = 'uep:entity-activate';

/** entity 啟動事件的 detail 形狀（浮島消費合約） */
export interface EntityActivateDetail {
  /** entity 種類（character/location/term） */
  kind: string;
  /** 完整 ref（新格式 entity:{key} 或舊格式含 #entry: 錨點） */
  ref: string;
  /** 解析後的 entityKey（新格式 ref 才有，Terminal 直達檢索用） */
  entityKey?: string;
  /** ref 的頁面部分（路徑型舊格式才有） */
  pageId?: string;
  /** ref 的條目錨點（舊格式且帶錨點才有） */
  entryId?: string;
  /** 標記的顯示文字 */
  text?: string;
  /** 觸發來源的 History 頁面 id */
  sourcePageId?: string;
}

/**
 * entity 解鎖判定 — S7-C 起僅剩舊格式 fallback 語意：
 * - 新格式 `entity:{entityKey}`：一律解鎖（嵌入全可點，內容由
 *   Concepts revision 卡控——此函式不再是點擊守門）
 * - 舊格式路徑 ref：持有 `met:{ref}` 旗標或觀測者視角（向後相容）
 * - 無效 ref 一律 false（前台容錯）
 */
export function isEntityUnlocked(state: ProgressState, ref: string): boolean {
  const parsed = parseEntityRef(ref);
  if (parsed.type === 'invalid') return false;
  if (parsed.type === 'entity-key') return true;
  return evaluateGate(state, { requiresFlags: [metFlag(ref)] });
}

/**
 * 前台渲染前處理（S7-C 語意 + 2026-07-17 修正）：concepts 島掛載時，
 * 合法 ref 的 entity 附加啟用屬性 + a11y 屬性。島未掛載／觀測者時
 * 全部維持普通文字。
 *
 * isRefUnlocked（選填）：條目級解鎖判定——「可點 ⟺ terminal 查得到
 * 內容」不變量，未解鎖 entity 維持普通文字，杜絕「可點卻 ACCESS
 * RESTRICTED」的矛盾。判定來源是 Concepts 條目索引（terminalCore
 * isEntityRefUnlocked），由呼叫端注入以維持 embed → islands 的單向
 * 依賴。未注入時沿用 S7-C 全可點語意（向後相容）。
 *
 * 冪等：無論輸入是否殘留啟用屬性（防禦外部資料），
 * 一律先清除再依當前進度重算——進度變化（含觀測者切回探索者、
 * 島解鎖/停用切換、條目解鎖）時重跑即得正確結果。
 */
export function decorateInteractiveHtml(
  html: string,
  state: ProgressState,
  isRefUnlocked?: (ref: string) => boolean
): string {
  if (!html || !html.includes(UEP_ENTITY_ATTR)) return html;
  if (typeof DOMParser === 'undefined') return html; // SSR 防禦

  const terminalMounted = shouldMountIsland(state, 'concepts');

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll(UEP_ENTITY_SELECTOR).forEach((el) => {
    el.removeAttribute(UEP_ENTITY_ACTIVE_ATTR);
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.removeAttribute('aria-label');

    const ref = el.getAttribute(UEP_REF_ATTR) || '';
    if (!terminalMounted || !isValidRef(ref)) return;
    if (isRefUnlocked && !isRefUnlocked(ref)) return;

    el.setAttribute(UEP_ENTITY_ACTIVE_ATTR, 'true');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    const kind = el.getAttribute(UEP_ENTITY_ATTR) || '';
    el.setAttribute(
      'aria-label',
      `開啟${entityKindLabel(kind)}引用：${el.textContent || ref}`
    );
  });
  return doc.body.innerHTML;
}

/**
 * 從已啟用的 entity 元素組出 detail 並 dispatch 啟動事件（window 層）。
 * 非啟用元素或無效資料回傳 null（不 dispatch）。
 */
export function dispatchEntityActivate(
  el: Element,
  sourcePageId?: string
): EntityActivateDetail | null {
  if (!el.hasAttribute(UEP_ENTITY_ACTIVE_ATTR)) return null;
  const found = readEmbedFromElement(el);
  if (!found || found.type !== 'entity' || !isValidRef(found.embed.ref)) {
    return null;
  }

  const parsed = parseEntityRef(found.embed.ref);
  if (parsed.type === 'invalid') return null;
  const detail: EntityActivateDetail = {
    kind: found.embed.kind,
    ref: found.embed.ref,
    ...(parsed.type === 'entity-key' ? { entityKey: parsed.entityKey } : {}),
    ...(parsed.type !== 'entity-key' ? { pageId: parsed.pageId } : {}),
    ...(parsed.type === 'concepts-entry' ? { entryId: parsed.entryId } : {}),
    ...(found.embed.text ? { text: found.embed.text } : {}),
    ...(sourcePageId ? { sourcePageId } : {}),
  };
  window.dispatchEvent(
    new CustomEvent<EntityActivateDetail>(UEP_ENTITY_ACTIVATE_EVENT, {
      detail,
    })
  );
  return detail;
}
