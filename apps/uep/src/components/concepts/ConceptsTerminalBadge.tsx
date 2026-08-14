/**
 * Concepts 解鎖儀式 — 斷線的終端（S9-B）
 *
 * Concepts landing 標題旁的終端狀態晶片。原本是一行寫死的
 * `$ root@uep:~ · CONNECTED`，S9-B 起改成浮島解鎖儀式的入口：
 *
 * | 狀態 | 顯示 |
 * |---|---|
 * | 有資格解鎖、尚未解鎖 | 紅色 `· DISCONNECTED`，可點 |
 * | 連線中（儀式進行） | `· CONNECTING…` |
 * | 已解鎖 | `· CONNECTED`（原樣） |
 * | 無資格（訪客／觀測者／手機） | 只留 `$ root@uep:~`，不顯示狀態字 |
 *
 * 最後一列是艾斯維爾 2026-07-25 定案：不是整個晶片消失（那會讓 landing
 * 版面缺一角），而是只去掉後面的狀態字樣——沒資格的人不該看到一個
 * 點不動的紅字，那看起來像壞掉。
 */

import React, { useEffect, useRef, useState } from 'react';

import {
  AWAKEN_MS,
  completeUnlockRitual,
  useUnlockEligibility,
} from '../../islands';
import { uepDialog } from '../ui/UepDialog';

const PROMPT = '$ root@uep:~';

export default function ConceptsTerminalBadge() {
  const { eligible, unlocked } = useUnlockEligibility('concepts');
  const [connecting, setConnecting] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function handleConnect() {
    if (connecting) return;
    // ⚠️ 必須走 window bridge，不能直接用 import 進來的 uepDialog：
    // ConceptsReader 是 client:only 的 React island，而 UepDialogContainer
    // 掛在 DesignLayout 的 client:idle——**兩個不同的 bundle**，各自有一份
    // module-level 的 uepDialog 單例。直接呼叫 import 的那份，訂閱在另一份
    // 上的 container 永遠收不到，promise 就這麼掛著、畫面毫無反應。
    const dialog = window.__uepDialogManager ?? uepDialog;
    const ok = await dialog.confirm('偵測到未連線的終端節點。要建立連線嗎？', {
      title: 'connection required',
      variant: 'terminal',
      confirmText: 'connect',
      cancelText: 'abort',
    });
    if (!ok) return;
    setConnecting(true);
    timerRef.current = window.setTimeout(() => {
      // 晶片回到 CONNECTED 本身就是回饋，但浮島解鎖仍照常報喜。
      // 對話框與這 1.4 秒之間可能已經登出／切成觀測者／縮到手機寬度，
      // 收束端會據此拒絕；拒絕時 chip 靠 eligible 自己退回對應狀態，
      // 這裡只要把 CONNECTING… 收掉即可（Codex 2026-07-25 review）。
      completeUnlockRitual('concepts');
      setConnecting(false);
      timerRef.current = null;
    }, AWAKEN_MS);
  }

  if (connecting) {
    return (
      <span className="conc-terminal-badge is-connecting" aria-live="polite">
        {PROMPT} · CONNECTING…
      </span>
    );
  }

  if (eligible) {
    return (
      <button
        type="button"
        className="conc-terminal-badge is-disconnected"
        onClick={() => void handleConnect()}
        title="終端節點未連線。點擊以建立連線。"
      >
        {PROMPT} · DISCONNECTED
      </button>
    );
  }

  if (unlocked) {
    return <span className="conc-terminal-badge">{PROMPT} · CONNECTED</span>;
  }

  // 無資格：只留提示符，不透露有東西可解鎖
  return <span className="conc-terminal-badge is-idle">{PROMPT}</span>;
}
