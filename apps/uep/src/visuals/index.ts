/**
 * Visuals 三態解鎖模組 — 模組入口（S8 下半場）
 *
 * 消費端一律從這裡 import，不要直接進子模組。
 *
 * 使用方式：
 * - 純函式判定：`resolveImageState`（單張圖片三態求值）
 * - 旗標推導：`deriveGalleryUnlockFlag`（V-D Visual Clue 授旗）
 * - 圖片授旗：`deriveImageUnlockFlag`（S8 #8 指定圖片／image gate）
 */

export type {
  ImageDisplayState,
  ImageGateData,
  ResolvedGalleryImage,
} from './threeState';
export {
  resolveImageState,
  resolveGalleryImages,
  deriveGalleryUnlockFlag,
  deriveImageUnlockFlag,
} from './threeState';
