import React from 'react';
import IconPicker from './IconLibrary';
import { AREA_PAGE_TYPES, DEFAULT_PAGE_TYPES } from './editorModeRegistry';

interface EditorInspectorProps {
  area: string;
  pageType: string;
  onPageTypeChange: (v: string) => void;
  parentId: string;
  onParentIdChange: (v: string) => void;
  depth: number;
  onDepthChange: (v: number) => void;
  hidden: boolean;
  onHiddenChange: (v: boolean) => void;
  locked: boolean;
  onLockedChange: (v: boolean) => void;
  icon: string;
  onIconChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  onDirty: () => void;
  accent: string;
  pageStatus: string;
  createdAt?: string;
  updatedAt?: string;
  /** mode-specific 欄位，由 RichEditor 根據 registry 傳入 */
  modeFields?: React.ReactNode;
}

const STATUS_LABELS: Record<string, string> = {
  synced: 'synced',
  modified: 'modified',
  local_only: 'local only',
};

export default function EditorInspector({
  area,
  pageType,
  onPageTypeChange,
  parentId,
  onParentIdChange,
  depth,
  onDepthChange,
  hidden,
  onHiddenChange,
  locked,
  onLockedChange,
  icon,
  onIconChange,
  description,
  onDescriptionChange,
  onDirty,
  accent,
  pageStatus,
  createdAt,
  updatedAt,
  modeFields,
}: EditorInspectorProps) {
  const handleChange =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      onDirty();
    };

  return (
    <div className="ned-inspector">
      <div className="ned-inspector-title">inspector</div>

      <Section label="page type">
        <select
          className="ned-field"
          value={pageType}
          onChange={(e) => handleChange(onPageTypeChange)(e.target.value)}
        >
          {(AREA_PAGE_TYPES[area] || DEFAULT_PAGE_TYPES).map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Section>

      <Section label="parent id">
        <input
          className="ned-field"
          type="text"
          value={parentId}
          placeholder="e.g. history/unforget/arc1"
          onChange={(e) => handleChange(onParentIdChange)(e.target.value)}
        />
      </Section>

      <Section label="depth">
        <input
          className="ned-field"
          type="number"
          value={depth}
          min={0}
          max={5}
          onChange={(e) =>
            handleChange(onDepthChange)(parseInt(e.target.value) || 0)
          }
        />
      </Section>

      <Section label="icon">
        <IconPicker
          value={icon}
          onChange={handleChange(onIconChange)}
          accent={accent}
        />
      </Section>

      <Section label="description">
        <textarea
          className="ned-field ned-field--textarea"
          value={description}
          placeholder="Page description"
          onChange={(e) => handleChange(onDescriptionChange)(e.target.value)}
        />
      </Section>

      {/* mode-specific 欄位由 registry 注入 */}
      {modeFields}

      <div className="ned-inspector-sep" />

      <div className="ned-inspector-toggle">
        <span>Hidden</span>
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => handleChange(onHiddenChange)(e.target.checked)}
        />
      </div>
      <div className="ned-inspector-toggle">
        <span>Locked</span>
        <input
          type="checkbox"
          checked={locked}
          onChange={(e) => handleChange(onLockedChange)(e.target.checked)}
        />
      </div>

      <div className="ned-inspector-sep" />

      <div className="ned-inspector-info-title">status</div>
      <div className="ned-inspector-info">
        <span style={{ color: accent }}>
          {STATUS_LABELS[pageStatus] || pageStatus}
        </span>
      </div>
      {createdAt && (
        <>
          <div className="ned-inspector-info">
            created {new Date(createdAt).toLocaleDateString()}
          </div>
        </>
      )}
      {updatedAt && (
        <div className="ned-inspector-info">
          last edit {new Date(updatedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

export function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ned-inspector-section">
      <div className="ned-inspector-label">{label}</div>
      {children}
    </div>
  );
}
