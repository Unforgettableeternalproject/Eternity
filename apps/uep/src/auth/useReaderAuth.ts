/**
 * UEP 讀者帳號 — React hook
 *
 * 讓 React island 訂閱全域 auth 狀態（跨 island 同步），
 * 模式與 useProgress 一致：useSyncExternalStore + window bridge。
 */

import { useSyncExternalStore } from 'react';

import { getReaderAuth } from './readerAuth';
import type { ReaderSession } from './readerAuth';

/** 訂閱全域讀者 session（null = 訪客） */
export function useReaderAuth(): ReaderSession | null {
  return useSyncExternalStore(
    (onChange) => getReaderAuth().subscribe(onChange),
    () => getReaderAuth().getSession(),
    () => null
  );
}
