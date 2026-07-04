/**
 * 進度條件編輯器（Epic 2 內容閘門）
 *
 * 在 Inspector 中編輯頁面的 gating 條件（存於 metadata.gate）：
 * - requiresFlags — 需持有的旗標。最常見的形狀是「需先讀完某篇」
 *   （completed:{pageId}），用頁面 picker 選比手打旗標名友善；
 *   也保留自由輸入欄給自訂旗標（如 FlagMarker 授予的劇情旗標）。
 * - pristineOnly — 純潔者限定（觀測者與印記者不可見，且不可 bypass）。
 *
 * 唯一進度軸是 History——「需先讀完」的頁面 picker 固定抓 history tree，
 * 與當前編輯的 area 無關（Concepts/Echoes 頁面的解鎖條件也綁 History 進度）。
 */

import React, { useState } from 'react';
import type { GateCondition } from '../../progress';
import { completionFlag } from '../../progress';

interface GatePageNode {
  id: string;
  title: string;
  pageType?: string;
  children?: GatePageNode[];
}

interface GateConditionEditorProps {
  value: GateCondition | null;
  onChange: (next: GateCondition | null) => void;
  /** 本頁是否為進度頁（metadata.progressPage）——鏈條件由前台動態注入 */
  isProgressPage?: boolean;
  onProgressPageChange?: (next: boolean) => void;
  /** 不繼承容器進度（metadata.gateExempt）——切斷點，子樹一併豁免 */
  isGateExempt?: boolean;
  onGateExemptChange?: (next: boolean) => void;
  /**
   * 父容器是否已標為進度頁（單層繼承語意，2026-07-03 修正 #10）。
   * 為 true 時本頁自動被視為進度頁——toggle 收起，改顯示提示；
   * 若要退出繼承，勾「不繼承容器進度」（gateExempt）即可。
   */
  parentIsProgressContainer?: boolean;
  apiBase: string;
  accent: string;
}

/** 正規化：空條件收斂為 null（存檔時整個 gate 鍵移除） */
function normalize(next: GateCondition): GateCondition | null {
  const flags = (next.requiresFlags || []).filter((f) => f.length > 0);
  const condition: GateCondition = {};
  if (flags.length > 0) condition.requiresFlags = flags;
  if (next.pristineOnly) condition.pristineOnly = true;
  return condition.requiresFlags || condition.pristineOnly ? condition : null;
}

export default function GateConditionEditor({
  value,
  onChange,
  isProgressPage = false,
  onProgressPageChange,
  isGateExempt = false,
  onGateExemptChange,
  parentIsProgressContainer = false,
  apiBase,
  accent,
}: GateConditionEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pageTree, setPageTree] = useState<GatePageNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [customFlag, setCustomFlag] = useState('');

  const flags = value?.requiresFlags || [];
  const pristineOnly = value?.pristineOnly === true;

  async function loadTree() {
    if (pageTree.length) return;
    setTreeLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/content/history/tree`);
      const json = await res.json();
      if (json.ok) setPageTree(json.data || []);
    } catch {
      // 靜默失敗，picker 顯示空清單
    } finally {
      setTreeLoading(false);
    }
  }

  function addFlag(flag: string) {
    const trimmed = flag.trim();
    if (!trimmed || flags.includes(trimmed)) return;
    onChange(normalize({ requiresFlags: [...flags, trimmed], pristineOnly }));
  }

  function removeFlag(flag: string) {
    onChange(
      normalize({
        requiresFlags: flags.filter((f) => f !== flag),
        pristineOnly,
      })
    );
  }

  function setPristine(next: boolean) {
    onChange(normalize({ requiresFlags: flags, pristineOnly: next }));
  }

  function renderTree(nodes: GatePageNode[], depth = 0): React.ReactNode {
    return nodes.map((node) => (
      <React.Fragment key={node.id}>
        {node.pageType !== 'page' && node.pageType !== 'homepage' && (
          <button
            type="button"
            className="ned-gate-page-item"
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() => {
              addFlag(completionFlag(node.id));
              setPickerOpen(false);
            }}
          >
            <span className="ned-gate-page-type">
              {(node.pageType || 'P')[0].toUpperCase()}
            </span>
            {node.title}
          </button>
        )}
        {node.children && node.children.length > 0 && (
          <>{renderTree(node.children, depth + 1)}</>
        )}
      </React.Fragment>
    ));
  }

  const supportsProgressToggle = typeof onProgressPageChange === 'function';
  const supportsExemptToggle = typeof onGateExemptChange === 'function';
  // 繼承語意：父容器已標進度頁時，本頁自動視為進度頁，除非勾豁免退出。
  // toggle 顯示為 checked 並禁用，改由 gateExempt 控制去留。
  const inheritedProgressPage = parentIsProgressContainer && !isGateExempt;

  return (
    <div className="ned-gate">
      {/* 進度頁 toggle：勾選後系統自動要求同層前一個進度頁 completed；
          Arc/Chapter 標為進度頁時，底下 section 預設繼承（前台動態求值）。
          picker、自訂旗標、純潔者限定皆與此 toggle 聯集——一頁可同時是
          進度頁、且要求特定其他頁面讀過（例如伏筆回收） */}
      {supportsProgressToggle && (
        <div className="ned-inspector-toggle ned-gate-progress-toggle">
          <span>progress page</span>
          <input
            type="checkbox"
            checked={isProgressPage || inheritedProgressPage}
            disabled={inheritedProgressPage}
            title={
              inheritedProgressPage
                ? '父容器已標為進度頁，本頁自動視為進度頁（勾「exempt from container」可退出）'
                : undefined
            }
            onChange={(e) => onProgressPageChange!(e.target.checked)}
          />
        </div>
      )}
      {supportsProgressToggle && inheritedProgressPage && (
        <div className="ned-gate-scope-hint">
          ⓘ 繼承自父容器：本頁自動計入進度鏈與 container 完成判定。
          若這一頁不算進度（如番外），勾下方「exempt from container」豁免即可。
        </div>
      )}
      {supportsProgressToggle && isProgressPage && !inheritedProgressPage && (
        <div className="ned-gate-scope-hint">
          ⓘ 進度頁：解鎖倚賴同層前一個進度頁完成；父容器（arc/chapter）標為
          進度頁時整包自動繼承。可另外設「需先讀完」的特定頁面、自訂旗標
          與純潔者限定，全部與鏈條件聯集。
        </div>
      )}

      {/* 豁免 toggle：切斷容器繼承（含子樹）。番外/特別篇提前開放用。
          不影響本頁自身的手動 gate、進度頁鏈與父容器完成判定。 */}
      {supportsExemptToggle && (
        <div className="ned-inspector-toggle ned-gate-exempt-toggle">
          <span>exempt from container</span>
          <input
            type="checkbox"
            checked={isGateExempt}
            onChange={(e) => onGateExemptChange!(e.target.checked)}
          />
        </div>
      )}
      {supportsExemptToggle && isGateExempt && (
        <div className="ned-gate-scope-hint">
          ⓘ 豁免：本頁與其底下子頁不再等待父容器（arc/chapter）的進度解鎖。
          自身的進度頁設定與其他條件照常生效。
        </div>
      )}

      {/* 範圍提示：gate 資料全區域通用，但前台消費目前只接了 History。
          其他 zone 的 Reader 接上動態 gating 後移除此提示。 */}
      <div className="ned-gate-scope-hint">
        ⓘ 條件會隨頁面儲存，但目前前台僅 History 生效
      </div>
      {flags.length > 0 && (
        <div className="ned-gate-flags">
          {flags.map((flag) => (
            <span className="ned-gate-flag" key={flag} title={flag}>
              <span className="ned-gate-flag-name">{flag}</span>
              <button
                type="button"
                className="ned-gate-flag-remove"
                aria-label={`移除旗標 ${flag}`}
                onClick={() => removeFlag(flag)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 「需先讀完」picker：一律顯示，與進度頁鏈條件聯集。
          進度頁鏈解決「循序漸進」的普遍情境，picker 用於挑指定頁面
          （例如伏筆回收：這頁需要讀過某個先前的角色初登場） */}
      <button
        type="button"
        className="ned-gate-add-page"
        onClick={() => {
          setPickerOpen((v) => !v);
          if (!pickerOpen) void loadTree();
        }}
      >
        {pickerOpen ? '－ collapse list' : '＋ requires completion…'}
      </button>

      {pickerOpen && (
        <div className="ned-gate-picker">
          {treeLoading ? (
            <div className="ned-gate-picker-empty">loading…</div>
          ) : pageTree.length === 0 ? (
            <div className="ned-gate-picker-empty">unable to load pages</div>
          ) : (
            renderTree(pageTree)
          )}
        </div>
      )}

      <div className="ned-gate-custom">
        <input
          className="ned-field"
          type="text"
          value={customFlag}
          placeholder="custom flag (e.g. met:norvia)"
          onChange={(e) => setCustomFlag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addFlag(customFlag);
              setCustomFlag('');
            }
          }}
        />
        <button
          type="button"
          className="ned-gate-custom-add"
          style={{ color: accent }}
          disabled={!customFlag.trim()}
          onClick={() => {
            addFlag(customFlag);
            setCustomFlag('');
          }}
        >
          ＋
        </button>
      </div>

      <div className="ned-inspector-toggle">
        <span>pristine only</span>
        <input
          type="checkbox"
          checked={pristineOnly}
          onChange={(e) => setPristine(e.target.checked)}
        />
      </div>
    </div>
  );
}
