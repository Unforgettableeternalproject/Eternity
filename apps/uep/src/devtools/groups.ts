/**
 * DevTools 面板的群組清單（2026-08-03 精簡）
 *
 * 群組名原本是各 action 檔各自宣告的字串常數，14 組對 80 幾個 action——
 * 面板要捲很久，而且同一件事會因為檔案邊界被拆到兩組（書籤是 history 島的
 * 取得途徑卻自成一組、Echoes 收藏池本質就是旗標推導）。
 *
 * 這裡是**唯一事實來源**：跨檔共用同一組的（保護 + AFK／休息、旗標 +
 * 收藏池）靠 import 同一個常數，不靠兩邊各寫一次字串。字串一旦分兩處寫，
 * 改一邊就會靜默裂成兩組，而那是使用者要捲更久才會發現的錯。
 *
 * 陣列順序就是面板的顯示順序——常用的排前面，`getGroups()` 依這份清單排。
 */

export const GROUPS = {
  PROGRESS: '進度系統',
  FLAGS: '旗標與收藏',
  ISLANDS: '浮島與書籤',
  GUIDE: '浮島教學',
  READER: 'Reader 行為（保護／AFK／休息）',
  FOG: '進度迷霧',
  ONBOARDING: '入站儀式',
  AUDIO: '音訊',
} as const;

/** 面板顯示順序。不在清單裡的群組排到最後（按字母序） */
export const GROUP_ORDER: readonly string[] = [
  GROUPS.PROGRESS,
  GROUPS.FLAGS,
  GROUPS.ISLANDS,
  GROUPS.GUIDE,
  GROUPS.READER,
  GROUPS.FOG,
  GROUPS.ONBOARDING,
  GROUPS.AUDIO,
];
