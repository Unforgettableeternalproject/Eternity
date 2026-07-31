/**
 * UEP 進度系統 — 模組入口
 *
 * Epic 2 的地基。消費端一律從這裡 import，不要直接進子模組。
 *
 * 使用方式：
 * - React 元件：`useProgress()` / `useGate(condition)`
 * - 非 React（Astro script）：`getProgressManager()` + `PROGRESS_CHANGE_EVENT`
 * - 純函式判定：`evaluateGate(state, condition)`
 */

export type {
  ViewMode,
  ProgressState,
  ProgressAdapter,
  PageMarkerProgress,
  StorageNote,
  StorageNoteLocationSnapshot,
} from './types';
export {
  PROGRESS_SCHEMA_VERSION,
  LOST_BOOKMARK_BASE_PCT,
  LOST_BOOKMARK_STEP_PCT,
  LOST_BOOKMARK_MAX_MISS,
  STORAGE_NOTE_MAX,
  STORAGE_NOTE_TEXT_MAX,
  STORAGE_NOTE_LOCATION_LABEL_MAX,
  createInitialState,
} from './types';

export {
  LocalStorageAdapter,
  PROGRESS_STORAGE_KEY,
  normalizeState,
} from './adapters';

export {
  uepProgress,
  getProgressManager,
  PROGRESS_CHANGE_EVENT,
} from './progressStore';
export type { ProgressChangeDetail } from './progressStore';

export {
  evaluateGate,
  parseGateCondition,
  isProgressPage,
  isGateExempt,
  isPristine,
  hasAllFlags,
  effectiveGate,
  evaluateEffectiveGate,
  isEffectivelyCompleted,
  COMPLETION_FLAG_PREFIX,
} from './gating';
export type { GateCondition } from './gating';

export {
  collectProgressLeafIds,
  isEffectiveProgressPage,
  buildProgressTreeAdapter,
} from './tree';
export type {
  ProgressTreeAdapter,
  TreeNodeLike,
  ProgressTreeNode,
  AdapterTreeNode,
} from './tree';

export {
  PROGRESS_MARKER_ROLE,
  PROGRESS_MARKER_SELECTOR,
  VISUAL_CLUE_START_ROLE,
  VISUAL_CLUE_GATE_ROLE,
  VISUAL_CLUE_END_ROLE,
  parseFlagsAttr,
  serializeFlagsAttr,
  collectMarkers,
  isPageCompleted,
  completionFlag,
  resolveResumeMarkerIdx,
} from './markers';
export type { ScanMarker } from './markers';

export { useProgress, useGate } from './useProgress';

export { createScanline } from './scanline';
export type {
  ScanlineOptions,
  ScanlineHandle,
  MarkerPassedInfo,
} from './scanline';

export { useScanline } from './useScanline';
export type { UseScanlineOptions } from './useScanline';

export {
  FOG_JUMP_THRESHOLD_VH,
  FOG_MAX_ADVANCE_VH_PER_SEC,
  computeContentRatio,
  computeElementRatio,
  isNonScrollable,
  isWithinFogReach,
  limitFogAdvance,
  ratioToScrollTop,
} from './fogGate';
