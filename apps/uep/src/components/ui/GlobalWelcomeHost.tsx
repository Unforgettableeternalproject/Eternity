/**
 * 全域 Welcome 儀式主機（Epic 2 S5 打磨輪 3.5）
 *
 * 為什麼需要這個：登入完成後如果在 /login 頁把 WelcomeCeremony 播完再導頁，
 * 目標頁自己的入場動畫（主頁 lobbyBlock、zone entry）會在下方搶跑，導頁時
 * 識別證的接上動畫早已被覆蓋。改成——auth 成功後只存 sessionStorage flag +
 * 立刻導頁，目標頁掛載時由本元件檢查 flag 並播 WelcomeCeremony，
 * 播完 dispatch `uep:welcome-done` 事件讓識別證接上動畫接手。
 *
 * 掛在 DesignLayout body 內（跟 UepToast/UepDialog 同層），client:idle。
 * DesignLayout 的 inline lobbyBlock script 已同步加了 pending 判斷、若
 * pending 存在就 skip lobbyBlock 遮罩——本元件本身就是唯一遮罩。
 */

import React, { useEffect, useState } from 'react';

import WelcomeCeremony from './WelcomeCeremony';

/** sessionStorage flag：/login 頁 auth 成功後種下（JSON 內含 kind + alias） */
export const WELCOME_PENDING_KEY = 'uep.welcome.pending.v1';

/** 識別證訂閱此 event 得知 Welcome 儀式結束，可接續 arrival 動畫 */
export const WELCOME_DONE_EVENT = 'uep:welcome-done';

interface Pending {
  kind: 'login' | 'register' | 'logout';
  alias: string;
}

function readPending(): Pending | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(WELCOME_PENDING_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Partial<Pending>;
    if (
      (obj.kind !== 'login' &&
        obj.kind !== 'register' &&
        obj.kind !== 'logout') ||
      typeof obj.alias !== 'string'
    ) {
      /* 認不得的 flag 一定要清掉：留著的話 DesignLayout 的 inline script
         每一頁都會掛上 uep-welcome-pending class，而儀式永遠不會播——
         那個 class 是識別證的隱藏開關，等於每頁都要等保險計時器 */
      clearPending();
      return null;
    }
    return { kind: obj.kind, alias: obj.alias };
  } catch {
    clearPending();
    return null;
  }
}

function clearPending(): void {
  try {
    sessionStorage.removeItem(WELCOME_PENDING_KEY);
  } catch {
    /* 忽略 */
  }
}

export default function GlobalWelcomeHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const p = readPending();
    if (!p) return;
    /* 消費即清：flag 一被讀走就從 sessionStorage 移除，儀式狀態只留在
       記憶體。若等播完才清，使用者在這 2.2 秒內導航離開（例如登出儀式
       播到一半就去 /login），flag 會跟著到下一頁被重新讀取——看起來像
       動畫「接續播放」，實際上是從頭再播一次。
       離開頁面即作廢是刻意的契約：儀式不補播、不跨頁接續。 */
    clearPending();
    setPending(p);
  }, []);

  function handleDone() {
    /* 順序重要：
       1. 移除 body/html 的 uep-welcome-pending class——已經播完儀式，
          若使用者在頁面上再度導航（例如點側欄），入場動畫該恢復正常
       2. dispatch event 讓 identcard 接續 arrival
       3. unmount ceremony
       （sessionStorage flag 已在讀取時清掉，見上方 effect） */
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('uep-welcome-pending');
      document.body.classList.remove('uep-welcome-pending');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(WELCOME_DONE_EVENT));
    }
    setPending(null);
  }

  if (!pending) return null;

  return (
    <WelcomeCeremony
      kind={pending.kind}
      alias={pending.alias}
      onDone={handleDone}
    />
  );
}
