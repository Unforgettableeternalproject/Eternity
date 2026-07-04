/**
 * 視角切換 — 探索者（Explorer）/ 觀測者（Observer）
 *
 * - 探索者 → 觀測者：開啟「觀測者協議」儀式（隆重劇透警告），
 *   確認後寫入永久印記 observerEver（不可逆）。
 * - 觀測者 → 探索者：直接切回，進度保留。
 * - 已有印記者再次切換至觀測者：不重複儀式，直接切換。
 *
 * S5 起撤出 TopBar，藏於記錄面板（RecordPanel）內。
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';

import { getProgressManager } from '../../progress/progressStore';
import { useProgress } from '../../progress/useProgress';
import ObserverGate from './ObserverGate';

import './ViewSwitch.css';

export default function ViewSwitch() {
  const progress = useProgress();
  const [gateOpen, setGateOpen] = useState(false);
  const isObserver = progress.view === 'observer';

  function toast(message: string) {
    window.__uepToastManager?.info(message);
  }

  function handleClick() {
    const mgr = getProgressManager();
    if (isObserver) {
      // 觀測者 → 探索者：自由切回，進度保留
      mgr.setView('explorer');
      toast('你回到了探索者的身分。旅程仍在原處等你。');
      return;
    }
    if (progress.observerEver) {
      // 已有印記：不重複儀式
      mgr.setView('observer');
      toast('觀測者之眼再度開啟。');
      return;
    }
    setGateOpen(true);
  }

  function handleConfirm() {
    getProgressManager().setView('observer');
    setGateOpen(false);
    toast('印記已烙下。歡迎，觀測者。');
  }

  return (
    <>
      <button
        className="btn-outline uep-viewswitch"
        onClick={handleClick}
        style={{ padding: '8px 14px' }}
        title={
          isObserver
            ? '回到探索者身分（進度保留）'
            : '切換至觀測者視角（全知，但將留下印記）'
        }
      >
        {isObserver ? '◉ 觀測者' : '◈ 探索者'}
      </button>
      {/* Portal 到 body：識別證翻面用 rotateY + preserve-3d 建立 stacking
          context，會鎖住裡頭 fixed 定位的元素（含 ObserverGate 遮罩）。
          掛到 body 才能真正全屏覆蓋。SSR 時 document 不存在，先擋掉 */}
      {gateOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <ObserverGate
            onConfirm={handleConfirm}
            onCancel={() => setGateOpen(false)}
          />,
          document.body
        )}
    </>
  );
}
