/**
 * SiteHomepageEditor — 網站首頁文字內容編輯器
 *
 * 讓管理員編輯 site_homepage 表中所有 section 的文字。
 * 每個 section 獨立儲存，使用 PUT /api/homepage/:sectionId。
 *
 * 結構欄位（kicker, title, zone meta）→ 簡單 input
 * 內容主體（敘事段落 + UEP 對話 + 詩句）→ MiniEditor（TipTap 富文本）
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { FontFamily } from '@tiptap/extension-font-family';
import { TextAlign } from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extension-placeholder';

import UepDialogueNode from './UepDialogueNode';

import type {
  HeroContent,
  AtlasContent,
  JourneyContent,
  ZoneSectionContent,
  VerseContent,
} from '../../data/homepage-types';

import './SiteHomepageEditor.css';

// ── API 設定 ──────────────────────────────────────────────────────────────────

const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

/** 從 localStorage 取得 JWT token */
function getToken(): string | null {
  try {
    return localStorage.getItem('uep-admin-token');
  } catch {
    return null;
  }
}

/** 載入所有 section 資料 */
async function loadAll(): Promise<
  Record<string, { content: unknown; updatedAt: string }>
> {
  const res = await fetch(`${API_BASE}/api/homepage`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data ?? {};
}

/** 儲存單一 section */
async function saveSection(sectionId: string, content: unknown): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/homepage/${sectionId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}：${text}`);
  }
}

// ── Tab 定義 ──────────────────────────────────────────────────────────────────

interface TabDef {
  id: string;
  name: string;
  sub: string;
}

const TABS: TabDef[] = [
  { id: 'hero', name: 'Hero', sub: '開場主視覺' },
  { id: 'atlas', name: 'Atlas', sub: '大地圖區塊' },
  { id: 'journey', name: '旅程入口', sub: 'journey' },
  { id: 'zone-history', name: '歷史典藏庫', sub: 'zone-history' },
  { id: 'zone-echoes', name: '回音蒐藏間', sub: 'zone-echoes' },
  { id: 'zone-visuals', name: '幻影重現室', sub: 'zone-visuals' },
  { id: 'zone-concepts', name: '概念調整房', sub: 'zone-concepts' },
  { id: 'zone-storage', name: '某人的置物空間', sub: 'zone-storage' },
  { id: 'verse', name: '永恆之詩', sub: 'verse' },
];

// ── 儲存狀態類型 ──────────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ════════════════════════════════════════════════════════════════════════════
// 子元件：MiniEditor（TipTap 輕量富文本編輯器）
// ════════════════════════════════════════════════════════════════════════════

interface MiniEditorProps {
  /** HTML 字串 */
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

function MiniEditor({ content, onChange, placeholder }: MiniEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontFamily.configure({ types: ['textStyle'] }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: placeholder ?? '開始輸入…' }),
      UepDialogueNode,
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // 當外部 content 變更時同步（切換 section tab 時）
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  if (!editor) return null;

  return (
    <div className="she-mini-editor">
      {/* 工具列 */}
      <div className="she-mini-toolbar">
        {/* 基本格式 */}
        <button
          type="button"
          title="粗體 (Ctrl+B)"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`she-mini-btn${editor.isActive('bold') ? ' is-active' : ''}`}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          title="斜體 (Ctrl+I)"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`she-mini-btn${editor.isActive('italic') ? ' is-active' : ''}`}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          title="底線 (Ctrl+U)"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`she-mini-btn${editor.isActive('underline') ? ' is-active' : ''}`}
        >
          <span style={{ textDecoration: 'underline' }}>U</span>
        </button>

        <span className="she-mini-sep" />

        {/* 文字顏色 */}
        <button
          type="button"
          title="金色文字"
          onClick={() => editor.chain().focus().setColor('#d5b618').run()}
          className="she-mini-btn"
        >
          <span style={{ color: '#d5b618', fontWeight: 700 }}>A</span>
        </button>
        <button
          type="button"
          title="重置顏色"
          onClick={() => editor.chain().focus().unsetColor().run()}
          className="she-mini-btn"
        >
          A
        </button>

        <span className="she-mini-sep" />

        {/* UEP 對話 */}
        <button
          type="button"
          title="插入 UEP 對話 (Ctrl+Shift+U)"
          onClick={() => editor.chain().focus().toggleUepDialogue().run()}
          className={`she-mini-btn${editor.isActive('uepDialogue') ? ' is-active' : ''}`}
        >
          💬
        </button>

        <span className="she-mini-sep" />

        {/* 分隔線 */}
        <button
          type="button"
          title="水平分隔線"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className="she-mini-btn"
        >
          —
        </button>
      </div>

      {/* 編輯區域 */}
      <EditorContent editor={editor} className="she-mini-content" />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 子元件：StringArrayEditor（字串陣列編輯器，用於 uepShort 等純字串陣列）
// ════════════════════════════════════════════════════════════════════════════

interface StringArrayEditorProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** 使用 textarea（多行）或 input（單行），預設 false（單行）*/
  multiline?: boolean;
}

function StringArrayEditor({
  value,
  onChange,
  multiline = false,
}: StringArrayEditorProps) {
  const handleChange = (idx: number, v: string) => {
    const next = [...value];
    next[idx] = v;
    onChange(next);
  };

  const handleDelete = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const handleAdd = () => {
    onChange([...value, '']);
  };

  return (
    <div className="she-arr">
      {value.map((item, idx) => (
        <div key={idx} className="she-arr-row">
          {multiline ? (
            <textarea
              className="she-arr-input"
              value={item}
              rows={2}
              onChange={(e) => handleChange(idx, e.target.value)}
            />
          ) : (
            <input
              className="she-arr-input"
              value={item}
              onChange={(e) => handleChange(idx, e.target.value)}
            />
          )}
          <button
            className="she-arr-del"
            title="刪除此行"
            onClick={() => handleDelete(idx)}
          >
            ×
          </button>
        </div>
      ))}
      <button className="she-arr-add" onClick={handleAdd}>
        ＋ 新增一行
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 子元件：StatsEditor（key-value 統計資料編輯器）
// ════════════════════════════════════════════════════════════════════════════

interface StatsEditorProps {
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}

function StatsEditor({ value, onChange }: StatsEditorProps) {
  const entries = Object.entries(value);

  const handleKeyChange = (idx: number, newKey: string) => {
    const next: Record<string, number> = {};
    entries.forEach(([k, v], i) => {
      next[i === idx ? newKey : k] = v;
    });
    onChange(next);
  };

  const handleValChange = (idx: number, newVal: string) => {
    const num = parseFloat(newVal);
    if (isNaN(num)) return;
    const next: Record<string, number> = {};
    entries.forEach(([k, v], i) => {
      next[k] = i === idx ? num : v;
    });
    onChange(next);
  };

  const handleDelete = (idx: number) => {
    const next: Record<string, number> = {};
    entries.forEach(([k, v], i) => {
      if (i !== idx) next[k] = v;
    });
    onChange(next);
  };

  const handleAdd = () => {
    onChange({ ...value, '': 0 });
  };

  return (
    <div className="she-stats">
      {entries.map(([k, v], idx) => (
        <div key={idx} className="she-stats-row">
          <input
            className="she-stats-key"
            value={k}
            placeholder="欄位名稱"
            onChange={(e) => handleKeyChange(idx, e.target.value)}
          />
          <input
            className="she-stats-val"
            type="number"
            value={v}
            onChange={(e) => handleValChange(idx, e.target.value)}
          />
          <button
            className="she-stats-del"
            title="刪除此行"
            onClick={() => handleDelete(idx)}
          >
            ×
          </button>
        </div>
      ))}
      <button className="she-stats-add" onClick={handleAdd}>
        ＋ 新增統計項目
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 子元件：SectionForm 容器（含標題、儲存按鈕）
// ════════════════════════════════════════════════════════════════════════════

interface SectionFormProps {
  sectionId: string;
  title: string;
  saveStatus: SaveStatus;
  saveError: string | null;
  onSave: () => void;
  children: React.ReactNode;
}

function SectionForm({
  sectionId,
  title,
  saveStatus,
  saveError,
  onSave,
  children,
}: SectionFormProps) {
  return (
    <div className="she-section">
      <div className="she-section-header">
        <div>
          <h2 className="she-section-title">{title}</h2>
          <div className="she-section-id">{sectionId}</div>
        </div>
        <div className="she-save-area">
          {saveStatus === 'saving' && (
            <span className="she-save-status she-save-status--saving">
              儲存中…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="she-save-status she-save-status--saved">
              ✓ 已儲存
            </span>
          )}
          {saveStatus === 'error' && (
            <span
              className="she-save-status she-save-status--error"
              title={saveError ?? ''}
            >
              ✕ 儲存失敗
            </span>
          )}
          <button
            className="she-save-btn"
            disabled={saveStatus === 'saving'}
            onClick={onSave}
          >
            儲存
          </button>
        </div>
      </div>
      <div className="she-fields">{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 表單欄位輔助元件
// ════════════════════════════════════════════════════════════════════════════

/** 單行文字欄位 */
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="she-field">
      <label className="she-label">{label}</label>
      <input
        className="she-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** TipTap 富文本欄位 */
function BodyField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="she-field">
      <label className="she-label">{label}</label>
      <MiniEditor
        content={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  );
}

/** 小節分隔標題 */
function SubTitle({ children }: { children: React.ReactNode }) {
  return <div className="she-sub-title">{children}</div>;
}

// ════════════════════════════════════════════════════════════════════════════
// Section 表單：Hero
// ════════════════════════════════════════════════════════════════════════════

function HeroForm({
  initial,
  onSave,
}: {
  initial: HeroContent;
  onSave: (data: HeroContent) => Promise<void>;
}) {
  const [data, setData] = useState<HeroContent>(initial);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => setData(initial), [initial]);

  const set = <K extends keyof HeroContent>(key: K, val: HeroContent[K]) =>
    setData((d) => ({ ...d, [key]: val }));

  const setBtn = (key: keyof HeroContent['buttons'], val: string) =>
    setData((d) => ({ ...d, buttons: { ...d.buttons, [key]: val } }));

  const handleSave = async () => {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await onSave(data);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaveStatus('error');
    }
  };

  return (
    <SectionForm
      sectionId="hero"
      title="Hero 開場區塊"
      saveStatus={saveStatus}
      saveError={saveError}
      onSave={handleSave}
    >
      <Field
        label="Kicker（副標語）"
        value={data.kicker}
        onChange={(v) => set('kicker', v)}
      />
      <Field
        label="標題主文 titleMain"
        value={data.titleMain}
        onChange={(v) => set('titleMain', v)}
      />
      <Field
        label="標題強調 titleAccent"
        value={data.titleAccent}
        onChange={(v) => set('titleAccent', v)}
      />
      <Field
        label="英文副標題 subtitleEn"
        value={data.subtitleEn}
        onChange={(v) => set('subtitleEn', v)}
      />
      <BodyField
        label="內容主體 body（段落 + UEP 對話）"
        value={data.body}
        onChange={(v) => set('body', v)}
        placeholder="輸入描述段落，或用 💬 插入 UEP 對話…"
      />
      <SubTitle>按鈕文字</SubTitle>
      <Field
        label="按鈕：開啟地圖 buttons.openMap"
        value={data.buttons.openMap}
        onChange={(v) => setBtn('openMap', v)}
      />
      <Field
        label="按鈕：開始旅程 buttons.startJourney"
        value={data.buttons.startJourney}
        onChange={(v) => setBtn('startJourney', v)}
      />
      <Field
        label="按鈕：管理 buttons.admin"
        value={data.buttons.admin}
        onChange={(v) => setBtn('admin', v)}
      />
    </SectionForm>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Section 表單：Atlas（純結構欄位，無 TipTap）
// ════════════════════════════════════════════════════════════════════════════

function AtlasForm({
  initial,
  onSave,
}: {
  initial: AtlasContent;
  onSave: (data: AtlasContent) => Promise<void>;
}) {
  const [data, setData] = useState<AtlasContent>(initial);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => setData(initial), [initial]);

  const set = <K extends keyof AtlasContent>(key: K, val: AtlasContent[K]) =>
    setData((d) => ({ ...d, [key]: val }));

  const handleSave = async () => {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await onSave(data);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaveStatus('error');
    }
  };

  return (
    <SectionForm
      sectionId="atlas"
      title="Atlas 大地圖區塊"
      saveStatus={saveStatus}
      saveError={saveError}
      onSave={handleSave}
    >
      <Field
        label="Kicker"
        value={data.kicker}
        onChange={(v) => set('kicker', v)}
      />
      <Field
        label="標題 title"
        value={data.title}
        onChange={(v) => set('title', v)}
      />
      <Field
        label="提示文字 hint"
        value={data.hint}
        onChange={(v) => set('hint', v)}
      />
    </SectionForm>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Section 表單：Journey（旅程入口）
// ════════════════════════════════════════════════════════════════════════════

function JourneyForm({
  initial,
  onSave,
}: {
  initial: JourneyContent;
  onSave: (data: JourneyContent) => Promise<void>;
}) {
  const [data, setData] = useState<JourneyContent>(initial);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => setData(initial), [initial]);

  const set = <K extends keyof JourneyContent>(
    key: K,
    val: JourneyContent[K]
  ) => setData((d) => ({ ...d, [key]: val }));

  const handleSave = async () => {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await onSave(data);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaveStatus('error');
    }
  };

  return (
    <SectionForm
      sectionId="journey"
      title="旅程入口"
      saveStatus={saveStatus}
      saveError={saveError}
      onSave={handleSave}
    >
      <Field
        label="Kicker"
        value={data.kicker}
        onChange={(v) => set('kicker', v)}
      />
      <Field
        label="標題 title"
        value={data.title}
        onChange={(v) => set('title', v)}
      />
      <BodyField
        label="內容主體 body（旁白 + UEP 台詞）"
        value={data.body}
        onChange={(v) => set('body', v)}
        placeholder="輸入旁白段落，或用 💬 插入 UEP 對話…"
      />
    </SectionForm>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Section 表單：Zone（×5）
// ════════════════════════════════════════════════════════════════════════════

function ZoneForm({
  sectionId,
  title,
  initial,
  onSave,
}: {
  sectionId: string;
  title: string;
  initial: ZoneSectionContent;
  onSave: (data: ZoneSectionContent) => Promise<void>;
}) {
  const [data, setData] = useState<ZoneSectionContent>(initial);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => setData(initial), [initial]);

  /** 更新 meta 欄位 */
  const setMeta = <K extends keyof ZoneSectionContent['meta']>(
    key: K,
    val: ZoneSectionContent['meta'][K]
  ) => setData((d) => ({ ...d, meta: { ...d.meta, [key]: val } }));

  const handleSave = async () => {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await onSave(data);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaveStatus('error');
    }
  };

  return (
    <SectionForm
      sectionId={sectionId}
      title={title}
      saveStatus={saveStatus}
      saveError={saveError}
      onSave={handleSave}
    >
      <SubTitle>meta — 區域基本資訊</SubTitle>
      <Field
        label="meta.label（中文名稱）"
        value={data.meta.label}
        onChange={(v) => setMeta('label', v)}
      />
      <Field
        label="meta.en（英文名稱）"
        value={data.meta.en}
        onChange={(v) => setMeta('en', v)}
      />
      <Field
        label="meta.kicker"
        value={data.meta.kicker}
        onChange={(v) => setMeta('kicker', v)}
      />
      <Field
        label="meta.blurb（一句介紹）"
        value={data.meta.blurb}
        onChange={(v) => setMeta('blurb', v)}
      />
      <Field
        label="meta.atmos（氛圍標籤）"
        value={data.meta.atmos}
        onChange={(v) => setMeta('atmos', v)}
      />

      {/* Glyphs — 4 個 input 並排 */}
      <div className="she-field">
        <label className="she-label">meta.glyphs（4 個符號並排）</label>
        <div className="she-field-row">
          {[0, 1, 2, 3].map((i) => (
            <input
              key={i}
              className="she-input"
              value={data.meta.glyphs[i] ?? ''}
              onChange={(e) => {
                const next = [...data.meta.glyphs];
                next[i] = e.target.value;
                setMeta('glyphs', next);
              }}
            />
          ))}
        </div>
      </div>

      <div className="she-field">
        <label className="she-label">meta.uepShort（UEP 短句陣列）</label>
        <StringArrayEditor
          value={data.meta.uepShort}
          onChange={(v) => setMeta('uepShort', v)}
          multiline={false}
        />
      </div>

      <div className="she-field">
        <label className="she-label">
          meta.stats（統計數字，key → number）
        </label>
        <StatsEditor
          value={data.meta.stats}
          onChange={(v) => setMeta('stats', v)}
        />
      </div>

      <SubTitle>body — 旅程場景敘事</SubTitle>
      <BodyField
        label="內容主體 body（旁白 + UEP 對話）"
        value={data.body}
        onChange={(v) => setData((d) => ({ ...d, body: v }))}
        placeholder="輸入旅程敘事，或用 💬 插入 UEP 對話…"
      />
    </SectionForm>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Section 表單：Verse（永恆之詩）
// ════════════════════════════════════════════════════════════════════════════

function VerseForm({
  initial,
  onSave,
}: {
  initial: VerseContent;
  onSave: (data: VerseContent) => Promise<void>;
}) {
  const [data, setData] = useState<VerseContent>(initial);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => setData(initial), [initial]);

  const set = <K extends keyof VerseContent>(key: K, val: VerseContent[K]) =>
    setData((d) => ({ ...d, [key]: val }));

  const handleSave = async () => {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await onSave(data);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaveStatus('error');
    }
  };

  return (
    <SectionForm
      sectionId="verse"
      title="永恆之詩"
      saveStatus={saveStatus}
      saveError={saveError}
      onSave={handleSave}
    >
      <Field
        label="Kicker"
        value={data.kicker}
        onChange={(v) => set('kicker', v)}
      />
      <Field
        label="標題 title"
        value={data.title}
        onChange={(v) => set('title', v)}
      />
      <Field
        label="題詞 inscription"
        value={data.inscription}
        onChange={(v) => set('inscription', v)}
      />
      <BodyField
        label="詩句 body（富文本，可含金色關鍵字、分隔線）"
        value={data.body}
        onChange={(v) => set('body', v)}
        placeholder="輸入詩句，用 — 插入分隔線，或用金色 A 標記關鍵字…"
      />
    </SectionForm>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 空內容預設值（API 回傳空時使用）
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_HERO: HeroContent = {
  kicker: '',
  titleMain: '',
  titleAccent: '',
  subtitleEn: '',
  body: '',
  buttons: { openMap: '', startJourney: '', admin: '' },
};

const DEFAULT_ATLAS: AtlasContent = {
  kicker: '',
  title: '',
  hint: '',
};

const DEFAULT_JOURNEY: JourneyContent = {
  kicker: '',
  title: '',
  body: '',
};

const DEFAULT_ZONE: ZoneSectionContent = {
  meta: {
    label: '',
    en: '',
    kicker: '',
    blurb: '',
    atmos: '',
    glyphs: ['', '', '', ''],
    uepShort: [],
    stats: {},
  },
  body: '',
};

const DEFAULT_VERSE: VerseContent = {
  kicker: '',
  title: '',
  inscription: '',
  body: '',
};

// ════════════════════════════════════════════════════════════════════════════
// 主元件：SiteHomepageEditor
// ════════════════════════════════════════════════════════════════════════════

interface SiteHomepageEditorProps {
  /** Content API base URL（由 Astro 頁面傳入） */
  apiBase?: string;
}

export default function SiteHomepageEditor(_props: SiteHomepageEditorProps) {
  const [activeTab, setActiveTab] = useState<string>('hero');

  const [apiData, setApiData] = useState<
    Record<string, { content: unknown; updatedAt: string }>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await loadAll();
      setApiData(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const makeSaveHandler = useCallback(
    (sectionId: string) => async (content: unknown) => {
      await saveSection(sectionId, content);
      setApiData((prev) => ({
        ...prev,
        [sectionId]: { content, updatedAt: new Date().toISOString() },
      }));
    },
    []
  );

  function getContent<T>(id: string): T | undefined {
    const raw = apiData[id];
    if (!raw) return undefined;
    return raw.content as T;
  }

  const renderForm = () => {
    if (loading) {
      return <div className="she-loading">載入中…</div>;
    }

    if (loadError) {
      return (
        <div className="she-error">
          <div className="she-error-card">
            <div className="she-error-title">✕ 載入失敗</div>
            <div className="she-error-msg">{loadError}</div>
            <button className="she-retry-btn" onClick={() => void fetchData()}>
              重新載入
            </button>
          </div>
        </div>
      );
    }

    switch (activeTab) {
      case 'hero':
        return (
          <HeroForm
            initial={getContent<HeroContent>('hero') ?? DEFAULT_HERO}
            onSave={makeSaveHandler('hero')}
          />
        );
      case 'atlas':
        return (
          <AtlasForm
            initial={getContent<AtlasContent>('atlas') ?? DEFAULT_ATLAS}
            onSave={makeSaveHandler('atlas')}
          />
        );
      case 'journey':
        return (
          <JourneyForm
            initial={getContent<JourneyContent>('journey') ?? DEFAULT_JOURNEY}
            onSave={makeSaveHandler('journey')}
          />
        );
      case 'zone-history':
      case 'zone-echoes':
      case 'zone-visuals':
      case 'zone-concepts':
      case 'zone-storage': {
        const tab = TABS.find((t) => t.id === activeTab)!;
        return (
          <ZoneForm
            key={activeTab}
            sectionId={activeTab}
            title={tab.name}
            initial={getContent<ZoneSectionContent>(activeTab) ?? DEFAULT_ZONE}
            onSave={makeSaveHandler(activeTab)}
          />
        );
      }
      case 'verse':
        return (
          <VerseForm
            initial={getContent<VerseContent>('verse') ?? DEFAULT_VERSE}
            onSave={makeSaveHandler('verse')}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="she-root">
      <div className="she-body">
        {/* ── 左側 Tab 列 ── */}
        <nav className="she-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`she-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="she-tab-name">{tab.name}</span>
              <span className="she-tab-sub">{tab.sub}</span>
            </button>
          ))}
        </nav>

        {/* ── 右側表單面板 ── */}
        <div className="she-panel">{renderForm()}</div>
      </div>
    </div>
  );
}
