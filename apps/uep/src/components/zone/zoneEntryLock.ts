/**
 * 區域入場動畫期間的浮動 UI 鎖（body class + ref-count）
 *
 * 入場動畫（IntroOverlay 350~600 / PortalTransition 600 / zone boot 350）
 * 的 z-index 都低於浮島層（2000+），直接調高動畫層級會跟 Dialog(3000+)
 * 打架，所以沿用 S5 OnboardingGate 的 body class 前例：動畫播放期間掛
 * `uep-zone-entry-active`，CSS 一次隱藏浮島 / dock / 解鎖物件 / Minimap。
 *
 * 多個來源可能重疊（portal 轉場接 zone boot），單純 classList.toggle
 * 會互相清掉，因此用 ref-count：任一來源持有鎖時 class 就在。
 */

/** 入場動畫期間掛在 body 上的 class（CSS 規則見 islands/islands.css） */
export const ZONE_ENTRY_ACTIVE_CLASS = 'uep-zone-entry-active';

let lockCount = 0;
const listeners = new Set<() => void>();

function sync(): void {
  if (typeof document !== 'undefined') {
    document.body.classList.toggle(ZONE_ENTRY_ACTIVE_CLASS, lockCount > 0);
  }
  listeners.forEach((listener) => listener());
}

/**
 * 訂閱鎖狀態變化（S9-D.2）。
 *
 * body class 對「隱藏」夠用，但對「先播離場動畫再隱藏」不夠——那需要
 * React 端知道時機。浮島本體與 dock 因此改由元件訂閱後自行播動畫，
 * 不再吃 CSS 的 display:none（Minimap／釘選便條仍走 class）。
 */
export function subscribeZoneEntry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 取得入場動畫鎖，回傳釋放函式（重複呼叫安全）。
 * 用法：`useEffect(() => { if (!active) return; return acquireZoneEntryLock(); }, [active])`
 */
export function acquireZoneEntryLock(): () => void {
  let released = false;
  lockCount += 1;
  sync();
  return () => {
    if (released) return;
    released = true;
    lockCount -= 1;
    sync();
  };
}

/** 目前是否有入場動畫在播（測試/除錯用） */
export function isZoneEntryActive(): boolean {
  return lockCount > 0;
}

/** 測試用：重置鎖狀態 */
export function resetZoneEntryLock(): void {
  lockCount = 0;
  sync();
}
