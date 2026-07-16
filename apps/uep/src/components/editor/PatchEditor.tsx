/**
 * PatchEditor — Revision patch 欄位編輯器（Epic 2 S7-B）
 *
 * 依 stack 動態渲染 patch.set 的欄位編輯器，patch.remove 為路徑列表。
 * 設計依據 docs/agent/S7_CONCEPTS_DESIGN.md §4-3：
 * - dossier：name / content_html / spoiler
 * - browser：name / placeholder / avatar / basic（整段）/ sections（整段）
 * - chrono：title / fields.{id}.items（事件列，路徑動態）
 * - diff：term / values / hidden / locked
 * - 全 stack 支援自訂欄位（dot-notation 路徑 + JSON 值），涵蓋
 *   basic.種族、fields.regional.groups 等進階路徑
 *
 * 語意備忘：
 * - 陣列/物件欄位一律整段替換（resolver 不做 element-level merge）
 * - html 欄位用 MiniEditor；呼叫端（RevisionModal）以 key 保證切換
 *   revision 時 remount——只有選中的 revision 會實例化 TipTap（惰性）
 */

import React, { useState } from 'react';

import type {
  ChronoFieldDef,
  ConceptsVariationMeta,
  ProfileSection,
  RevisionPatch,
} from '../concepts/types';

import MiniEditor from './MiniEditor';
import { getDialog } from './editorHelpers';

type StackKind = ConceptsVariationMeta['stack_style'];

type FieldKind =
  | 'text'
  | 'html'
  | 'number'
  | 'boolean'
  | 'stringlist'
  | 'keyvalue'
  | 'sections'
  | 'json';

interface PatchFieldDef {
  path: string;
  label: string;
  kind: FieldKind;
}

/** 各 stack 的已知 patch 欄位（設計文件 §1-3 的可操作欄位清單） */
export const STACK_PATCH_FIELDS: Record<StackKind, PatchFieldDef[]> = {
  dossier: [
    { path: 'name', label: '名稱', kind: 'text' },
    { path: 'content_html', label: '描述', kind: 'html' },
    { path: 'spoiler', label: '劇透等級', kind: 'number' },
  ],
  browser: [
    { path: 'name', label: '角色名稱', kind: 'text' },
    { path: 'placeholder', label: '佔位符（鎖定）', kind: 'boolean' },
    { path: 'avatar', label: '頭像 R2 key', kind: 'text' },
    { path: 'basic', label: '基本資料（整段替換）', kind: 'keyvalue' },
    { path: 'sections', label: '區段（整段替換）', kind: 'sections' },
  ],
  chrono: [{ path: 'title', label: '標題', kind: 'text' }],
  diff: [
    { path: 'term', label: '詞條名稱', kind: 'text' },
    { path: 'values', label: '值（整段替換）', kind: 'stringlist' },
    { path: 'hidden', label: '隱藏', kind: 'boolean' },
    { path: 'locked', label: '鎖定', kind: 'boolean' },
  ],
};

const CHRONO_ITEMS_PATTERN = /^fields\.[^.]+\.items$/;

/** 新增欄位時的預設值 */
function defaultValueFor(kind: FieldKind): unknown {
  switch (kind) {
    case 'text':
    case 'html':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      // browser placeholder 的典型 patch 是 false（解鎖）——預設 false
      return false;
    case 'stringlist':
      return [''];
    case 'keyvalue':
      return {};
    case 'sections':
      return [];
    case 'json':
      return null;
  }
}

/** 判斷既有 set 條目的編輯器類型：已知欄位 → 定義；否則依值形狀推斷 */
export function inferFieldKind(
  stackStyle: StackKind,
  path: string,
  value: unknown
): FieldKind {
  const def = STACK_PATCH_FIELDS[stackStyle].find((d) => d.path === path);
  if (def) return def.kind;
  if (stackStyle === 'chrono' && CHRONO_ITEMS_PATTERN.test(path))
    return 'stringlist';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string')) return 'stringlist';
    if (
      value.every(
        (v) =>
          v !== null &&
          typeof v === 'object' &&
          'label' in (v as Record<string, unknown>) &&
          'content_html' in (v as Record<string, unknown>)
      )
    )
      return 'sections';
    return 'json';
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.values(value as Record<string, unknown>).every(
      (v) => typeof v === 'string'
    )
  )
    return 'keyvalue';
  return 'json';
}

interface PatchEditorProps {
  stackStyle: StackKind;
  patch: RevisionPatch;
  onChange: (patch: RevisionPatch) => void;
  /**
   * chrono 專用（S7 驗收 #7）：pool 的 fieldDefs——事件列 patch 改為
   * 下拉選擇欄位，不再手填 fieldDef ID。未提供時退回 prompt 輸入。
   */
  chronoFieldDefs?: ChronoFieldDef[];
  accent: string;
}

export default function PatchEditor({
  stackStyle,
  patch,
  onChange,
  chronoFieldDefs,
  accent,
}: PatchEditorProps) {
  const [removeInput, setRemoveInput] = useState('');

  const set = patch.set ?? {};
  const removeList = patch.remove ?? [];
  const setEntries = Object.entries(set);

  function commitSet(nextSet: Record<string, unknown>) {
    onChange({
      ...patch,
      set: Object.keys(nextSet).length > 0 ? nextSet : undefined,
    });
  }

  function setPath(path: string, value: unknown) {
    commitSet({ ...set, [path]: value });
  }

  function removeSetPath(path: string) {
    const next = { ...set };
    delete next[path];
    commitSet(next);
  }

  function commitRemoveList(list: string[]) {
    onChange({ ...patch, remove: list.length > 0 ? list : undefined });
  }

  function addRemovePath(path: string) {
    const trimmed = path.trim();
    if (!trimmed || removeList.includes(trimmed)) return;
    commitRemoveList([...removeList, trimmed]);
  }

  const availableFields = STACK_PATCH_FIELDS[stackStyle].filter(
    (d) => !(d.path in set)
  );

  async function addChronoItemsField() {
    const fieldId = await getDialog().prompt(
      '輸入欄位 ID（fieldDefs 的 id，如 main / regional / character）',
      { title: '新增事件列 patch', placeholder: 'main' }
    );
    if (!fieldId) return;
    const path = `fields.${fieldId.trim()}.items`;
    if (path in set) return;
    setPath(path, ['']);
  }

  /** chrono 欄位路徑：flat=items、grouped=groups（整段替換語意一致） */
  function chronoFieldPath(def: ChronoFieldDef): string {
    return `fields.${def.id}.${def.style === 'grouped' ? 'groups' : 'items'}`;
  }

  /** 下拉選擇 fieldDef 新增事件列 patch（S7 驗收 #7） */
  function addChronoFieldFromDef(defId: string) {
    const def = (chronoFieldDefs ?? []).find((d) => d.id === defId);
    if (!def) return;
    const path = chronoFieldPath(def);
    if (path in set) return;
    setPath(path, def.style === 'grouped' ? [] : ['']);
  }

  async function addCustomField() {
    const path = await getDialog().prompt(
      '輸入欄位路徑（dot-notation，如 basic.種族）',
      { title: '自訂 patch 欄位', placeholder: 'basic.種族' }
    );
    if (!path || !path.trim() || path.trim() in set) return;
    setPath(path.trim(), null);
  }

  return (
    <div className="ced-patch">
      {/* SET 區 */}
      {setEntries.length === 0 && (
        <div className="ced-rev-hint">
          尚無 set 操作——用下方按鈕新增要替換的欄位。
        </div>
      )}
      {setEntries.map(([path, value]) => (
        <PatchFieldRow
          key={path}
          stackStyle={stackStyle}
          path={path}
          value={value}
          onValueChange={(v) => setPath(path, v)}
          onRemove={() => removeSetPath(path)}
          accent={accent}
        />
      ))}

      <div className="ced-patch-add-row">
        {availableFields.length > 0 && (
          <select
            className="ced-select ced-patch-add-select"
            value=""
            onChange={(e) => {
              const def = STACK_PATCH_FIELDS[stackStyle].find(
                (d) => d.path === e.target.value
              );
              if (def) setPath(def.path, defaultValueFor(def.kind));
            }}
          >
            <option value="" disabled>
              + 欄位…
            </option>
            {availableFields.map((d) => (
              <option key={d.path} value={d.path}>
                {d.label}（{d.path}）
              </option>
            ))}
          </select>
        )}
        {stackStyle === 'chrono' &&
          (chronoFieldDefs && chronoFieldDefs.length > 0 ? (
            <select
              className="ced-select ced-patch-add-select"
              value=""
              onChange={(e) => addChronoFieldFromDef(e.target.value)}
            >
              <option value="" disabled>
                + 事件列…
              </option>
              {chronoFieldDefs
                .filter((d) => !(chronoFieldPath(d) in set))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.icon} {d.label}（{d.id}）
                  </option>
                ))}
            </select>
          ) : (
            <button
              className="ced-add-btn"
              onClick={() => void addChronoItemsField()}
              style={{ color: accent }}
            >
              + 事件列
            </button>
          ))}
        <button
          className="ced-add-btn"
          onClick={() => void addCustomField()}
          style={{ color: accent }}
        >
          + 自訂欄位
        </button>
      </div>

      {/* REMOVE 區 */}
      <div className="ced-rev-section-title">移除欄位（remove）</div>
      {removeList.length > 0 && (
        <div className="ced-patch-remove-chips">
          {removeList.map((path) => (
            <span className="ced-patch-remove-chip" key={path}>
              <span>{path}</span>
              <button
                type="button"
                aria-label={`取消移除 ${path}`}
                onClick={() =>
                  commitRemoveList(removeList.filter((p) => p !== path))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="ced-patch-remove-input">
        <input
          className="ced-input ced-entity-key-input"
          value={removeInput}
          placeholder="欄位路徑（如 spoiler）"
          spellCheck={false}
          onChange={(e) => setRemoveInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addRemovePath(removeInput);
              setRemoveInput('');
            }
          }}
        />
        <button
          className="ced-add-btn"
          style={{ color: accent }}
          disabled={!removeInput.trim()}
          onClick={() => {
            addRemovePath(removeInput);
            setRemoveInput('');
          }}
        >
          ＋
        </button>
      </div>
    </div>
  );
}

// ── 單一欄位列 ─────────────────────────────────────────────────────

function PatchFieldRow({
  stackStyle,
  path,
  value,
  onValueChange,
  onRemove,
  accent,
}: {
  stackStyle: StackKind;
  path: string;
  value: unknown;
  onValueChange: (value: unknown) => void;
  onRemove: () => void;
  accent: string;
}) {
  const kind = inferFieldKind(stackStyle, path, value);
  const def = STACK_PATCH_FIELDS[stackStyle].find((d) => d.path === path);
  const label = def?.label ?? path;

  return (
    <div className="ced-patch-field">
      <div className="ced-patch-field-head">
        <span className="ced-patch-field-path" title={path}>
          {label}
          {def && <span className="ced-patch-field-raw">{path}</span>}
        </span>
        <button className="ced-del-btn" onClick={onRemove} title="移除此欄位">
          ✕
        </button>
      </div>
      <PatchValueEditor
        kind={kind}
        value={value}
        onChange={onValueChange}
        accent={accent}
      />
    </div>
  );
}

// ── 各類型的值編輯器 ──────────────────────────────────────────────

function PatchValueEditor({
  kind,
  value,
  onChange,
  accent,
}: {
  kind: FieldKind;
  value: unknown;
  onChange: (value: unknown) => void;
  accent: string;
}) {
  switch (kind) {
    case 'text':
      return (
        <input
          className="ced-input"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'html':
      return (
        <MiniEditor
          value={typeof value === 'string' ? value : ''}
          onChange={(html) => onChange(html)}
          placeholder="patch 後的內容..."
        />
      );
    case 'number':
      return (
        <input
          className="ced-input ced-input-sm"
          type="number"
          value={typeof value === 'number' ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          style={{ maxWidth: 120 }}
        />
      );
    case 'boolean':
      return (
        <label className="ced-checkbox-row">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{value === true ? 'true' : 'false'}</span>
        </label>
      );
    case 'stringlist':
      return (
        <StringListEditor
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          accent={accent}
        />
      );
    case 'keyvalue':
      return (
        <KeyValueEditor
          value={
            value !== null && typeof value === 'object' && !Array.isArray(value)
              ? (value as Record<string, string>)
              : {}
          }
          onChange={onChange}
          accent={accent}
        />
      );
    case 'sections':
      return (
        <SectionsEditor
          value={Array.isArray(value) ? (value as ProfileSection[]) : []}
          onChange={onChange}
          accent={accent}
        />
      );
    case 'json':
      return <JsonValueEditor value={value} onChange={onChange} />;
  }
}

function StringListEditor({
  value,
  onChange,
  accent,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  accent: string;
}) {
  return (
    <div className="ced-patch-stringlist">
      {value.map((item, i) => (
        <div key={i} className="ced-field-row">
          <input
            className="ced-input"
            value={item}
            onChange={(e) =>
              onChange(value.map((v, idx) => (idx === i ? e.target.value : v)))
            }
          />
          <button
            className="ced-del-btn"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="ced-add-btn"
        onClick={() => onChange([...value, ''])}
        style={{ color: accent }}
      >
        + 項目
      </button>
    </div>
  );
}

function KeyValueEditor({
  value,
  onChange,
  accent,
}: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  accent: string;
}) {
  return (
    <div className="ced-patch-keyvalue">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="ced-field-row">
          <label className="ced-label ced-label-sm" title={k}>
            {k}
          </label>
          <input
            className="ced-input"
            value={v}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          />
          <button
            className="ced-del-btn"
            onClick={() => {
              const next = { ...value };
              delete next[k];
              onChange(next);
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="ced-add-btn"
        onClick={async () => {
          const key = await getDialog().prompt('請輸入欄位名稱', {
            title: '新增基本資料欄位',
            placeholder: '如：種族、生日、能力',
          });
          if (key && !(key in value)) onChange({ ...value, [key]: '' });
        }}
        style={{ color: accent }}
      >
        + 欄位
      </button>
    </div>
  );
}

function SectionsEditor({
  value,
  onChange,
  accent,
}: {
  value: ProfileSection[];
  onChange: (value: ProfileSection[]) => void;
  accent: string;
}) {
  return (
    <div className="ced-patch-sections">
      {value.map((section, i) => (
        <div key={i} className="ced-entry-card">
          <div className="ced-entry-top">
            <input
              className="ced-input ced-input-name"
              value={section.label}
              placeholder="區段名稱"
              onChange={(e) =>
                onChange(
                  value.map((s, idx) =>
                    idx === i ? { ...s, label: e.target.value } : s
                  )
                )
              }
            />
            <button
              className="ced-del-btn"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </div>
          <MiniEditor
            value={section.content_html}
            onChange={(html) =>
              onChange(
                value.map((s, idx) =>
                  idx === i ? { ...s, content_html: html } : s
                )
              )
            }
            placeholder="區段內容..."
          />
        </div>
      ))}
      <button
        className="ced-add-btn"
        onClick={() => onChange([...value, { label: '', content_html: '' }])}
        style={{ color: accent }}
      >
        + 區段
      </button>
    </div>
  );
}

/** 自訂路徑的 JSON 值編輯器：本地 text state，合法 JSON 才寫回 */
function JsonValueEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(() =>
    value === null ? '' : JSON.stringify(value, null, 2)
  );
  const [error, setError] = useState(false);

  return (
    <div className="ced-patch-json">
      <textarea
        className={`ced-textarea ced-patch-json-input${
          error ? ' ced-patch-json-input--error' : ''
        }`}
        value={text}
        spellCheck={false}
        placeholder='JSON 值（字串要加引號，如 "人類"）'
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (!next.trim()) {
            setError(false);
            onChange(null);
            return;
          }
          try {
            onChange(JSON.parse(next));
            setError(false);
          } catch {
            setError(true); // 不寫回，保留上次合法值
          }
        }}
      />
      {error && (
        <div className="ced-entity-key-error" style={{ margin: '2px 0 0' }}>
          不是合法 JSON——字串請加雙引號；修正前保留上次合法值
        </div>
      )}
    </div>
  );
}
