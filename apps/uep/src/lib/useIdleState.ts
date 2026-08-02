/**
 * activityWatch 的 React 訂閱入口（S10-4 A 段）
 *
 * 掛在 ReaderShell，五個 Reader 共用一份。**不要在各 Reader 各接一份**——
 * activityWatch 本身是單例，重複訂閱不會壞掉，但那會讓「誰在看活動狀態」
 * 散落五處。
 *
 * 重渲染的頻率就是狀態轉換的頻率（進 idle、離開 idle），不是活動事件的
 * 頻率——高頻事件在 activityWatch 內部只寫模組變數。
 */

import { useSyncExternalStore } from 'react';

import {
  getActivityState,
  subscribeActivity,
  type ActivityState,
} from './activityWatch';

/** SSR 快照。伺服器端沒有使用者活動可言，一律回「不閒置」 */
const SERVER_STATE: ActivityState = { idle: false, idleSince: null };

export function useIdleState(): ActivityState {
  return useSyncExternalStore(
    subscribeActivity,
    getActivityState,
    () => SERVER_STATE
  );
}
