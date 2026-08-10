/**
 * UEP 系統旗標的授予主機
 *
 * 掛在 DesignLayout（全站、`client:load`），**沒有任何守門**——這是它與
 * `IslandHost` 的關鍵差異：浮島限桌面已登入探索者，而「進過這個網站」
 * 這種事對誰都成立。
 *
 * ⚠️ 必須 `client:load` 不能 `client:idle`：`requestIdleCallback` 在主
 * 執行緒持續繁忙時可以無限期不觸發（站內既有教訓，見 DesignLayout 對
 * Toast/Dialog 的註解）。旗標本身不急，但「永遠不觸發」等於這支旗標
 * 不存在，而症狀是 gate 永久鎖死。
 *
 * 這裡不放 `uep:teatime`（茶會頁自己授予）與 `uep:afk`（閒置帷幕自己
 * 授予）——那兩件事有明確的發生地點，硬拉到全站主機反而要把狀態繞出來。
 */

import { useEffect } from 'react';

import { getProgressManager } from './progressStore';
import {
  UEP_FLAGS,
  markUepFromFar,
  markUepIntro,
  syncDerivedUepFlags,
} from './uepFlags';

/** 主站 Portal widget 帶過來的記號（見 apps/root 的 WidgetPortal） */
const PORTAL_PARAM = 'from';
const PORTAL_VALUE = 'portal';

export default function UepFlagsHost() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viaPortal = params.get(PORTAL_PARAM) === PORTAL_VALUE;

    // ⚠️ 順序有意義：from-far 的條件是「**這一次進站之前**就已經有 intro」，
    // 而 intro 馬上就要在下一行授予。先讀後給，否則第一次穿門進來的人
    // 也會拿到 from-far。
    const hadIntro = getProgressManager().hasFlag(UEP_FLAGS.intro);
    if (viaPortal && hadIntro) markUepFromFar();
    markUepIntro();

    if (viaPortal) {
      // 記號消費掉就從網址移除：留著的話重整一次就會再判定一次，而且
      // 使用者複製出去的連結會帶著一個對別人沒有意義的參數。
      params.delete(PORTAL_PARAM);
      const query = params.toString();
      window.history.replaceState(
        {},
        '',
        window.location.pathname + (query ? `?${query}` : '')
      );
    }
  }, []);

  // 推導型旗標（all-zone / all-island）：條件是「其他狀態湊齊了」，
  // 湊齊的那一刻可能是本機動作，也可能是遠端 hydrate 帶回另一台裝置的
  // 進度，所以每次變動都重算。已持有時 grantFlags 會自己濾掉，不會迴圈。
  useEffect(() => {
    syncDerivedUepFlags();
    return getProgressManager().subscribe(() => syncDerivedUepFlags());
  }, []);

  return null;
}
