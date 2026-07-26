/**
 * 便條地點／時間小標的顯示格式（S10-1 便條擴充）
 *
 * 島內的便條卡（StorageIsland）與釘在頁面上的便條（PinnedNoteLayer）是
 * 兩個獨立的渲染路徑，但顯示的是**同一張便條的同一份快照**——格式化規則
 * 放在這裡共用，避免兩邊各寫一份而在日後改格式時漏掉一邊。
 *
 * 樣式不共用：島內是紙上的小字、釘選是頁面上的浮貼，尺寸與配色本來就
 * 各自定義，共用的只有「顯示成什麼文字」。
 */

import { ZONE_LABELS } from '../useCurrentLocation';

/** 地點小標顯示文字：zone 中文名，未知 zone 回退顯示原字串（同位置條慣例） */
export function formatZoneLabel(zone: string): string {
  return ZONE_LABELS[zone] ?? (zone || '其他頁面');
}

/**
 * 時間小標顯示文字：擷取 `YYYY-MM-DD HH:mm`（含時區偏移的完整字串放
 * title tooltip，不在便條卡面上占空間）。
 */
export function formatCapturedAt(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

/**
 * 地點小標的完整文字（zone + 頁面名稱）。
 *
 * pageLabel 可能為空字串（Reader 尚未發佈 pageContext 就勾選），
 * 這時只顯示 zone——不留一個懸空的分隔點。
 */
export function formatLocationLabel(location: {
  zone: string;
  pageLabel?: string;
}): string {
  const zone = formatZoneLabel(location.zone);
  return location.pageLabel ? `${zone} · ${location.pageLabel}` : zone;
}
