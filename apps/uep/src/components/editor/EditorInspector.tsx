import React from 'react';
import IconPicker from './IconLibrary';
import { LAYOUT_OPTIONS } from './VisualsEditorBody';

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
  layout?: string;
  onLayoutChange?: (v: string) => void;
  /** Storage clearing 專屬 metadata */
  storageClearingMeta?: {
    style: string;
    labelEn: string;
    intro: string;
    uepNote: string;
  };
  onStorageClearingMetaChange?: (
    meta: { style: string; labelEn: string; intro: string; uepNote: string }
  ) => void;
  onDirty: () => void;
  accent: string;
  pageStatus: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 各區域可用的頁面類型 */
const AREA_PAGE_TYPES: Record<string, { value: string; label: string }[]> = {
  history: [
    { value: 'page', label: 'Page' },
    { value: 'zone', label: 'Zone' },
    { value: 'chapter', label: 'Chapter' },
    { value: 'arc', label: 'Arc' },
    { value: 'section', label: 'Section' },
  ],
  echoes: [
    { value: 'page', label: 'Page' },
    { value: 'cluster', label: 'Cluster (集群)' },
    { value: 'subcategory', label: 'Subcategory (子分類)' },
    { value: 'song', label: 'Song (歌曲)' },
  ],
  visuals: [
    { value: 'division', label: 'Division (分館)' },
    { value: 'subcategory', label: 'Subcategory (子分類)' },
    { value: 'gallery', label: 'Gallery (畫廊)' },
  ],
  concepts: [
    { value: 'stack', label: 'Stack (模組)' },
    { value: 'type', label: 'Type (分類)' },
    { value: 'subcategory', label: 'Subcategory (子分類)' },
    { value: 'context', label: 'Context (內容)' },
  ],
  storage: [
    { value: 'clearing', label: 'Clearing (空地)' },
    { value: 'stuff', label: 'Stuff (內容)' },
    { value: 'subcategory', label: 'Subcategory (子分類)' },
  ],
};

/** 通用 fallback */
const DEFAULT_PAGE_TYPES = [
  { value: 'page', label: 'Page' },
  { value: 'zone', label: 'Zone' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'section', label: 'Section' },
];

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
  layout,
  onLayoutChange,
  onDirty,
  accent,
  pageStatus,
  createdAt,
  updatedAt,
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

      {/* Visuals division 預設展示風格 */}
      {area === 'visuals' && pageType === 'division' && onLayoutChange && (
        <Section label="default layout">
          <select
            className="ned-field"
            value={layout || ''}
            onChange={(e) => handleChange(onLayoutChange)(e.target.value)}
          >
            {LAYOUT_OPTIONS.filter((o) => o.value !== '').map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Section>
      )}

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
