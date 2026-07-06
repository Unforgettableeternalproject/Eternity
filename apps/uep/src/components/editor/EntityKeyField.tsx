/**
 * EntityKeyField — Concepts 條目的 entityKey 輸入欄（Epic 2 S7-B）
 *
 * entityKey 是跨 stack 統一實體身分識別碼（kebab-case），驅動：
 * - embed ref（entity:{entityKey}）
 * - 旗標命名慣例（{entityKey}:{stage}，如 xavier-colsono:01）
 * - Terminal Island 檢索與跨 stack 深連
 *
 * 唯一性範圍（設計文件 docs/agent/S7_CONCEPTS_DESIGN.md §1-3-a）：
 * - dossier：同 variant 內唯一（同一實體可跨 variant 各自維護 revision 鏈）
 * - browser / chrono / diff：同頁面內唯一
 * 呼叫端負責依此範圍收集 existingKeys（排除自身）。
 *
 * 校驗是即時警告不阻擋輸入——entityKey 是語意資產，由設計者統一命名，
 * 跨 stack 一致性不在此驗證（見設計文件 §4-2：Terminal 查詢時回報衝突）。
 */

import React from 'react';

/** kebab-case：小寫英文/數字，連字號分段 */
export const ENTITY_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface EntityKeyFieldProps {
  value: string | undefined;
  onChange: (key: string | undefined) => void;
  /** 同範圍其他條目已用的 entityKey（排除自身），用於唯一性即時警告 */
  existingKeys: Set<string>;
}

export default function EntityKeyField({
  value,
  onChange,
  existingKeys,
}: EntityKeyFieldProps) {
  const raw = value ?? '';
  const invalidFormat = raw.length > 0 && !ENTITY_KEY_PATTERN.test(raw);
  const duplicate = raw.length > 0 && !invalidFormat && existingKeys.has(raw);

  return (
    <div className="ced-entity-key">
      <div className="ced-field-row">
        <label className="ced-label">entityKey</label>
        <input
          className={`ced-input ced-entity-key-input${
            invalidFormat || duplicate ? ' ced-entity-key-input--error' : ''
          }`}
          value={raw}
          onChange={(e) => {
            const next = e.target.value.trim();
            onChange(next.length > 0 ? next : undefined);
          }}
          placeholder="如 xavier-colsono（選填）"
          spellCheck={false}
        />
      </div>
      {invalidFormat && (
        <div className="ced-entity-key-error">
          僅允許 kebab-case：小寫英文、數字、連字號（如 rain-sea-tower）
        </div>
      )}
      {duplicate && (
        <div className="ced-entity-key-error">
          此 entityKey 已被同範圍的其他條目使用
        </div>
      )}
    </div>
  );
}
