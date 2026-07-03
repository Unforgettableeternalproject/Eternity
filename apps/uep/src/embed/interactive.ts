/**
 * UEP 互動式嵌入 — 前台啟用層（Epic 2 S4）
 *
 * 職責：把資料庫 HTML 中的 entity 標記（S3 編輯器產出）轉為
 * 前台可互動的元素，並定義啟動事件的合約。
 *
 * 解鎖模型：
 * - entity 解鎖 = 持有 `met:{ref}` 旗標（metFlag 慣例，全 ref 零歧義）
 * - 觀測者視角 bypass（走 evaluateGate 的 requiresFlags 語意）
 * - 未解鎖 entity 維持普通文字——不加樣式、不可點、無任何提示
 *   （History 可讀性優先原則，2026-07-03 定案：例外遮蔽不做）
 *
 * 事件模型：
 * - 點擊已解鎖 entity → window dispatch `uep:entity-activate`
 * - 消費端是浮島（S6/S7 的 Concepts mini dossier）；S4 僅 Toast 佔位
 * - dispatch 在 window 層，浮島不必掛在 Reader 的 React 樹內
 *
 * 此檔案不碰 React——前台渲染器與測試都從這裡取用。
 */

import { evaluateGate } from '../progress/gating';
import type { ProgressState } from '../progress/types';

import {
  UEP_ENTITY_ATTR,
  UEP_ENTITY_SELECTOR,
  UEP_REF_ATTR,
  entityKindLabel,
  isValidRef,
  metFlag,
  parseRef,
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
  /** 完整 ref（含 #entry: 錨點） */
  ref: string;
  /** ref 的頁面部分 */
  pageId: string;
  /** ref 的條目錨點（若有） */
  entryId?: string;
  /** 標記的顯示文字 */
  text?: string;
  /** 觸發來源的 History 頁面 id */
  sourcePageId?: string;
}

/**
 * entity 是否已解鎖：持有 `met:{ref}` 旗標或觀測者視角。
 * 無效 ref 一律視為未解鎖（普通文字，前台容錯）。
 */
export function isEntityUnlocked(state: ProgressState, ref: string): boolean {
  if (!isValidRef(ref)) return false;
  return evaluateGate(state, { requiresFlags: [metFlag(ref)] });
}

/**
 * 前台渲染前處理：已解鎖 entity 附加啟用屬性 + a11y 屬性，
 * 未解鎖維持原樣（普通文字）。
 *
 * 冪等：無論輸入是否殘留啟用屬性（防禦外部資料），
 * 一律先清除再依當前進度重算——進度變化（含觀測者切回探索者）
 * 時重跑即得正確結果。
 */
export function decorateInteractiveHtml(
  html: string,
  state: ProgressState
): string {
  if (!html || !html.includes(UEP_ENTITY_ATTR)) return html;
  if (typeof DOMParser === 'undefined') return html; // SSR 防禦

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll(UEP_ENTITY_SELECTOR).forEach((el) => {
    el.removeAttribute(UEP_ENTITY_ACTIVE_ATTR);
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.removeAttribute('aria-label');

    const ref = el.getAttribute(UEP_REF_ATTR) || '';
    if (!isEntityUnlocked(state, ref)) return;

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

  const { pageId, entryId } = parseRef(found.embed.ref);
  const detail: EntityActivateDetail = {
    kind: found.embed.kind,
    ref: found.embed.ref,
    pageId,
    ...(entryId ? { entryId } : {}),
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
