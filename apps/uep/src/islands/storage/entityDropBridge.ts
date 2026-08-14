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
 *
 * 填入的文字一律是該 entity 在 Concepts **dossier** 裡的名稱，不是拖曳
 * 來源上顯示的字（艾斯維爾 2026-07-27 定案，見
 * {@link findCanonicalEntityName}）——dossier 條目是 canonical entity，
 * 其他地方都是它的引用。
 */

import { getProgressManager } from '../../progress';
import type { ProgressState } from '../../progress/types';
import {
  isIndexEntryUnlocked,
  type TerminalIndexEntry,
} from '../concepts/terminalCore';
import { getIslandRuntime, shouldMountIsland } from '../islandRuntime';

import { isUnpinDropTarget } from './dragToPin';

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

/**
 * 放開點是否落在展開的便條島上（＝這一拖要落地）。
 *
 * 與 `isUnpinDropTarget` 是**同一個幾何判定**（同一個島、同一個
 * selector），只是語意相反：那邊是「把釘在頁面上的便條收回島裡」，
 * 這邊是「把 entity 名稱丟進島裡變成新便條」。共用實作，避免兩處
 * selector 各寫一份日後改島 class 時漏掉一邊。
 *
 * ⚠️ 呼叫端必須讓拖曳中的 ghost 保持 `pointer-events: none`，
 * 否則 `elementFromPoint` 會命中 ghost 自己而永遠判不到島。
 */
export function isEntityDropTarget(clientX: number, clientY: number): boolean {
  return isUnpinDropTarget(clientX, clientY);
}

/**
 * 找出 entityKey 的 canonical 顯示名稱（艾斯維爾 2026-07-27 定案）。
 *
 * 「拖進便條的文字一律是該 entity 在 Concepts **dossier** 裡的名稱」——
 * dossier 條目才是 canonical entity，browser／chrono／diff 的同名條目
 * 是它的延伸呈現，不是命名來源。因此：
 *
 * - dossier 查得到 → 可拖，文字用 dossier 條目的 `name`
 * - dossier 查不到（只在別的 stack 定義／根本沒定義／storyKey 命名空間）
 *   → **不可拖**，回傳 null
 *
 * 未解鎖的 dossier 條目一律不算數（回 null）——否則拖一下就能把還沒讀到
 * 的角色名字撈進便條，等於繞過條目級進度閘漏名字。與 terminal 檢索
 * 「未解鎖條目直接隱藏」同一條防洩漏規則。
 *
 * 同一個 key 在多個 variant 各有一條是常態（S7 revision 的時代版本），
 * 取第一個已解鎖的即可——同一實體的不同時代版本名稱本來就相同。
 *
 * @param entries 已載入的 Concepts entity index；null（未載入／載入失敗）
 *   一律回 null，安全預設是「不可拖」
 */
export function findCanonicalEntityName(
  entries: TerminalIndexEntry[] | null,
  entityKey: string,
  progress: ProgressState
): string | null {
  if (!entries) return null;
  const key = entityKey.trim();
  if (!key) return null;
  const hit = entries.find(
    (entry) =>
      entry.stack === 'dossier' &&
      entry.entityKey === key &&
      isIndexEntryUnlocked(entry, progress)
  );
  return hit?.name.trim() || null;
}
