/**
 * 視角切換 — 探索者（Explorer）/ 觀測者（Observer）
 *
 * - 探索者 → 觀測者：先開啟「觀測者協議」儀式（劇透警告），
 *   確認後寫入永久印記 observerEver（不可逆）並播放切換儀式動畫。
 * - 觀測者 → 探索者：直接切回，播放切換儀式動畫；進度保留。
 * - 已有印記者再次切換至觀測者：不重複劇透儀式，直接切換動畫。
 *
 * S5 起撤出 TopBar，藏於識別證內。切換反饋從 toast 升級為
 * 全屏 ViewSwitchCeremony（打磨輪 3）——切身分是身分行為，值得儀式。
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';

import { getProgressManager } from '../../progress/progressStore';
import { useProgress } from '../../progress/useProgress';
import ObserverGate from './ObserverGate';
import ViewSwitchCeremony from './ViewSwitchCeremony';

import viewSwitchCss from './ViewSwitch.css?inline';
import { useDeferredStyle } from '../../islands/useDeferredStyle';

type View = 'explorer' | 'observer';

export default function ViewSwitch() {
  useDeferredStyle('view-switch', viewSwitchCss);
  const progress = useProgress();
  const [gateOpen, setGateOpen] = useState(false);
  /** 儀式進行中：記錄 from → to，動畫完成後真正 setView */
  const [ceremony, setCeremony] = useState<{ from: View; to: View } | null>(
    null
  );
  const isObserver = progress.view === 'observer';

  /** 啟動切換儀式；動畫完成後 store 才真正變更視角 */
  function startCeremony(to: View) {
    const from: View = isObserver ? 'observer' : 'explorer';
    if (from === to) return;
    setCeremony({ from, to });
  }

  function finishCeremony() {
    if (!ceremony) return;
    getProgressManager().setView(ceremony.to);
    setCeremony(null);
  }

  function handleClick() {
    if (isObserver) {
      // 觀測者 → 探索者：自由切回，進度保留
      startCeremony('explorer');
      return;
    }
    if (progress.observerEver) {
      // 已有印記：不重複劇透儀式，直接動畫切換
      startCeremony('observer');
      return;
    }
    setGateOpen(true);
  }

  function handleConfirm() {
    setGateOpen(false);
    startCeremony('observer');
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

      {ceremony && (
        <ViewSwitchCeremony
          from={ceremony.from}
          to={ceremony.to}
          onDone={finishCeremony}
        />
      )}
    </>
  );
}
