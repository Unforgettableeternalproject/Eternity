import type { DossierGroup, DossierSubcat } from './types';

/**
 * 「尚未知」佔位條目的顯示文案。
 *
 * 佔位只在 Reader 渲染層合成，不存在於資料中：沒有 entityKey、不進
 * entity-index／terminal 檢索／跨區反查／別名比對，也不計入任何條目數。
 */
export const DOSSIER_UNKNOWN_PLACEHOLDER = {
  /** 條目序號欄位的符號 */
  mark: '◇',
  /** 條目名稱 */
  name: '這裡的一切都尚未知',
} as const;

/** Reader 渲染用的群組：`showUnknown` 為 true 時列表只渲染佔位條目 */
export interface DossierViewGroup extends DossierGroup {
  showUnknown: boolean;
}

export interface DossierViewSubcat extends Omit<DossierSubcat, 'groups'> {
  groups: DossierViewGroup[];
}

/**
 * 從 effective view 後的 subcategories 推導 Reader 要顯示的分類與群組。
 *
 * 上游 `resolveEffectiveViewForPage` 已把群組 gate 未通過的群組整組移除，
 * 所以這裡收到的每個群組都是「群組本身可見」；entries 為空代表群組
 * 底下沒有條目或條目全部未解鎖（觀測者視角下由上游以同一規則求值）。
 *
 * - 有可見條目的群組：照常顯示。
 * - 有名稱但無可見條目的群組：顯示並標記 `showUnknown`，由 Reader 合成佔位。
 * - 無名稱（含預設群組）且無可見條目的群組：不顯示，避免每份 dossier
 *   都多一個無標題的未知列。
 * - 沒有任何可顯示群組的分類：不顯示。
 */
export function buildDossierView(
  subcategories: DossierSubcat[]
): DossierViewSubcat[] {
  return subcategories
    .map((sc) => ({
      ...sc,
      groups: sc.groups
        .filter((g) => g.entries.length > 0 || (g.label ?? '').trim() !== '')
        .map((g) => ({ ...g, showUnknown: g.entries.length === 0 })),
    }))
    .filter((sc) => sc.groups.length > 0);
}
