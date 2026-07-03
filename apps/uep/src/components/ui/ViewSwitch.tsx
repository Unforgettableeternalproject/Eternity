/**
 * 視角切換 — 探索者（Explorer）/ 觀測者（Observer）
 *
 * - 探索者 → 觀測者：開啟「觀測者協議」儀式（隆重劇透警告），
 *   確認後寫入永久印記 observerEver（不可逆）。
 * - 觀測者 → 探索者：直接切回，進度保留。
 * - 已有印記者再次切換至觀測者：不重複儀式，直接切換。
 */

import React, { useState, useEffect, useRef } from 'react';

import { getProgressManager } from '../../progress/progressStore';
import { useProgress } from '../../progress/useProgress';

import './ViewSwitch.css';

/* ── 觀測者協議（儀式警告） ── */

const PROTOCOL_LINES = [
  '你將卸下探索者的身分，以觀測者之眼俯瞰這個世界。',
  '所有篇章、所有記載、所有尚未揭曉的真相——都將對你敞開。這意味著大量的劇透。',
  '這個選擇會在你的存在上留下永久的印記。即使日後回到探索者的身分，印記也不會消失。',
  '而有些東西，只願意展現給從未見證過一切的人。',
];

/** 確認按鈕啟用前的等待時間（毫秒）——儀式感的一部分 */
const CONFIRM_DELAY_MS = 3200;

function ObserverGate({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [ready, setReady] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  /* 儀式文字讀完前不開放確認；reduced-motion 使用者不強制等待 */
  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setReady(true);
      return;
    }
    const t = setTimeout(() => setReady(true), CONFIRM_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    cancelRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div
      className="uep-viewgate"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="uep-viewgate-title"
    >
      <div className="uep-viewgate__veil" />
      <div className="uep-viewgate__panel">
        <div className="uep-viewgate__aperture" aria-hidden="true">
          ◉
        </div>
        <div className="uep-viewgate__kicker">OBSERVER PROTOCOL</div>
        <h2 id="uep-viewgate-title" className="uep-viewgate__title">
          觀測者協議
        </h2>
        <div className="uep-viewgate__lines">
          {PROTOCOL_LINES.map((line, i) => (
            <p
              key={i}
              className="uep-viewgate__line"
              style={{ animationDelay: `${0.6 + i * 0.65}s` }}
            >
              {line}
            </p>
          ))}
        </div>
        <div className="uep-viewgate__actions">
          <button
            ref={cancelRef}
            className="uep-viewgate__btn uep-viewgate__btn--stay"
            onClick={onCancel}
            type="button"
          >
            我要繼續探索
          </button>
          <button
            className="uep-viewgate__btn uep-viewgate__btn--become"
            onClick={onConfirm}
            disabled={!ready}
            type="button"
          >
            {ready ? '成為觀測者' : '⋯'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 切換按鈕 ── */

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
      {gateOpen && (
        <ObserverGate
          onConfirm={handleConfirm}
          onCancel={() => setGateOpen(false)}
        />
      )}
    </>
  );
}
