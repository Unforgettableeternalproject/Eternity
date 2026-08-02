/**
 * 進度條件編輯器（Epic 2 內容閘門）
 *
 * 在 Inspector 中編輯頁面的 gating 條件（存於 metadata.gate）：
 * - requiresFlags — 需持有的旗標。最常見的形狀是「需先讀完某篇」
 *   （completed:{pageId}），用頁面 picker 選比手打旗標名友善；
 *   自訂旗標走 FlagPicker 從註冊表選，**沒有自由輸入欄**（D-1 強制註冊：
 *   手打的旗標名打錯一個字，需求端就永遠等不到且不會有錯誤訊息）。
 * - pristineOnly — 純潔者限定（觀測者與印記者不可見，且不可 bypass）。
 *
 * 唯一進度軸是 History——「需先讀完」的頁面 picker 固定抓 history tree，
 * 與當前編輯的 area 無關（Concepts/Echoes 頁面的解鎖條件也綁 History 進度）。
 */

import React, { useState } from 'react';
import type { GateCondition } from '../../progress';
import { completionFlag } from '../../progress';
import FlagPicker from './FlagPicker';

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
  /** 某些專用編輯器（如 Echoes spoiler 鏈）已有自己的範圍說明。 */
  showScopeHint?: boolean;
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
  showScopeHint = true,
}: GateConditionEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pageTree, setPageTree] = useState<GatePageNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

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

  /** FlagPicker 直接給整份清單（它自己處理去重） */
  function setFlags(next: string[]) {
    onChange(normalize({ requiresFlags: next, pristineOnly }));
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
  /*
   * 容器內時，「豁免」與「自標進度頁」互斥（艾斯維爾 2026-08-02）。
   *
   * 兩者並存等於在父容器裡插一條獨立的進度鏈，但解鎖判定是靠同層前一個
   * 進度頁的 `completed:` 串起來的——身處容器內卻不隸屬於容器的鏈沒有起點。
   * 求值規則不變（`effectiveGate` 仍是正交的），這裡只是不讓人新造出這種
   * 狀態；既有資料在 /admin/settings 的進度分頁會被標成衝突。
   */
  const exemptBlocksProgress =
    parentIsProgressContainer && isGateExempt && !isProgressPage;
  const progressBlocksExempt =
    parentIsProgressContainer && isProgressPage && !isGateExempt;

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
            disabled={inheritedProgressPage || exemptBlocksProgress}
            title={
              inheritedProgressPage
                ? '父容器已標為進度頁，本頁自動視為進度頁（勾「exempt from container」可退出）'
                : exemptBlocksProgress
                  ? '已豁免容器進度，不能同時自標為進度頁——先取消豁免'
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
            disabled={progressBlocksExempt}
            title={
              progressBlocksExempt
                ? '已自標為進度頁，不能同時豁免容器進度——先取消進度頁'
                : undefined
            }
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
      {showScopeHint && (
        <div className="ned-gate-scope-hint">
          ⓘ 條件會隨頁面儲存，並由各區域 Reader 的 gating 求值器消費
        </div>
      )}
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

      {/* 自訂旗標一律從註冊表選（D-1）。已選的旗標顯示在上方 ned-gate-flags
          （要與 page picker 產生的 completed:* 並列），所以這裡關掉 picker
          自己的 chip 區，避免同一批旗標出現兩次 */}
      <FlagPicker
        value={flags}
        onChange={setFlags}
        showSelected={false}
        accent={accent}
        placeholder="custom flag…"
      />

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
