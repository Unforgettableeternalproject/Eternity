/**
 * RevisionModal — Concepts 條目的 Revision 時間線編輯 modal（Epic 2 S7-B）
 *
 * 設計依據 docs/agent/S7_CONCEPTS_DESIGN.md §4-3 + Sub-session B 排版定案：
 * revision 編輯不進右側詳情欄（會爆版面），開獨立 modal——
 * - 左欄：revision 時間線（base 虛擬項 + revision 鏈，可增刪、上下移）
 * - 右欄：選中 revision 的 id / GateConditionEditor / PatchEditor
 * - 四 stack 共用同一骨架，PatchEditor 依 stackStyle 動態渲染
 *
 * 語意備忘（2026-07-17 修正）：
 * - base 不是 revisions[0]——條目自身欄位就是 base 內容，時間線上的
 *   base 卡片是唯讀說明項
 * - 條目可見性由 base gate 單獨決定（未設 = 永遠可見）；revision gate
 *   只控制 patch 套用時機，不鎖條目也不反向開鎖
 * - gate 為 null 的 revision = 無條件套用
 * - 宣告順序 = 劇情揭露順序，resolver 不重排（亂序防禦見 revision.ts）
 */

/* global structuredClone */

import React, { useState } from 'react';

import type { GateCondition } from '../../progress/gating';
import type {
  ChronoFieldDef,
  ConceptsRevision,
  ConceptsVariationMeta,
} from '../concepts/types';

import GateConditionEditor from './GateConditionEditor';
import { API_BASE, getDialog } from './editorHelpers';
import PatchEditor from './PatchEditor';
import RevisionSimulator from './RevisionSimulator';

type StackKind = ConceptsVariationMeta['stack_style'];

/** 時間線選取狀態：base 虛擬項或 revisions 索引 */
type Selection = 'base' | number;

interface RevisionModalProps {
  /** 條目顯示名稱（dossier=name、browser=name、chrono=year、diff=term） */
  entryLabel: string;
  stackStyle: StackKind;
  /** 條目 entityKey——新 revision 的預設 id 依旗標慣例產生 */
  entityKey?: string;
  /** 條目 base 資料（進度模擬預覽用；含 revisions/entityKey 也無妨） */
  baseEntry: Record<string, unknown>;
  revisions: ConceptsRevision[];
  onChange: (revisions: ConceptsRevision[]) => void;
  /** base 解鎖條件（S7 驗收 #4）：條目可見性的唯一閘門（未設 = 永遠可見） */
  baseGate?: GateCondition | null;
  /** base gate 變更回寫（未提供時 base 卡不顯示條件編輯器） */
  onBaseGateChange?: (gate: GateCondition | null) => void;
  /** chrono 專用（S7 驗收 #7）：pool fieldDefs，事件列 patch 下拉選擇 */
  chronoFieldDefs?: ChronoFieldDef[];
  onClose: () => void;
  accent: string;
}

/** 新 revision 的預設 id：有 entityKey 走旗標慣例 {key}:{NN}，否則 rev-N */
function defaultRevisionId(
  entityKey: string | undefined,
  count: number
): string {
  if (entityKey) return `${entityKey}:${String(count + 1).padStart(2, '0')}`;
  return `rev-${count + 1}`;
}

export default function RevisionModal({
  entryLabel,
  stackStyle,
  entityKey,
  baseEntry,
  revisions,
  onChange,
  baseGate,
  onBaseGateChange,
  chronoFieldDefs,
  onClose,
  accent,
}: RevisionModalProps) {
  const [selected, setSelected] = useState<Selection>(
    revisions.length > 0 ? 0 : 'base'
  );
  const [simOpen, setSimOpen] = useState(false);
  /** patch 整包替換（複製上一版）時 bump——PatchEditor 內的 MiniEditor
      只吃初始值，必須 remount 才會顯示新內容 */
  const [patchVersion, setPatchVersion] = useState(0);

  const current =
    typeof selected === 'number' ? (revisions[selected] ?? null) : null;

  function updateRevision(idx: number, patch: Partial<ConceptsRevision>) {
    onChange(revisions.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRevision() {
    const next: ConceptsRevision = {
      id: defaultRevisionId(entityKey, revisions.length),
      gate: null,
      patch: {},
    };
    onChange([...revisions, next]);
    setSelected(revisions.length);
  }

  async function removeRevision(idx: number) {
    const target = revisions[idx];
    const ok = await getDialog().confirm(
      `確定刪除 revision「${target.id || '(未命名)'}」？此操作無法復原。`,
      { title: '刪除 Revision', confirmText: '刪除', cancelText: '取消' }
    );
    if (!ok) return;
    const next = revisions.filter((_, i) => i !== idx);
    onChange(next);
    if (typeof selected === 'number') {
      if (selected === idx) setSelected(next.length > 0 ? 0 : 'base');
      else if (selected > idx) setSelected(selected - 1);
    }
  }

  function moveRevision(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= revisions.length) return;
    const next = [...revisions];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
    if (selected === idx) setSelected(target);
    else if (selected === target) setSelected(idx);
  }

  /** patch 是否已有內容（複製上一版前的覆蓋確認判定） */
  function patchHasContent(patch: ConceptsRevision['patch'] | undefined) {
    if (!patch) return false;
    const setCount = patch.set ? Object.keys(patch.set).length : 0;
    const removeCount = patch.remove?.length ?? 0;
    return setCount > 0 || removeCount > 0;
  }

  /** 從上一版複製 patch 內容作為起點（S7 驗收 #6：PATCH 繼承） */
  async function copyPreviousPatch() {
    if (typeof selected !== 'number' || selected <= 0) return;
    const prev = revisions[selected - 1];
    if (!prev) return;
    if (patchHasContent(current?.patch)) {
      const ok = await getDialog().confirm(
        `目前的 patch 內容會被「${prev.id || '(未命名)'}」的 patch 覆蓋，確定？`,
        { title: '複製上一版 Patch', confirmText: '覆蓋', cancelText: '取消' }
      );
      if (!ok) return;
    }
    updateRevision(selected, { patch: structuredClone(prev.patch ?? {}) });
    setPatchVersion((v) => v + 1);
  }

  return (
    <div className="ced-picker-overlay" onClick={onClose}>
      <div
        className="ced-picker-modal ced-rev-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ '--ced-accent': accent } as React.CSSProperties}
      >
        <div className="ced-picker-header">
          <strong>進度版本</strong>
          <span className="ced-rev-header-entry">{entryLabel}</span>
          <span className="ced-rev-header-stack">{stackStyle}</span>
          <button
            className="ced-del-btn"
            onClick={onClose}
            style={{ marginLeft: 'auto' }}
          >
            ✕
          </button>
        </div>

        <div className="ced-rev-body">
          {/* 左欄：時間線 */}
          <div className="ced-rev-list">
            <button
              className={`ced-rev-item ${selected === 'base' ? 'active' : ''}`}
              onClick={() => setSelected('base')}
            >
              <span className="ced-rev-item-id">base</span>
              <span className="ced-rev-item-note">
                {baseGate ? '⚑ 有解鎖條件' : '◉ 預設可見'}
              </span>
            </button>

            {revisions.map((rev, i) => (
              <div
                key={i}
                className={`ced-rev-item ced-rev-item--rev ${
                  selected === i ? 'active' : ''
                }`}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(i);
                  }
                }}
              >
                <span className="ced-rev-item-id">{rev.id || '(未命名)'}</span>
                <span className="ced-rev-item-note">
                  {rev.gate ? '⚑ 有解鎖條件' : '無條件'}
                </span>
                <span className="ced-rev-item-actions">
                  <button
                    className="ced-rev-move-btn"
                    disabled={i === 0}
                    title="上移"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveRevision(i, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="ced-rev-move-btn"
                    disabled={i === revisions.length - 1}
                    title="下移"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveRevision(i, 1);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    className="ced-rev-move-btn ced-rev-del-btn"
                    title="刪除"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeRevision(i);
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}

            <button
              className="ced-add-btn ced-rev-add-btn"
              onClick={addRevision}
              style={{ color: accent }}
            >
              + 新增 Revision
            </button>
          </div>

          {/* 右欄：選中項編輯 */}
          <div className="ced-rev-detail">
            {selected === 'base' ? (
              <div className="ced-rev-base-info">
                <div className="ced-rev-section-title">BASE</div>
                <p>
                  條目在詳情欄編輯的欄位就是 base 內容——讀者最初認識這個
                  條目時看到的樣子。
                </p>
                <p>
                  {stackStyle === 'browser' ? (
                    <>
                      Browser profile 未解鎖時顯示 placeholder
                      鎖定佔位（「知道有尚未認識的角色存在」是設計意圖）； 首個
                      revision 的 patch 通常設 placeholder=false
                      並補上完整內容。
                    </>
                  ) : (
                    <>
                      條目的可見性由 base 解鎖條件（下方）單獨決定——
                      未設定條件時條目一開始就可見；設定後在條件通過前
                      整條隱藏。revision 只影響內容演進（patch
                      的套用時機），不會鎖住條目、也不會提前開鎖。
                    </>
                  )}
                </p>
                {onBaseGateChange && (
                  <>
                    <div className="ced-rev-section-title">BASE 解鎖條件</div>
                    <div className="ced-rev-gate">
                      <GateConditionEditor
                        value={baseGate ?? null}
                        onChange={onBaseGateChange}
                        apiBase={API_BASE}
                        accent={accent}
                        showAlwaysLocked
                      />
                    </div>
                  </>
                )}
                {revisions.length === 0 && (
                  <p className="ced-rev-hint">
                    尚無 revision——此條目不隨進度演進。點左欄「+ 新增
                    Revision」開始建立認知演進鏈。
                  </p>
                )}
              </div>
            ) : current ? (
              <>
                <div className="ced-field-row">
                  <label className="ced-label">revision id</label>
                  <input
                    className="ced-input ced-entity-key-input"
                    value={current.id}
                    onChange={(e) =>
                      updateRevision(selected as number, {
                        id: e.target.value,
                      })
                    }
                    placeholder={entityKey ? `如 ${entityKey}:01` : '如 rev-1'}
                    spellCheck={false}
                  />
                </div>

                <div className="ced-rev-section-title">解鎖條件</div>
                <div className="ced-rev-gate">
                  <GateConditionEditor
                    value={current.gate}
                    onChange={(gate) =>
                      updateRevision(selected as number, { gate })
                    }
                    apiBase={API_BASE}
                    accent={accent}
                    showAlwaysLocked
                  />
                </div>
                {!current.gate && (
                  <div className="ced-rev-hint">
                    ⓘ 無條件的 revision 會永遠套用——通常 revision
                    應設定旗標條件（慣例 {entityKey || '{entityKey}'}
                    :01、:02…）。
                  </div>
                )}

                <div className="ced-rev-section-title ced-rev-patch-title">
                  <span>Patch</span>
                  {typeof selected === 'number' && selected > 0 && (
                    <button
                      type="button"
                      className="ced-add-btn"
                      style={{ color: accent }}
                      title={`複製「${revisions[selected - 1]?.id || '(未命名)'}」的 patch 內容作為起點`}
                      onClick={() => void copyPreviousPatch()}
                    >
                      ⧉ 複製上一版
                    </button>
                  )}
                </div>
                {/* key=selected-patchVersion：切換 revision 或整包複製時
                    整棵 remount——MiniEditor content 只吃初始值，且同時
                    只有選中的 revision 會實例化 TipTap（惰性 mount） */}
                <PatchEditor
                  key={`${selected}-${patchVersion}`}
                  stackStyle={stackStyle}
                  patch={current.patch ?? {}}
                  onChange={(patch) =>
                    updateRevision(selected as number, { patch })
                  }
                  chronoFieldDefs={chronoFieldDefs}
                  entityKey={entityKey}
                  accent={accent}
                />
              </>
            ) : (
              <div className="ced-rev-base-info">選擇左欄的項目</div>
            )}
          </div>
        </div>

        {/* 底部：進度模擬預覽切換（B 排版定案：RevisionSimulator 併入 modal） */}
        <div className="ced-rev-footer">
          <button
            type="button"
            className={`ced-rev-sim-toggle ${simOpen ? 'active' : ''}`}
            onClick={() => setSimOpen((v) => !v)}
          >
            {simOpen ? '▾ 收起模擬預覽' : '▸ 進度模擬預覽'}
          </button>
        </div>
        {simOpen && (
          <RevisionSimulator
            baseEntry={baseEntry}
            revisions={revisions}
            baseGate={baseGate}
            accent={accent}
          />
        )}
      </div>
    </div>
  );
}
