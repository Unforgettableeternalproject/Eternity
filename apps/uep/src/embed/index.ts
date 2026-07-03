/**
 * UEP 互動式嵌入 — 模組入口
 *
 * Epic 2 L2 互動樞紐的地基。消費端一律從這裡 import，不要直接進子模組。
 *
 * 使用方式：
 * - 編輯器（TipTap mark）：components/editor/UepEmbedMarks.ts
 * - 前台啟用/dispatcher：decorateInteractiveHtml + dispatchEntityActivate
 * - metadata 摘要：collectEmbeds
 */

export {
  UEP_ENTITY_ATTR,
  UEP_CUE_ATTR,
  UEP_REF_ATTR,
  UEP_ENTITY_SELECTOR,
  UEP_CUE_SELECTOR,
  ENTITY_KINDS,
  CUE_KINDS,
  entityKindLabel,
  metFlag,
  isValidRef,
  parseRef,
  readEmbedFromElement,
  collectEmbeds,
} from './marks';
export type { EntityKind, CueKind, EmbedRef, EmbedSummary } from './marks';

export {
  UEP_ENTITY_ACTIVE_ATTR,
  UEP_ENTITY_ACTIVE_SELECTOR,
  UEP_ENTITY_ACTIVATE_EVENT,
  isEntityUnlocked,
  decorateInteractiveHtml,
  dispatchEntityActivate,
} from './interactive';
export type { EntityActivateDetail } from './interactive';
