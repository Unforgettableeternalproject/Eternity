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

  return (
    <div className="ned-gate">
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

      <button
        type="button"
        className="ned-gate-add-page"
        onClick={() => {
          setPickerOpen((v) => !v);
          if (!pickerOpen) void loadTree();
        }}
      >
        {pickerOpen ? '－ 收合頁面清單' : '＋ 需先讀完…'}
      </button>

      {pickerOpen && (
        <div className="ned-gate-picker">
          {treeLoading ? (
            <div className="ned-gate-picker-empty">載入中…</div>
          ) : pageTree.length === 0 ? (
            <div className="ned-gate-picker-empty">無法載入頁面清單</div>
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
          placeholder="自訂旗標（如 met:norvia）"
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
        <span>純潔者限定</span>
        <input
          type="checkbox"
          checked={pristineOnly}
          onChange={(e) => setPristine(e.target.checked)}
        />
      </div>
    </div>
  );
}
