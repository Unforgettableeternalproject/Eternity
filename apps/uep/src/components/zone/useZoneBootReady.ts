import { useCallback, useEffect, useRef, useState } from 'react';

interface UseZoneBootReadyOptions {
  /** boot 動畫最短顯示時間（ms），預設 1800 */
  minDisplayMs?: number;
  /** 安全超時（ms），預設 5000 */
  timeoutMs?: number;
}

/**
 * Zone boot 動畫統一解除 hook
 *
 * 用法：
 *   const { contentReady, markContentReady, setNavPending } = useZoneBootReady();
 *   // 主要資料載入完成時呼叫 markContentReady()
 *   // 有 deep link 時先 setNavPending(true)，導航完成後 setNavPending(false)
 */
export function useZoneBootReady(opts?: UseZoneBootReadyOptions) {
  const { minDisplayMs = 1800, timeoutMs = 5000 } = opts || {};

  const [contentReady, setContentReady] = useState(false);
  const bootMountTime = useRef(Date.now());
  const bootFired = useRef(false);
  const dataLoaded = useRef(false);
  const navPendingRef = useRef(false);

  const tryBootReady = useCallback(() => {
    if (!dataLoaded.current || navPendingRef.current || bootFired.current)
      return;
    bootFired.current = true;
    const elapsed = Date.now() - bootMountTime.current;
    const delay = Math.max(0, minDisplayMs - elapsed);
    setTimeout(() => setContentReady(true), delay);
  }, [minDisplayMs]);

  const markContentReady = useCallback(() => {
    dataLoaded.current = true;
    tryBootReady();
  }, [tryBootReady]);

  const setNavPending = useCallback(
    (pending: boolean) => {
      navPendingRef.current = pending;
      if (!pending) tryBootReady();
    },
    [tryBootReady]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if (!bootFired.current) {
        bootFired.current = true;
        dataLoaded.current = true;
        navPendingRef.current = false;
        setContentReady(true);
      }
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [timeoutMs]);

  return { contentReady, markContentReady, setNavPending };
}
