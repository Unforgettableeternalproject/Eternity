/**
 * pinnedStore 的 React hook（訂閱釘選變化）
 */
import { useSyncExternalStore } from 'react';

import { getPinnedStore, uepStoragePins } from './pinnedStore';
import type { PinnedNote } from './pinnedStore';

/** 訂閱釘選狀態（跨 island 同步） */
export function usePinnedNotes(): PinnedNote[] {
  return useSyncExternalStore(
    (onChange) => getPinnedStore().subscribe(() => onChange()),
    () => getPinnedStore().getAll(),
    () => uepStoragePins.getAll()
  );
}
