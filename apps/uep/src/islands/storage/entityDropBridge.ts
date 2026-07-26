/**
 * 便條紙 — entity 拖入橋（S10-1 便條擴充）
 *
 * 拖曳來源（History 互動式嵌入、各 zone 條目卡）與便條島分屬不同
 * React root／bundle，module-level 變數跨不過去——沿 phantomBridge 慣例
 * 走 window bridge 溝通（本模組不持有任何跨頁需要存活的狀態，
 * 每次呼叫都即時查詢 islandRuntime／progress 現況，不需要另外持久化）。
 *
 * 「必須展開才能接」的落地：拖曳來源端應在 `pointerup` 當下先呼叫
 * {@link isStorageIslandOpenAndExpanded}，收合態（含未解鎖／未掛載／
 * 被使用者停用）一律不接——連 ghost／連線視覺都不該出現，不是接了
 * 才在放開時失敗。
 *
 * entity 拖入是「純文字快速填入」（不存 ref，見設計文件 §7-3），
 * 因此 {@link dropEntityText} 直接複用既有的 `addStorageNote`，
 * 不需要任何新的資料模型。
 */

import { getProgressManager } from '../../progress';
import { getIslandRuntime, shouldMountIsland } from '../islandRuntime';

/**
 * 便條紙浮島目前是否「展開且可接受拖入」。
 *
 * 三個條件缺一即 false：
 * 1. `shouldMountIsland` — 探索者視角 + 已解鎖 + 未被使用者停用（未掛載的
 *    島談不上「展開」）
 * 2. 視窗狀態 `open === true` — 收合進 dock 的 chip 不算展開
 * 3. `typeof window !== 'undefined'` — SSR 防禦
 */
export function isStorageIslandOpenAndExpanded(): boolean {
  if (typeof window === 'undefined') return false;
  const progress = getProgressManager().getState();
  if (!shouldMountIsland(progress, 'storage')) return false;
  return getIslandRuntime().getWindow('storage')?.open === true;
}

/**
 * 拖入 entity 顯示名稱 → 快速建立一張純文字便條。
 *
 * 呼叫端（拖曳來源）負責在 `pointerup` 前先確認
 * {@link isStorageIslandOpenAndExpanded}；這裡仍重複防禦一次
 * （直接呼叫此函式的測試/未來呼叫端不必記得順序），收合態一律回傳 false
 * 且不建立便條。
 *
 * @returns 是否成功建立（收合態、空字串、便條已達上限皆回傳 false）
 */
export function dropEntityText(displayName: string): boolean {
  if (!isStorageIslandOpenAndExpanded()) return false;
  const clean = displayName.trim();
  if (!clean) return false;
  return getProgressManager().addStorageNote(clean);
}
