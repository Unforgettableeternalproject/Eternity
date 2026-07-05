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
} from './types';
export {
  ISLAND_DEFINITIONS,
  ISLAND_IDS,
  ISLAND_SCHEMA_VERSION,
  ISLAND_Z_BASE,
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
  canUseIslands,
  isIslandUnlocked,
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

export { default as DraggableIsland } from './DraggableIsland';
export { default as IslandDock } from './IslandDock';
export { default as IslandHost, registerIslandComponent } from './IslandHost';
