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
  kind: 'login' | 'register';
  alias: string;
}

function readPending(): Pending | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(WELCOME_PENDING_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Partial<Pending>;
    if (
      (obj.kind !== 'login' && obj.kind !== 'register') ||
      typeof obj.alias !== 'string'
    ) {
      return null;
    }
    return { kind: obj.kind, alias: obj.alias };
  } catch {
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
    if (p) setPending(p);
  }, []);

  function handleDone() {
    /* 先清 flag、再 dispatch event、最後 unmount ceremony。
       順序重要：identcard 收到 event 時就不該再看見 pending，
       避免它反覆自旋 */
    clearPending();
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
