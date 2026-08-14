// ─── 首頁區塊編輯器 ─────────────────────────────────────────────────────────
// 每種區塊類型各自渲染專屬的表單欄位。
// 使用者點擊「套用」後才呼叫 onSave，中途編輯只維持本地狀態。

import type { CSSProperties, ChangeEvent, ReactNode } from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Image } from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { UploadSpinner } from '../UploadSpinner';
const RT_API_BASE = '';
import type {
  HomepageBlock,
  HomepageBlockType,
  ZoneHeaderData,
  UepDialogueItem,
  ArchwayCard,
  OrbCluster,
  CrossRoad,
  TerminalModule,
  StorageLink,
  StorageRoomArea,
  VisualsAudioData,
} from './types';
import { BLOCK_TYPE_LABELS } from './types';

// ─── Props ───────────────────────────────────────────────────────────────────

interface BlockEditorProps {
  block: HomepageBlock;
  zoneColor: string;
  onSave: (updated: HomepageBlock) => void;
  onCancel: () => void;
}

// ─── 共用樣式輔助 ─────────────────────────────────────────────────────────────

/** 標籤文字樣式（全大寫 mono） */
const labelStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-mute)',
  marginBottom: '4px',
};

/** 單行輸入框 */
const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--hairline-strong)',
  background: 'var(--bg-soft)',
  color: 'var(--ink)',
  padding: '8px 10px',
  fontSize: '13px',
  fontFamily: 'var(--font-sans)',
  outline: 'none',
  borderRadius: '2px',
};

/** 多行文字區域 */
const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: '80px',
  fontFamily: 'var(--font-sans)',
};

/** select 下拉 */
const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

/** 陣列子項卡片 */
const itemCardStyle: CSSProperties = {
  position: 'relative',
  border: '1px solid var(--hairline)',
  background: 'var(--bg-sunken)',
  borderRadius: '3px',
  padding: '12px 36px 12px 12px',
  marginBottom: '8px',
};

/** [×] 刪除按鈕 */
const deleteButtonStyle: CSSProperties = {
  position: 'absolute',
  top: '8px',
  right: '8px',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--ink-mute)',
  fontSize: '14px',
  lineHeight: 1,
  padding: '2px 4px',
  fontFamily: 'var(--font-mono)',
};

/** [+新增] 虛線按鈕 */
const addButtonStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  border: '1px dashed var(--hairline-strong)',
  background: 'transparent',
  color: 'var(--ink-soft)',
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  letterSpacing: '0.08em',
  padding: '8px',
  cursor: 'pointer',
  textAlign: 'center',
  borderRadius: '2px',
  marginTop: '4px',
};

/** 表單欄位包裝間距 */
const fieldWrap: CSSProperties = { marginBottom: '12px' };

// ─── 通用欄位元件 ─────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  children: ReactNode;
}
function Field({ label, children }: FieldProps) {
  return (
    <div style={fieldWrap}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// ─── 各區塊類型表單 ───────────────────────────────────────────────────────────

// 1. zone-header
interface ZoneHeaderFormProps {
  data: ZoneHeaderData;
  onChange: (d: ZoneHeaderData) => void;
}
function ZoneHeaderForm({ data, onChange }: ZoneHeaderFormProps) {
  return (
    <>
      <Field label="標題 Title">
        <input
          style={inputStyle}
          value={data.title}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <Field label="副標題 Subtitle">
        <textarea
          style={textareaStyle}
          value={data.subtitle}
          onChange={(e) => onChange({ ...data, subtitle: e.target.value })}
        />
      </Field>
    </>
  );
}

// 可用特效選項（UEP 對話）
const DIALOGUE_EFFECTS = [
  'glitch',
  'flicker',
  'fade',
  'echo',
  'static',
] as const;

// 2. uep-dialogue
interface UepDialogueFormProps {
  items: UepDialogueItem[];
  onChange: (items: UepDialogueItem[]) => void;
}
function UepDialogueForm({ items, onChange }: UepDialogueFormProps) {
  const update = (i: number, patch: Partial<UepDialogueItem>) => {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
    onChange(next);
  };

  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  const add = () =>
    onChange([...items, { text: '', side: 'left', effects: [] }]);

  const toggleEffect = (i: number, effect: string) => {
    const current = items[i].effects ?? [];
    const next = current.includes(effect)
      ? current.filter((e) => e !== effect)
      : [...current, effect];
    update(i, { effects: next });
  };

  return (
    <>
      {items.map((item, i) => (
        <div key={i} style={itemCardStyle}>
          <button
            style={deleteButtonStyle}
            onClick={() => remove(i)}
            type="button"
          >
            ×
          </button>
          <Field label={`對話 ${i + 1} — 文字`}>
            <input
              style={inputStyle}
              value={item.text}
              onChange={(e) => update(i, { text: e.target.value })}
            />
          </Field>
          <Field label="位置 Side">
            <select
              style={selectStyle}
              value={item.side}
              onChange={(e) =>
                update(i, { side: e.target.value as 'left' | 'right' })
              }
            >
              <option value="left">左 left</option>
              <option value="right">右 right</option>
            </select>
          </Field>
          <div style={fieldWrap}>
            <span style={labelStyle}>特效 Effects</span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {DIALOGUE_EFFECTS.map((fx) => (
                <label
                  key={fx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--ink-soft)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={(item.effects ?? []).includes(fx)}
                    onChange={() => toggleEffect(i, fx)}
                  />
                  {fx}
                </label>
              ))}
            </div>
          </div>
        </div>
      ))}
      <button style={addButtonStyle} type="button" onClick={add}>
        ＋ 新增對話
      </button>
    </>
  );
}

// 3. archway-grid
interface ArchwayGridFormProps {
  cards: ArchwayCard[];
  onChange: (cards: ArchwayCard[]) => void;
}
function ArchwayGridForm({ cards, onChange }: ArchwayGridFormProps) {
  const update = (i: number, patch: Partial<ArchwayCard>) => {
    onChange(cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const remove = (i: number) => onChange(cards.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...cards, { tag: '', name: '', state: 'open', stateLabel: '' }]);

  return (
    <>
      {cards.map((card, i) => (
        <div key={i} style={itemCardStyle}>
          <button
            style={deleteButtonStyle}
            onClick={() => remove(i)}
            type="button"
          >
            ×
          </button>
          <Field label={`卡片 ${i + 1} — Tag`}>
            <input
              style={inputStyle}
              value={card.tag}
              onChange={(e) => update(i, { tag: e.target.value })}
            />
          </Field>
          <Field label="名稱 Name">
            <input
              style={inputStyle}
              value={card.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
          </Field>
          <Field label="狀態 State">
            <select
              style={selectStyle}
              value={card.state}
              onChange={(e) =>
                update(i, { state: e.target.value as ArchwayCard['state'] })
              }
            >
              <option value="open">開放 open</option>
              <option value="corrupted">損毀 corrupted</option>
              <option value="sealed">封閉 sealed</option>
            </select>
          </Field>
          <Field label="狀態標籤 StateLabel">
            <input
              style={inputStyle}
              value={card.stateLabel}
              onChange={(e) => update(i, { stateLabel: e.target.value })}
            />
          </Field>
        </div>
      ))}
      <button style={addButtonStyle} type="button" onClick={add}>
        ＋ 新增卡片
      </button>
    </>
  );
}

// 4. hint-box
interface HintBoxFormProps {
  text: string;
  onChange: (text: string) => void;
}
function HintBoxForm({ text, onChange }: HintBoxFormProps) {
  return (
    <Field label="提示文字 Text">
      <textarea
        style={{ ...textareaStyle, minHeight: '120px' }}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

// 5. orb-cluster-grid
interface OrbClusterGridFormProps {
  clusters: OrbCluster[];
  onChange: (clusters: OrbCluster[]) => void;
}
function OrbClusterGridForm({ clusters, onChange }: OrbClusterGridFormProps) {
  const update = (i: number, patch: Partial<OrbCluster>) => {
    onChange(clusters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const remove = (i: number) =>
    onChange(clusters.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...clusters, { color: '#6b8cba', label: '', orbCount: 0 }]);

  return (
    <>
      {clusters.map((cl, i) => (
        <div key={i} style={itemCardStyle}>
          <button
            style={deleteButtonStyle}
            onClick={() => remove(i)}
            type="button"
          >
            ×
          </button>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            {/* 顏色選擇器 */}
            <div style={{ flex: '0 0 auto' }}>
              <span style={labelStyle}>顏色</span>
              <input
                type="color"
                value={cl.color}
                onChange={(e) => update(i, { color: e.target.value })}
                style={{
                  display: 'block',
                  width: '48px',
                  height: '36px',
                  border: '1px solid var(--hairline-strong)',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  padding: '2px',
                  background: 'var(--bg-soft)',
                }}
              />
            </div>
            {/* 標籤 */}
            <div style={{ flex: 1 }}>
              <span style={labelStyle}>標籤 Label</span>
              <input
                style={inputStyle}
                value={cl.label}
                onChange={(e) => update(i, { label: e.target.value })}
              />
            </div>
            {/* 球數由實際歌曲數決定 */}
            <div
              style={{
                flex: '0 0 auto',
                fontSize: 11,
                color: 'var(--ink-mute)',
                fontFamily: 'var(--font-mono)',
                alignSelf: 'center',
              }}
            >
              球數自動
            </div>
          </div>
        </div>
      ))}
      <button style={addButtonStyle} type="button" onClick={add}>
        ＋ 新增集群
      </button>
    </>
  );
}

// 6. cross-road-grid
interface CrossRoadGridFormProps {
  roads: CrossRoad[];
  onChange: (roads: CrossRoad[]) => void;
}
function CrossRoadGridForm({ roads, onChange }: CrossRoadGridFormProps) {
  const update = (i: number, patch: Partial<CrossRoad>) => {
    onChange(roads.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const remove = (i: number) => onChange(roads.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...roads, { area: '', dir: '', name: '', hint: '', href: '' }]);

  return (
    <>
      {roads.map((road, i) => (
        <div key={i} style={itemCardStyle}>
          <button
            style={deleteButtonStyle}
            onClick={() => remove(i)}
            type="button"
          >
            ×
          </button>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
            }}
          >
            <Field label="Grid Area（fwd/lft/rgt/bck）">
              <input
                style={inputStyle}
                value={road.area}
                onChange={(e) => update(i, { area: e.target.value })}
              />
            </Field>
            <Field label="方向 Dir">
              <input
                style={inputStyle}
                value={road.dir}
                onChange={(e) => update(i, { dir: e.target.value })}
              />
            </Field>
            <Field label="名稱 Name">
              <input
                style={inputStyle}
                value={road.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </Field>
            <Field label="提示 Hint">
              <input
                style={inputStyle}
                value={road.hint}
                onChange={(e) => update(i, { hint: e.target.value })}
              />
            </Field>
          </div>
          <Field label="連結 Href">
            <input
              style={inputStyle}
              value={road.href}
              onChange={(e) => update(i, { href: e.target.value })}
            />
          </Field>
        </div>
      ))}
      <button style={addButtonStyle} type="button" onClick={add}>
        ＋ 新增路徑
      </button>
    </>
  );
}

// 7. terminal-module-table
interface TerminalModuleTableFormProps {
  headerLabel: string;
  modules: TerminalModule[];
  onChange: (data: { headerLabel: string; modules: TerminalModule[] }) => void;
}
function TerminalModuleTableForm({
  headerLabel,
  modules,
  onChange,
}: TerminalModuleTableFormProps) {
  const setHeader = (v: string) => onChange({ headerLabel: v, modules });

  const updateModule = (i: number, patch: Partial<TerminalModule>) => {
    onChange({
      headerLabel,
      modules: modules.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
    });
  };
  const removeModule = (i: number) =>
    onChange({ headerLabel, modules: modules.filter((_, idx) => idx !== i) });
  const addModule = () =>
    onChange({
      headerLabel,
      modules: [
        ...modules,
        { id: '', name: '', en: '', state: 'idle', records: 0 },
      ],
    });

  return (
    <>
      <Field label="表頭標籤 Header Label">
        <input
          style={inputStyle}
          value={headerLabel}
          onChange={(e) => setHeader(e.target.value)}
        />
      </Field>

      {modules.map((mod, i) => (
        <div key={i} style={itemCardStyle}>
          <button
            style={deleteButtonStyle}
            onClick={() => removeModule(i)}
            type="button"
          >
            ×
          </button>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
            }}
          >
            <Field label="ID">
              <input
                style={inputStyle}
                value={mod.id}
                onChange={(e) => updateModule(i, { id: e.target.value })}
              />
            </Field>
            <Field label="狀態 State">
              <select
                style={selectStyle}
                value={mod.state}
                onChange={(e) =>
                  updateModule(i, {
                    state: e.target.value as TerminalModule['state'],
                  })
                }
              >
                <option value="sync">sync</option>
                <option value="idle">idle</option>
              </select>
            </Field>
            <Field label="名稱 Name（中文）">
              <input
                style={inputStyle}
                value={mod.name}
                onChange={(e) => updateModule(i, { name: e.target.value })}
              />
            </Field>
            <Field label="英文名 EN">
              <input
                style={inputStyle}
                value={mod.en}
                onChange={(e) => updateModule(i, { en: e.target.value })}
              />
            </Field>
            <Field label="記錄數 Records">
              <input
                type="number"
                min={0}
                style={inputStyle}
                value={mod.records}
                onChange={(e) =>
                  updateModule(i, { records: Number(e.target.value) })
                }
              />
            </Field>
          </div>
        </div>
      ))}
      <button style={addButtonStyle} type="button" onClick={addModule}>
        ＋ 新增模組
      </button>
    </>
  );
}

// 8. storage-sticky-note
interface StorageStickyNoteFormProps {
  text: string;
  attribution: string;
  onChange: (data: { text: string; attribution: string }) => void;
}
function StorageStickyNoteForm({
  text,
  attribution,
  onChange,
}: StorageStickyNoteFormProps) {
  return (
    <>
      <Field label="便條內容 Text">
        <textarea
          style={{ ...textareaStyle, minHeight: '100px' }}
          value={text}
          onChange={(e) => onChange({ text: e.target.value, attribution })}
        />
      </Field>
      <Field label="署名 Attribution">
        <input
          style={inputStyle}
          value={attribution}
          onChange={(e) => onChange({ text, attribution: e.target.value })}
        />
      </Field>
    </>
  );
}

// 9. storage-links-list
interface StorageLinksListFormProps {
  links: StorageLink[];
  onChange: (links: StorageLink[]) => void;
}
function StorageLinksListForm({ links, onChange }: StorageLinksListFormProps) {
  const update = (i: number, patch: Partial<StorageLink>) => {
    onChange(links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const remove = (i: number) => onChange(links.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...links, { num: '', title: '', file: '', hint: '', href: '' }]);

  return (
    <>
      {links.map((link, i) => (
        <div key={i} style={itemCardStyle}>
          <button
            style={deleteButtonStyle}
            onClick={() => remove(i)}
            type="button"
          >
            ×
          </button>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '80px 1fr',
              gap: '8px',
            }}
          >
            <Field label="編號 Num">
              <input
                style={inputStyle}
                value={link.num}
                onChange={(e) => update(i, { num: e.target.value })}
              />
            </Field>
            <Field label="標題 Title">
              <input
                style={inputStyle}
                value={link.title}
                onChange={(e) => update(i, { title: e.target.value })}
              />
            </Field>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
            }}
          >
            <Field label="檔案名 File">
              <input
                style={inputStyle}
                value={link.file}
                onChange={(e) => update(i, { file: e.target.value })}
              />
            </Field>
            <Field label="提示 Hint">
              <input
                style={inputStyle}
                value={link.hint}
                onChange={(e) => update(i, { hint: e.target.value })}
              />
            </Field>
          </div>
          <Field label="連結 Href">
            <input
              style={inputStyle}
              value={link.href}
              onChange={(e) => update(i, { href: e.target.value })}
            />
          </Field>
        </div>
      ))}
      <button style={addButtonStyle} type="button" onClick={add}>
        ＋ 新增連結
      </button>
    </>
  );
}

// 10. storage-room-map
interface StorageRoomMapFormProps {
  areas: StorageRoomArea[];
  onChange: (areas: StorageRoomArea[]) => void;
}
function StorageRoomMapForm({ areas, onChange }: StorageRoomMapFormProps) {
  const update = (i: number, patch: Partial<StorageRoomArea>) => {
    onChange(areas.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };
  const remove = (i: number) => onChange(areas.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([
      ...areas,
      { icon: '·', name: '', label: '', hint: '', slug: '' },
    ]);

  return (
    <>
      {areas.map((area, i) => (
        <div key={i} style={itemCardStyle}>
          <button
            style={deleteButtonStyle}
            onClick={() => remove(i)}
            type="button"
          >
            ×
          </button>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '60px 1fr 1fr',
              gap: '8px',
            }}
          >
            <Field label="Icon">
              <input
                style={inputStyle}
                value={area.icon}
                onChange={(e) => update(i, { icon: e.target.value })}
              />
            </Field>
            <Field label="名稱">
              <input
                style={inputStyle}
                value={area.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </Field>
            <Field label="標籤 Label">
              <input
                style={inputStyle}
                value={area.label}
                onChange={(e) => update(i, { label: e.target.value })}
              />
            </Field>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
            }}
          >
            <Field label="Slug（clearing slug）">
              <input
                style={inputStyle}
                value={area.slug}
                onChange={(e) => update(i, { slug: e.target.value })}
              />
            </Field>
            <Field label="提示文字">
              <input
                style={inputStyle}
                value={area.hint}
                onChange={(e) => update(i, { hint: e.target.value })}
              />
            </Field>
          </div>
        </div>
      ))}
      <button style={addButtonStyle} type="button" onClick={add}>
        ＋ 新增區域
      </button>
    </>
  );
}

// 11a. visuals-audio-block（音訊上傳 + 標題）
function VisualsAudioForm({
  data,
  onChange,
}: {
  data: VisualsAudioData;
  onChange: (d: VisualsAudioData) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${RT_API_BASE}/api/assets`, {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (json.ok && json.data?.key) {
        onChange({ ...data, audioKey: json.data.key });
      }
    } catch {
      /* ignore */
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <label style={labelStyle}>音訊檔案</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          aria-busy={uploading}
          style={{
            ...inputStyle,
            cursor: 'pointer',
            textAlign: 'center',
            flex: '0 0 auto',
            padding: '6px 16px',
          }}
        >
          {uploading ? (
            <UploadSpinner label="上傳中" />
          ) : data.audioKey ? (
            '重新上傳'
          ) : (
            '上傳音訊'
          )}
        </button>
        {data.audioKey && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8em',
              color: 'var(--ink-mute)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {data.audioKey}
          </span>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />
      <label style={labelStyle}>標題</label>
      <input
        style={inputStyle}
        placeholder="U.E.P 獨白"
        value={data.title || ''}
        onChange={(e) => onChange({ ...data, title: e.target.value })}
      />
      <label style={labelStyle}>副標</label>
      <input
        style={inputStyle}
        placeholder="monologue"
        value={data.subtitle || ''}
        onChange={(e) => onChange({ ...data, subtitle: e.target.value })}
      />
      {data.audioKey && (
        <div style={{ marginTop: 8 }}>
          <label style={labelStyle}>預覽</label>
          <audio
            controls
            src={`${RT_API_BASE}/api/assets/${data.audioKey.split('/').map(encodeURIComponent).join('/')}`}
            style={{ width: '100%', maxWidth: 400, height: 36 }}
          />
        </div>
      )}
    </>
  );
}

// 11b. rich-text（TipTap 富文本編輯）
interface RichTextFormProps {
  html: string;
  onChange: (html: string) => void;
}
function RichTextForm({ html, onChange }: RichTextFormProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imgUploading, setImgUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);

  const editor = useEditor({
    // TipTap v3 預設不在 transaction 時重渲染，會讓工具列 isActive 狀態凍結
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        horizontalRule: {},
      }),
      Underline,
      TextStyle,
      Color,
      Image.configure({ inline: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: html,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
  });

  useEffect(() => {
    if (editor && html !== editor.getHTML()) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [html, editor]);

  if (!editor) return null;

  const tbBtn = (
    label: string,
    cmd: () => void,
    active: boolean,
    title?: string,
    /** 忙碌中：以 node 取代 label 顯示（上傳 spinner），並停用點擊 */
    busy?: { node: ReactNode }
  ) => (
    <button
      key={label}
      type="button"
      onClick={cmd}
      title={title || label}
      disabled={!!busy}
      aria-busy={!!busy}
      style={{
        all: 'unset',
        cursor: 'pointer',
        padding: '4px 8px',
        fontSize: 12,
        fontFamily:
          label.length <= 2 ? 'var(--font-serif-tc)' : 'var(--font-mono)',
        fontWeight: active ? 700 : 400,
        color: active ? 'var(--ink-title)' : 'var(--ink-mute)',
        background: active ? 'var(--bg-card)' : 'transparent',
        border: active
          ? '1px solid var(--hairline-strong)'
          : '1px solid transparent',
      }}
    >
      {busy ? busy.node : label}
    </button>
  );

  const tbSep = (key: string) => (
    <span
      key={key}
      style={{
        width: 1,
        height: 18,
        background: 'var(--hairline)',
        margin: '0 2px',
        alignSelf: 'center',
      }}
    />
  );

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setImgUploading(true);
    try {
      const res = await fetch(`${RT_API_BASE}/api/assets`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok && json.data?.key) {
        const url = `${RT_API_BASE}/api/assets/${json.data.key.split('/').map(encodeURIComponent).join('/')}`;
        editor.chain().focus().setImage({ src: url }).run();
      }
    } catch {
      /* ignore */
    } finally {
      setImgUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const applyLink = () => {
    if (linkUrl) {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: linkUrl })
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    }
    setShowLinkInput(false);
    setLinkUrl('');
  };

  return (
    <div>
      {/* 工具列 */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 8,
          padding: '6px 8px',
          background: 'var(--bg-sunken)',
          border: '1px solid var(--hairline)',
          borderBottom: 'none',
        }}
      >
        {/* 格式 */}
        {tbBtn(
          'B',
          () => editor.chain().focus().toggleBold().run(),
          editor.isActive('bold'),
          '粗體'
        )}
        {tbBtn(
          'I',
          () => editor.chain().focus().toggleItalic().run(),
          editor.isActive('italic'),
          '斜體'
        )}
        {tbBtn(
          'U',
          () => editor.chain().focus().toggleUnderline().run(),
          editor.isActive('underline'),
          '底線'
        )}
        {tbBtn(
          'S',
          () => editor.chain().focus().toggleStrike().run(),
          editor.isActive('strike'),
          '刪除線'
        )}
        {tbSep('s1')}
        {/* 標題 */}
        {tbBtn(
          'H1',
          () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
          editor.isActive('heading', { level: 1 })
        )}
        {tbBtn(
          'H2',
          () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
          editor.isActive('heading', { level: 2 })
        )}
        {tbBtn(
          'H3',
          () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
          editor.isActive('heading', { level: 3 })
        )}
        {tbSep('s2')}
        {/* 對齊 */}
        {tbBtn(
          '←',
          () => editor.chain().focus().setTextAlign('left').run(),
          editor.isActive({ textAlign: 'left' }),
          '靠左'
        )}
        {tbBtn(
          '↔',
          () => editor.chain().focus().setTextAlign('center').run(),
          editor.isActive({ textAlign: 'center' }),
          '置中'
        )}
        {tbBtn(
          '→',
          () => editor.chain().focus().setTextAlign('right').run(),
          editor.isActive({ textAlign: 'right' }),
          '靠右'
        )}
        {tbSep('s3')}
        {/* 列表 / 引用 */}
        {tbBtn(
          '•',
          () => editor.chain().focus().toggleBulletList().run(),
          editor.isActive('bulletList'),
          '項目列表'
        )}
        {tbBtn(
          '1.',
          () => editor.chain().focus().toggleOrderedList().run(),
          editor.isActive('orderedList'),
          '編號列表'
        )}
        {tbBtn(
          '❝',
          () => editor.chain().focus().toggleBlockquote().run(),
          editor.isActive('blockquote'),
          '引用'
        )}
        {tbSep('s4')}
        {/* 插入 */}
        {tbBtn(
          '—',
          () => editor.chain().focus().setHorizontalRule().run(),
          false,
          '分隔線'
        )}
        {tbBtn(
          '🖼',
          () => imageInputRef.current?.click(),
          false,
          imgUploading ? '上傳中...' : '插入圖片',
          imgUploading ? { node: <UploadSpinner label={null} /> } : undefined
        )}
        {!editor.isActive('table') ? (
          tbBtn(
            '表格',
            () =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run(),
            false,
            '插入表格 3×3'
          )
        ) : (
          <>
            {tbBtn(
              '+欄',
              () => editor.chain().focus().addColumnAfter().run(),
              false,
              '向右插入欄'
            )}
            {tbBtn(
              '+列',
              () => editor.chain().focus().addRowAfter().run(),
              false,
              '向下插入列'
            )}
            {tbBtn(
              '-欄',
              () => editor.chain().focus().deleteColumn().run(),
              false,
              '刪除此欄'
            )}
            {tbBtn(
              '-列',
              () => editor.chain().focus().deleteRow().run(),
              false,
              '刪除此列'
            )}
            {tbBtn(
              '×表',
              () => editor.chain().focus().deleteTable().run(),
              false,
              '刪除表格'
            )}
          </>
        )}
        {tbBtn(
          '🔗',
          () => {
            setLinkUrl(editor.getAttributes('link').href || '');
            setShowLinkInput(!showLinkInput);
          },
          editor.isActive('link'),
          '連結'
        )}
      </div>

      {/* 連結輸入列 */}
      {showLinkInput && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '6px 8px',
            background: 'var(--bg-sunken)',
            border: '1px solid var(--hairline)',
            borderTop: 'none',
            borderBottom: 'none',
          }}
        >
          <input
            style={{ ...inputStyle, flex: 1, fontSize: 12 }}
            type="text"
            placeholder="輸入 URL..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyLink()}
          />
          <button
            type="button"
            onClick={applyLink}
            style={{ ...tbBtnBase, color: 'var(--ink-title)' }}
          >
            套用
          </button>
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              setShowLinkInput(false);
            }}
            style={{ ...tbBtnBase, color: 'crimson' }}
          >
            移除
          </button>
        </div>
      )}

      {/* 編輯區 */}
      <div
        style={{
          border: '1px solid var(--hairline-strong)',
          background: 'var(--bg-soft)',
          minHeight: 200,
          maxHeight: 400,
          overflowY: 'auto',
          padding: '12px 14px',
          fontSize: 14,
          lineHeight: 1.7,
          fontFamily: 'var(--font-serif-tc)',
          color: 'var(--ink)',
        }}
      >
        <EditorContent editor={editor} />
      </div>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageUpload}
      />
    </div>
  );
}

const tbBtnBase: CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  padding: '4px 8px',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
};

// ─── 主元件：BlockEditor ──────────────────────────────────────────────────────

export default function BlockEditor({
  block,
  zoneColor,
  onSave,
  onCancel,
}: BlockEditorProps) {
  // 複製一份資料作為本地狀態，避免直接修改父層的資料
  const [localData, setLocalData] = useState<HomepageBlock['data']>(() =>
    JSON.parse(JSON.stringify(block.data))
  );

  // 型別安全的資料更新輔助
  const setData = useCallback((next: HomepageBlock['data']) => {
    setLocalData(next);
  }, []);

  // 套用按鈕：將本地狀態傳給父層
  const handleApply = () => {
    onSave({ ...block, data: localData });
  };

  // ── 根據區塊類型渲染對應的表單 ──
  const renderForm = () => {
    const type: HomepageBlockType = block.type;

    switch (type) {
      case 'zone-header':
        return (
          <ZoneHeaderForm
            data={localData as ZoneHeaderData}
            onChange={(d) => setData(d)}
          />
        );

      case 'uep-dialogue':
        return (
          <UepDialogueForm
            items={localData as UepDialogueItem[]}
            onChange={(items) => setData(items)}
          />
        );

      case 'archway-grid':
        return (
          <ArchwayGridForm
            cards={(localData as { cards: ArchwayCard[] }).cards}
            onChange={(cards) => setData({ cards })}
          />
        );

      case 'hint-box':
        return (
          <HintBoxForm
            text={(localData as { text: string }).text}
            onChange={(text) => setData({ text })}
          />
        );

      case 'orb-cluster-grid':
        return (
          <OrbClusterGridForm
            clusters={(localData as { clusters: OrbCluster[] }).clusters}
            onChange={(clusters) => setData({ clusters })}
          />
        );

      case 'cross-road-grid':
        return (
          <CrossRoadGridForm
            roads={(localData as { roads: CrossRoad[] }).roads}
            onChange={(roads) => setData({ roads })}
          />
        );

      case 'terminal-module-table':
        return (
          <TerminalModuleTableForm
            headerLabel={
              (localData as { headerLabel: string; modules: TerminalModule[] })
                .headerLabel
            }
            modules={
              (localData as { headerLabel: string; modules: TerminalModule[] })
                .modules
            }
            onChange={(d) => setData(d)}
          />
        );

      case 'storage-sticky-note':
        return (
          <StorageStickyNoteForm
            text={(localData as { text: string; attribution: string }).text}
            attribution={
              (localData as { text: string; attribution: string }).attribution
            }
            onChange={(d) => setData(d)}
          />
        );

      case 'storage-links-list':
        return (
          <StorageLinksListForm
            links={(localData as { links: StorageLink[] }).links}
            onChange={(links) => setData({ links })}
          />
        );

      case 'storage-room-map':
        return (
          <StorageRoomMapForm
            areas={(localData as { areas: StorageRoomArea[] }).areas || []}
            onChange={(areas) => setData({ areas })}
          />
        );

      case 'rich-text':
        return (
          <RichTextForm
            html={(localData as { html: string }).html}
            onChange={(html) => setData({ html })}
          />
        );

      case 'visuals-audio-block': {
        const ad = localData as VisualsAudioData;
        return <VisualsAudioForm data={ad} onChange={(d) => setData(d)} />;
      }

      default: {
        // 理論上不應到達此處，但提供後備提示
        const _exhaustive: never = type;
        return (
          <p
            style={{
              color: 'var(--ink-mute)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
            }}
          >
            未知區塊類型：{String(_exhaustive)}
          </p>
        );
      }
    }
  };

  // ── 浮層樣式 ──
  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9000,
    padding: '24px',
    // 點擊背景不關閉，讓使用者明確選擇取消
  };

  const panelStyle: CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--hairline-strong)',
    borderRadius: '4px',
    width: '100%',
    maxWidth: '600px',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
    overflow: 'hidden',
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid var(--hairline)',
    flexShrink: 0,
    background: 'var(--bg-sunken)',
  };

  const titleStyle: CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    // 使用區域顏色作為強調色
    color: zoneColor || 'var(--uep-gold)',
  };

  const bodyStyle: CSSProperties = {
    padding: '16px',
    overflowY: 'auto',
    flex: 1,
  };

  const buttonRowStyle: CSSProperties = {
    display: 'flex',
    gap: '8px',
  };

  // 取消按鈕
  const cancelBtnStyle: CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.06em',
    padding: '7px 14px',
    background: 'transparent',
    border: '1px solid var(--hairline-strong)',
    color: 'var(--ink-soft)',
    cursor: 'pointer',
    borderRadius: '2px',
    transition: `opacity 150ms var(--ease)`,
  };

  // 套用按鈕
  const applyBtnStyle: CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.06em',
    padding: '7px 14px',
    background: zoneColor || 'var(--uep-gold)',
    border: `1px solid ${zoneColor || 'var(--uep-gold)'}`,
    color: '#000',
    cursor: 'pointer',
    borderRadius: '2px',
    fontWeight: 600,
    transition: `opacity 150ms var(--ease)`,
  };

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        {/* ── 頂部標題列 ── */}
        <div style={headerStyle}>
          <span style={titleStyle}>
            編輯&ensp;{BLOCK_TYPE_LABELS[block.type]}
          </span>
          <div style={buttonRowStyle}>
            <button style={cancelBtnStyle} type="button" onClick={onCancel}>
              取消
            </button>
            <button style={applyBtnStyle} type="button" onClick={handleApply}>
              套用
            </button>
          </div>
        </div>

        {/* ── 表單主體 ── */}
        <div style={bodyStyle}>{renderForm()}</div>
      </div>
    </div>
  );
}
