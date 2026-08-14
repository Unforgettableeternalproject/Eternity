/**
 * RevisionSimulator — Revision 進度模擬預覽（Epic 2 S7-B）
 *
 * 設計依據 docs/agent/S7_CONCEPTS_DESIGN.md §4-4（必要功能——內容一多
 * 沒有模擬器就失控）+ B 排版定案（併入 RevisionModal 底部切換）：
 * - 旗標集合手動勾選（彙整各 revision.gate.requiresFlags）+ 自由輸入
 * - 觀測者視角切換（bypass requiresFlags 的既有語意，走真的 evaluateGate）
 * - 每個 revision 顯示 gate 通過與否；亂序狀態暴露（後段通過但前段
 *   未通過 → 警告可能的跳躍問題）
 * - effective view 以 applyRevisions 真算，JSON 呈現（所見即資料）
 */

import React, { useMemo, useState } from 'react';

import { createInitialState, evaluateGate } from '../../progress';
import type { ProgressState } from '../../progress';
import type { GateCondition } from '../../progress/gating';
import { applyRevisions, isEntryUnlocked } from '../concepts/revision';
import type { ConceptsRevision } from '../concepts/types';

interface RevisionSimulatorProps {
  /** 條目 base 資料（含 entityKey/revisions 也無妨，預覽前會剝除） */
  baseEntry: Record<string, unknown>;
  revisions: ConceptsRevision[];
  /** base 解鎖條件（S7 驗收 #4）——條目可見性的唯一閘門 */
  baseGate?: GateCondition | null;
  accent: string;
}

function buildSimulatedProgress(
  flags: string[],
  observer: boolean
): ProgressState {
  return {
    ...createInitialState(),
    flags,
    view: observer ? 'observer' : 'explorer',
    observerEver: observer,
  };
}

export default function RevisionSimulator({
  baseEntry,
  revisions,
  baseGate,
  accent,
}: RevisionSimulatorProps) {
  const [activeFlags, setActiveFlags] = useState<string[]>([]);
  const [customFlag, setCustomFlag] = useState('');
  const [observer, setObserver] = useState(false);

  /** 可勾選旗標 = base gate + 各 revision gate 的 requiresFlags 聯集 + 手動加入的 */
  const knownFlags = useMemo(() => {
    const flags = new Set<string>();
    for (const f of baseGate?.requiresFlags ?? []) flags.add(f);
    for (const rev of revisions) {
      for (const f of rev.gate?.requiresFlags ?? []) flags.add(f);
    }
    for (const f of activeFlags) flags.add(f);
    return Array.from(flags);
  }, [baseGate, revisions, activeFlags]);

  const progress = useMemo(
    () => buildSimulatedProgress(activeFlags, observer),
    [activeFlags, observer]
  );

  /** 每個 revision 的 gate 求值結果（宣告順序） */
  const gateResults = useMemo(
    () => revisions.map((rev) => evaluateGate(progress, rev.gate)),
    [revisions, progress]
  );

  // 條目可見性 = baseGate 單獨決定（2026-07-17 語意修正）
  const unlocked = isEntryUnlocked(progress, baseGate);
  /** base gate 自身的求值結果（有設定才顯示） */
  const baseGatePass = useMemo(
    () => (baseGate ? evaluateGate(progress, baseGate) : null),
    [baseGate, progress]
  );

  /** 亂序暴露：某 revision 通過但更前面有未通過的 → 可能的跳躍 */
  const outOfOrder = useMemo(() => {
    const warns: number[] = [];
    let seenFail = false;
    gateResults.forEach((pass, i) => {
      if (!pass) seenFail = true;
      else if (seenFail) warns.push(i);
    });
    return warns;
  }, [gateResults]);

  const effectiveView = useMemo(() => {
    const base = { ...baseEntry };
    delete base.revisions;
    delete base.entityKey;
    const resolved = applyRevisions(base, revisions, progress);
    delete (resolved as Record<string, unknown>).revisions;
    return resolved;
  }, [baseEntry, revisions, progress]);

  function toggleFlag(flag: string) {
    setActiveFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]
    );
  }

  function addCustomFlag() {
    const trimmed = customFlag.trim();
    if (!trimmed) return;
    if (!activeFlags.includes(trimmed))
      setActiveFlags((prev) => [...prev, trimmed]);
    setCustomFlag('');
  }

  return (
    <div className="ced-rev-sim">
      <div className="ced-rev-section-title">模擬旗標</div>
      <div className="ced-rev-sim-flags">
        {knownFlags.length === 0 && (
          <span className="ced-rev-sim-empty">
            尚無可模擬的旗標——revision 的解鎖條件設定後會列在這裡
          </span>
        )}
        {knownFlags.map((flag) => (
          <button
            key={flag}
            type="button"
            className={`ced-rev-sim-flag ${
              activeFlags.includes(flag) ? 'active' : ''
            }`}
            onClick={() => toggleFlag(flag)}
          >
            {flag}
          </button>
        ))}
      </div>
      <div className="ced-patch-remove-input">
        <input
          className="ced-input ced-entity-key-input"
          value={customFlag}
          placeholder="自訂旗標（如 xavier-colsono:03）"
          spellCheck={false}
          onChange={(e) => setCustomFlag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustomFlag();
            }
          }}
        />
        <button
          className="ced-add-btn"
          style={{ color: accent }}
          disabled={!customFlag.trim()}
          onClick={addCustomFlag}
        >
          ＋
        </button>
      </div>
      <label className="ced-checkbox-row">
        <input
          type="checkbox"
          checked={observer}
          onChange={(e) => setObserver(e.target.checked)}
        />
        <span>觀測者視角（bypass 旗標條件）</span>
      </label>

      <div className="ced-rev-section-title">求值結果</div>
      <div className="ced-rev-sim-status">
        條目狀態：
        {unlocked ? (
          <span className="ced-rev-sim-unlocked">可見</span>
        ) : (
          <span className="ced-rev-sim-locked">隱藏（未解鎖）</span>
        )}
      </div>
      <ul className="ced-rev-sim-results">
        {baseGatePass !== null && (
          <li className="ced-rev-sim-result">
            <span
              className={baseGatePass ? 'ced-rev-sim-pass' : 'ced-rev-sim-fail'}
            >
              {baseGatePass ? '✓' : '✗'}
            </span>
            <span className="ced-rev-item-id">base</span>
            <span className="ced-rev-sim-note">base 解鎖條件</span>
            {baseGate?.alwaysLocked && (
              <span className="ced-rev-sim-note">恆鎖定</span>
            )}
          </li>
        )}
        {revisions.map((rev, i) => (
          <li key={i} className="ced-rev-sim-result">
            <span
              className={
                gateResults[i] ? 'ced-rev-sim-pass' : 'ced-rev-sim-fail'
              }
            >
              {gateResults[i] ? '✓' : '✗'}
            </span>
            <span className="ced-rev-item-id">{rev.id || '(未命名)'}</span>
            {!rev.gate && <span className="ced-rev-sim-note">無條件</span>}
            {/* 恆鎖定的 ✗ 與「旗標沒給齊」的 ✗ 長得一樣——不標出來的話，
                旗標全打勾卻還是紅的會被當成求值器壞了 */}
            {rev.gate?.alwaysLocked && (
              <span className="ced-rev-sim-note">恆鎖定</span>
            )}
            {outOfOrder.includes(i) && (
              <span
                className="ced-rev-sim-warn"
                title="此 revision 通過但更前面的 revision 未通過——旗標授予順序可能跳躍"
              >
                ⚠ 亂序
              </span>
            )}
          </li>
        ))}
      </ul>
      {outOfOrder.length > 0 && (
        <div className="ced-rev-hint">
          ⚠ 有 revision 在前置 revision 未通過的狀態下先行套用——patch
          會照宣告順序疊加（通過就套），請確認這個旗標組合是否為劇情上
          可能出現的狀態。
        </div>
      )}

      <div className="ced-rev-section-title">Effective View（模擬結果）</div>
      <pre className="ced-rev-sim-json">
        {JSON.stringify(effectiveView, null, 2)}
      </pre>
    </div>
  );
}
