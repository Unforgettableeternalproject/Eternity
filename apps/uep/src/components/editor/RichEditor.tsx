import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { FontFamily } from '@tiptap/extension-font-family';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Image } from '@tiptap/extension-image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './RichEditor.css';

// === 預設調色盤 ===
const TEXT_COLORS = [
  { label: '預設', value: '' },
  { label: '金', value: '#d5b618' },
  { label: '紫', value: '#a855f7' },
  { label: '青', value: '#06b6d4' },
  { label: '紅', value: '#ef4444' },
  { label: '粉', value: '#ec4899' },
  { label: '綠', value: '#22c55e' },
  { label: '橙', value: '#f97316' },
  { label: '白', value: '#f8f8ff' },
  { label: '灰', value: '#9ca3af' },
];

const HIGHLIGHT_COLORS = [
  { label: '無', value: '' },
  { label: '黃', value: '#fde047' },
  { label: '紅', value: '#fca5a5' },
  { label: '綠', value: '#86efac' },
  { label: '青', value: '#67e8f9' },
  { label: '紫', value: '#d8b4fe' },
];

const FONT_FAMILIES = [
  { label: '預設', value: '' },
  { label: '襯線', value: 'Georgia, "Times New Roman", serif' },
  { label: '等寬', value: '"Cascadia Code", "Fira Code", Consolas, monospace' },
  { label: '手寫', value: '"Segoe Script", "Comic Sans MS", cursive' },
];

const HEADING_LEVELS = [
  { label: '內文', value: 0 },
  { label: 'H1', value: 1 },
  { label: 'H2', value: 2 },
  { label: 'H3', value: 3 },
];

// === Props ===
interface RichEditorProps {
  initialContent: string;
  initialTitle: string;
  apiBase: string;
  area: string;
  pageSlug: string;
  pageStatus: string;
  initialParentId?: string | null;
  initialPageType?: string;
  initialDepth?: number;
  initialMetadata?: Record<string, any>;
}

export default function RichEditor({
  initialContent, initialTitle, apiBase, area, pageSlug, pageStatus,
  initialParentId, initialPageType, initialDepth, initialMetadata
}: RichEditorProps) {
  const [isDirty, setIsDirty] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [parentId, setParentId] = useState(initialParentId || '');
  const [pageType, setPageType] = useState(initialPageType || 'page');
  const [depth, setDepth] = useState(initialDepth || 0);
  const [hidden, setHidden] = useState(initialMetadata?.hidden === true);
  const [icon, setIcon] = useState(initialMetadata?.icon || '');
  const [description, setDescription] = useState(initialMetadata?.description || '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        horizontalRule: {},
      }),
      Underline,
      TextStyle,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: '開始寫作...' }),
      Image.configure({ inline: false }),
    ],
    content: initialContent || '<p></p>',
    editorProps: {
      attributes: {
        class: 'tiptap-content',
        spellcheck: 'false',
      },
    },
    onUpdate: () => {
      setIsDirty(true);
    },
  });

  // 關閉 dropdown
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // 儲存
  const handleSave = useCallback(async () => {
    if (!editor || !isDirty) return;
    setSaveStatus('saving');
    try {
      const html = editor.getHTML();
      const res = await fetch(`${apiBase}/api/content/${area}/${pageSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content: [{ id: 'content', type: 'rich_text', content: html }],
          parentId: parentId || null,
          pageType,
          depth,
          metadata: {
            ...(hidden ? { hidden: true } : {}),
            ...(icon ? { icon } : {}),
            ...(description ? { description } : {}),
          },
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Save failed');
      setIsDirty(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [editor, isDirty, title, apiBase, area, pageSlug]);

  // Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // beforeunload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  if (!editor) return null;

  const toggleDropdown = (name: string) => {
    setActiveDropdown(prev => prev === name ? null : name);
  };

  const setColor = (color: string) => {
    if (color) editor.chain().focus().setColor(color).run();
    else editor.chain().focus().unsetColor().run();
    setActiveDropdown(null);
  };

  const setHighlight = (color: string) => {
    if (color) editor.chain().focus().setHighlight({ color }).run();
    else editor.chain().focus().unsetHighlight().run();
    setActiveDropdown(null);
  };

  const setFont = (font: string) => {
    if (font) editor.chain().focus().setFontFamily(font).run();
    else editor.chain().focus().unsetFontFamily().run();
    setActiveDropdown(null);
  };

  const setHeading = (level: number) => {
    if (level === 0) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run();
    setActiveDropdown(null);
  };

  const insertImage = () => {
    const url = window.prompt('輸入圖片 URL');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  const statusLabels: Record<string, string> = {
    synced: '已同步', modified: '已修改', local_only: '僅本地',
  };

  const saveLabel = {
    idle: '儲存',
    saving: '儲存中...',
    saved: '已儲存',
    error: '失敗',
  }[saveStatus];

  return (
    <div className="rich-editor-app">
      {/* 頂部列 */}
      <header className="re-topbar">
        <div className="re-topbar-left">
          <a href="/admin" className="re-back-btn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
          <input
            type="text"
            className="re-title-input"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setIsDirty(true); }}
            placeholder="頁面標題..."
          />
          {pageStatus && (
            <span className={`re-status re-status-${pageStatus}`}>
              {statusLabels[pageStatus] || pageStatus}
            </span>
          )}
        </div>
        <div className="re-topbar-right">
          <span className="re-shortcut-hint">Ctrl+S</span>
          <button
            className={`re-save-btn ${isDirty ? 'active' : ''}`}
            disabled={!isDirty || saveStatus === 'saving'}
            onClick={handleSave}
          >
            {saveLabel}
          </button>
        </div>
      </header>

      {/* 格式工具列 */}
      <div className="re-toolbar" ref={dropdownRef}>
        {/* 段落/標題 */}
        <div className="tb-group">
          <div className="tb-dropdown-wrap">
            <button className="tb-btn tb-dropdown-trigger" onClick={() => toggleDropdown('heading')}>
              {editor.isActive('heading', { level: 1 }) ? 'H1' :
               editor.isActive('heading', { level: 2 }) ? 'H2' :
               editor.isActive('heading', { level: 3 }) ? 'H3' : '內文'}
              <span className="tb-caret">&#9662;</span>
            </button>
            {activeDropdown === 'heading' && (
              <div className="tb-dropdown">
                {HEADING_LEVELS.map(h => (
                  <button key={h.value} className="tb-dropdown-item" onClick={() => setHeading(h.value)}>
                    {h.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="tb-sep" />

        {/* 基本格式 */}
        <div className="tb-group">
          <button className={`tb-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleBold().run()} title="粗體 (Ctrl+B)">
            <strong>B</strong>
          </button>
          <button className={`tb-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleItalic().run()} title="斜體 (Ctrl+I)">
            <em>I</em>
          </button>
          <button className={`tb-btn ${editor.isActive('underline') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleUnderline().run()} title="底線 (Ctrl+U)">
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <button className={`tb-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleStrike().run()} title="刪除線">
            <s>S</s>
          </button>
        </div>

        <div className="tb-sep" />

        {/* 文字顏色 */}
        <div className="tb-group">
          <div className="tb-dropdown-wrap">
            <button className="tb-btn" onClick={() => toggleDropdown('color')} title="文字顏色">
              <span className="tb-color-preview" style={{
                borderBottomColor: editor.getAttributes('textStyle').color || '#f8f8ff'
              }}>A</span>
            </button>
            {activeDropdown === 'color' && (
              <div className="tb-dropdown tb-color-grid">
                {TEXT_COLORS.map(c => (
                  <button key={c.value || 'default'} className="tb-color-swatch"
                    style={{ background: c.value || '#f8f8ff' }}
                    onClick={() => setColor(c.value)} title={c.label} />
                ))}
              </div>
            )}
          </div>

          <div className="tb-dropdown-wrap">
            <button className="tb-btn" onClick={() => toggleDropdown('highlight')} title="標記色">
              <span className="tb-highlight-preview" style={{
                background: editor.getAttributes('highlight').color || 'transparent'
              }}>H</span>
            </button>
            {activeDropdown === 'highlight' && (
              <div className="tb-dropdown tb-color-grid">
                {HIGHLIGHT_COLORS.map(c => (
                  <button key={c.value || 'none'} className="tb-color-swatch"
                    style={{ background: c.value || 'rgba(255,255,255,0.1)' }}
                    onClick={() => setHighlight(c.value)} title={c.label} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="tb-sep" />

        {/* 字體 */}
        <div className="tb-group">
          <div className="tb-dropdown-wrap">
            <button className="tb-btn tb-dropdown-trigger" onClick={() => toggleDropdown('font')} title="字體">
              字體 <span className="tb-caret">&#9662;</span>
            </button>
            {activeDropdown === 'font' && (
              <div className="tb-dropdown">
                {FONT_FAMILIES.map(f => (
                  <button key={f.value || 'default'} className="tb-dropdown-item"
                    style={{ fontFamily: f.value || 'inherit' }}
                    onClick={() => setFont(f.value)}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="tb-sep" />

        {/* 對齊 */}
        <div className="tb-group">
          <button className={`tb-btn ${editor.isActive({ textAlign: 'left' }) ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().setTextAlign('left').run()} title="靠左">&#8676;</button>
          <button className={`tb-btn ${editor.isActive({ textAlign: 'center' }) ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().setTextAlign('center').run()} title="置中">&#8596;</button>
          <button className={`tb-btn ${editor.isActive({ textAlign: 'right' }) ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().setTextAlign('right').run()} title="靠右">&#8677;</button>
        </div>

        <div className="tb-sep" />

        {/* 列表 & 引言 & 插入 */}
        <div className="tb-group">
          <button className={`tb-btn ${editor.isActive('bulletList') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleBulletList().run()} title="無序列表">&#8226;</button>
          <button className={`tb-btn ${editor.isActive('orderedList') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleOrderedList().run()} title="有序列表">1.</button>
          <button className={`tb-btn ${editor.isActive('blockquote') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引言">"</button>
        </div>

        <div className="tb-sep" />

        <div className="tb-group">
          <button className="tb-btn"
            onClick={() => editor.chain().focus().setHorizontalRule().run()} title="分隔線">—</button>
          <button className="tb-btn"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="程式碼">&lt;/&gt;</button>
          <button className="tb-btn" onClick={insertImage} title="圖片">&#9634;</button>
        </div>
      </div>

      {/* 頁面設定列 */}
      <details className="re-page-settings">
        <summary className="re-settings-toggle">頁面設定</summary>
        <div className="re-settings-body">
          <label className="re-setting">
            <span>頁面類型</span>
            <select value={pageType} onChange={e => { setPageType(e.target.value); setIsDirty(true); }}>
              <option value="page">一般頁面</option>
              <option value="zone">區間 (Zone)</option>
              <option value="chapter">章節 (Chapter)</option>
              <option value="arc">篇 (Arc)</option>
              <option value="section">小節 (Section)</option>
            </select>
          </label>
          <label className="re-setting">
            <span>上層頁面 ID</span>
            <input type="text" value={parentId} placeholder="例: history/passage/unforgettable_story"
              onChange={e => { setParentId(e.target.value); setIsDirty(true); }} />
          </label>
          <label className="re-setting">
            <span>深度</span>
            <input type="number" value={depth} min={0} max={5}
              onChange={e => { setDepth(parseInt(e.target.value) || 0); setIsDirty(true); }} />
          </label>
          <div className="re-settings-sep" />
          <label className="re-setting">
            <span>隱藏頁面</span>
            <input type="checkbox" checked={hidden}
              onChange={e => { setHidden(e.target.checked); setIsDirty(true); }} />
          </label>
          <label className="re-setting">
            <span>圖示</span>
            <input type="text" value={icon} placeholder="例: sparkle"
              onChange={e => { setIcon(e.target.value); setIsDirty(true); }} />
          </label>
          <label className="re-setting">
            <span>描述</span>
            <input type="text" value={description} placeholder="頁面描述"
              onChange={e => { setDescription(e.target.value); setIsDirty(true); }} />
          </label>
        </div>
      </details>

      {/* 編輯區 */}
      <div className="re-editor-area">
        <div className="re-paper">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
