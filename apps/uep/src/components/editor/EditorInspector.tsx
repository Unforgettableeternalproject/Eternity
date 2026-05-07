import React from 'react';

interface EditorInspectorProps {
  pageType: string;
  onPageTypeChange: (v: string) => void;
  parentId: string;
  onParentIdChange: (v: string) => void;
  depth: number;
  onDepthChange: (v: number) => void;
  hidden: boolean;
  onHiddenChange: (v: boolean) => void;
  icon: string;
  onIconChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  onDirty: () => void;
  accent: string;
  pageStatus: string;
  createdAt?: string;
  updatedAt?: string;
}

const STATUS_LABELS: Record<string, string> = {
  synced: 'synced',
  modified: 'modified',
  local_only: 'local only',
};

export default function EditorInspector({
  pageType,
  onPageTypeChange,
  parentId,
  onParentIdChange,
  depth,
  onDepthChange,
  hidden,
  onHiddenChange,
  icon,
  onIconChange,
  description,
  onDescriptionChange,
  onDirty,
  accent,
  pageStatus,
  createdAt,
  updatedAt,
}: EditorInspectorProps) {
  const handleChange = <T,>(setter: (v: T) => void) => (v: T) => {
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
          <option value="page">Page</option>
          <option value="zone">Zone</option>
          <option value="chapter">Chapter</option>
          <option value="arc">Arc</option>
          <option value="section">Section</option>
          <option value="song">Song</option>
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
        <input
          className="ned-field"
          type="text"
          value={icon}
          placeholder="e.g. sparkle"
          onChange={(e) => handleChange(onIconChange)(e.target.value)}
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

      <div className="ned-inspector-sep" />

      <div className="ned-inspector-toggle">
        <span>Hidden</span>
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => handleChange(onHiddenChange)(e.target.checked)}
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

function Section({
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
