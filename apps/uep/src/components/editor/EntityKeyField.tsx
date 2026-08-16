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
 * - browser：同頁面內唯一
 * - diff / chrono：不適用——前者是純對照表、後者是事件的時序排列，
 *   都不參與實體身分體系，條目不掛 entityKey
 * 呼叫端負責依此範圍收集 existingKeys（排除自身）。
 *
 * 校驗是即時警告不阻擋輸入——entityKey 是語意資產，由設計者統一命名，
 * 跨 stack 一致性不在此驗證（見設計文件 §4-2：Terminal 查詢時回報衝突）。
 */

import React, { useEffect, useState } from 'react';

import { ENTITY_KEY_PATTERN } from '../../embed/marks';
import { isOrphanEntityKey } from '../concepts/entityBinding';
import { isBrowserContent, isDossierContent } from '../concepts/revision';
import type { ConceptsData } from '../concepts/types';

// kebab-case pattern 下沉至 embed/marks.ts（S7-C，ref 驗證共用）；
// 由此 re-export 維持既有 import 路徑不變。
export { ENTITY_KEY_PATTERN };

/**
 * 存檔前的 entityKey 硬驗證（S7-B 驗收回饋）：
 * 輸入層的警告不阻擋打字，但非法/重複 key 不可進 D1——
 * 旗標慣例（{entityKey}:{NN}）會跟著髒掉且事後難修。
 *
 * 唯一性範圍與輸入層一致：dossier=同 variant、其他=同頁。
 * 回傳問題描述陣列，空陣列 = 通過。
 */
export function collectEntityKeyIssues(data: ConceptsData): string[] {
  const issues: string[] = [];

  /** 檢查一個唯一性範圍內的條目集合 */
  function checkScope(
    items: { label: string; key: string | undefined }[],
    scopeLabel: string
  ) {
    const seen = new Map<string, string>();
    for (const { label, key } of items) {
      if (!key) continue;
      if (!ENTITY_KEY_PATTERN.test(key)) {
        issues.push(`「${label}」的 entityKey「${key}」不是合法 kebab-case`);
        continue;
      }
      const prev = seen.get(key);
      if (prev) {
        issues.push(
          `entityKey「${key}」在${scopeLabel}內重複（「${prev}」與「${label}」）`
        );
      } else {
        seen.set(key, label);
      }
    }
  }

  if (isDossierContent(data)) {
    for (const variant of data.variants) {
      const items: { label: string; key: string | undefined }[] = [];
      for (const subcat of variant.subcategories ?? [])
        for (const group of subcat.groups ?? [])
          for (const entry of group.entries ?? [])
            items.push({
              label: entry.name || '(空條目)',
              key: entry.entityKey,
            });
      checkScope(items, `variant ${variant.id}`);
    }
  } else if (isBrowserContent(data)) {
    checkScope(
      data.profiles.map((p) => ({
        label: p.name || '(未命名角色)',
        key: p.entityKey,
      })),
      '頁面'
    );
  }
  // diff（純對照表）與 chrono（事件的時序排列）都不參與實體身分體系，
  // 條目不掛 entityKey，無需檢查

  return issues;
}

interface EntityKeyFieldProps {
  value: string | undefined;
  onChange: (key: string | undefined) => void;
  /** 同範圍其他條目已用的 entityKey（排除自身），用於唯一性即時警告 */
  existingKeys: Set<string>;
  /** 欄位標籤；預設「實體ID」。Visuals 插圖 ID 等同構欄位沿用本元件 */
  label?: string;
  /** 輸入框 placeholder；預設 entityKey 範例 */
  placeholder?: string;
  /** 重複時的警告文案；預設實體ID 文案 */
  duplicateMessage?: string;
  /**
   * 檢查這個 key 有沒有對應的 Concepts dossier 條目（2026-08-15 定案）。
   *
   * 只有 Echoes/Visuals 這種「引用實體」的編輯器要開——Concepts 自己
   * 就是權威來源，在那裡提示「找不到 dossier 條目」是自我矛盾。
   */
  checkOrphan?: boolean;
}

export default function EntityKeyField({
  value,
  onChange,
  existingKeys,
  label = '實體ID',
  placeholder = '如 xavier-colsono（選填）',
  duplicateMessage = '此實體ID 已被同範圍的其他條目使用',
  checkOrphan = false,
}: EntityKeyFieldProps) {
  const raw = value ?? '';
  const invalidFormat = raw.length > 0 && !ENTITY_KEY_PATTERN.test(raw);
  const duplicate = raw.length > 0 && !invalidFormat && existingKeys.has(raw);
  const [orphan, setOrphan] = useState(false);

  // 孤兒提示（2026-08-15 定案）：沒有 dossier 條目的 entityKey 是佔位，
  // 跨 zone 對應不會生效。這是**提示不是阻擋**——照樣可以存檔，等哪天
  // 補了 dossier 條目就自動生效，不需要回頭改這一頁。
  useEffect(() => {
    if (!checkOrphan || !raw || invalidFormat) {
      setOrphan(false);
      return;
    }
    let alive = true;
    void isOrphanEntityKey(raw).then((result) => {
      if (alive) setOrphan(result);
    });
    return () => {
      alive = false;
    };
  }, [checkOrphan, raw, invalidFormat]);

  return (
    <div className="ced-entity-key">
      <div className="ced-field-row">
        <label className="ced-label">{label}</label>
        <input
          className={`ced-input ced-entity-key-input${
            invalidFormat || duplicate ? ' ced-entity-key-input--error' : ''
          }`}
          value={raw}
          onChange={(e) => {
            const next = e.target.value.trim();
            onChange(next.length > 0 ? next : undefined);
          }}
          placeholder={placeholder}
          spellCheck={false}
        />
      </div>
      {invalidFormat && (
        <div className="ced-entity-key-error">
          僅允許 kebab-case：小寫英文、數字、連字號（如 rain-sea-tower）
        </div>
      )}
      {duplicate && (
        <div className="ced-entity-key-error">{duplicateMessage}</div>
      )}
      {orphan && !duplicate && (
        <div className="ced-entity-key-hint">
          此 key 尚無 dossier 條目，跨區對應目前不生效（仍可存檔）
        </div>
      )}
    </div>
  );
}
