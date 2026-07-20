/**
 * UEP 浮島系統 — 模組入口
 *
 * Epic 2 S6 的浮島框架。消費端一律從這裡 import，不要直接進子模組。
 *
 * 使用方式：
 * - 全域掛載：TopBar 掛 `<IslandHost />`（已接好，各頁不用自己掛）
 * - 各島實作：`registerIslandComponent(id, Component)` + 自己的內容元件
 * - 非 React（Astro script）：`getIslandRuntime()` + `ISLAND_CHANGE_EVENT`
 * - 解鎖：`unlockIsland(id)`（zone 首頁小物件呼叫）
 */

export type {
  IslandId,
  IslandCorner,
  IslandDefinition,
  IslandWindowState,
  IslandRelatedDetail,
} from './types';
export {
  ISLAND_DEFINITIONS,
  ISLAND_IDS,
  ISLAND_SCHEMA_VERSION,
  ISLAND_Z_BASE,
  ISLAND_RELATED_EVENT,
  createInitialWindowState,
  isIslandId,
} from './types';

export {
  ISLAND_STORAGE_PREFIX,
  islandStorageKey,
  loadWindowState,
  saveWindowState,
  normalizeWindowState,
} from './persistence';

export {
  uepIslands,
  getIslandRuntime,
  ISLAND_CHANGE_EVENT,
  ZONE_VISITED_FLAG_PREFIX,
  zoneVisitedFlag,
  hasVisitedZone,
  canUseIslands,
  isIslandUnlocked,
  isIslandDisabled,
  shouldMountIsland,
  unlockIsland,
} from './islandRuntime';
export type { IslandChangeDetail, IslandRuntimeState } from './islandRuntime';

export {
  clampToViewport,
  toRatio,
  fromRatio,
  resolveCornerPosition,
} from './dragPosition';
export type { XYPosition, PositionRatio } from './dragPosition';

export { useIslandRuntimeState } from './useIslands';

export { mountIslandsTestBridge } from './testBridge';

export {
  LOST_BOOKMARK_STEP_PCT,
  LOST_BOOKMARK_OPEN_GATE_EVENT,
  isLostBookmarkEligible,
  isLostBookmarkVisible,
  rollLostBookmark,
  dismissLostBookmark,
  settleLostBookmark,
  mountLostBookmarkTestBridge,
} from './history/lostBookmark';

export {
  UEP_PHANTOM_SHOW_EVENT,
  UEP_PHANTOM_SUGGESTION_EVENT,
  isPhantomEligibleDivision,
  isPhantomSuggestionEligible,
  canMirrorGallery,
  pushPhantomGallery,
  getPhantomGallery,
  clearPhantomGallery,
  pushPhantomSuggestion,
  consumePhantomSuggestion,
  clearPhantomSuggestion,
  pushClueGallery,
  restoreFromClueSnapshot,
  hasClueSnapshot,
  parsePhantomImages,
  UEP_CLUE_WAITING_EVENT,
  setClueWaitingCount,
  getClueWaitingCount,
} from './visuals/phantomBridge';
export type { PhantomGallery, PhantomImage } from './visuals/phantomBridge';

export { default as DraggableIsland } from './DraggableIsland';
export { default as IslandDock } from './IslandDock';
export { default as IslandHost } from './IslandHost';
export { default as IslandUnlockObject } from './IslandUnlockObject';
export { default as IslandSettingsPanel } from './IslandSettingsPanel';
