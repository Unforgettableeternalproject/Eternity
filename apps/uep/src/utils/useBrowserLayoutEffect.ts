import { useEffect, useLayoutEffect } from 'react';

/**
 * SSR 安全的 useLayoutEffect。
 *
 * React 在伺服器端跑到 useLayoutEffect 會警告「does nothing on the server」——
 * 佈局副作用無法編碼進 SSR 輸出。兩站的 island 多半是 client:load，SSR 一定
 * 會 render 一次，所以凡是量測 DOM 的 effect 都該走這個。
 *
 * 瀏覽器端行為與 useLayoutEffect 完全相同（paint 前同步執行），
 * 伺服器端退化成 useEffect（本來就不會執行），沒有行為差異。
 */
export const useBrowserLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
