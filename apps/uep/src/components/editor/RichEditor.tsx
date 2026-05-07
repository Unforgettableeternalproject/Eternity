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
import { ZONES } from '../../data/zones';
import EditorPageTree from './EditorPageTree';
import EditorInspector from './EditorInspector';
import EchoesEditorBody, {
  parseEchoesData,
  serializeEchoesData,
  type EchoesData,
} from './EchoesEditorBody';
import './RichEditor.css';

// === Color palettes ===
const TEXT_COLORS = [
  { label: 'Default', value: '' },
  { label: 'Gold', value: '#d5b618' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Pink', value: '#ec4899' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Orange', value: '#f97316' },
  { label: 'White', value: '#f8f8ff' },
  { label: 'Gray', value: '#9ca3af' },
];

const HIGHLIGHT_COLORS = [
  { label: 'None', value: '' },
  { label: 'Yellow', value: '#fde047' },
  { label: 'Red', value: '#fca5a5' },
  { label: 'Green', value: '#86efac' },
  { label: 'Cyan', value: '#67e8f9' },
  { label: 'Purple', value: '#d8b4fe' },
];

const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: '"Cascadia Code", "Fira Code", Consolas, monospace' },
  { label: 'Script', value: '"Segoe Script", "Comic Sans MS", cursive' },
];

const HEADING_LEVELS = [
  { label: '\u5167\u6587', value: 0 },
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
  zoneId: string;
  initialParentId?: string | null;
  initialPageType?: string;
  initialDepth?: number;
  initialMetadata?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

export default function RichEditor({
  initialContent,
  initialTitle,
  apiBase,
  area,
  pageSlug,
  pageStatus,
  zoneId,
  initialParentId,
  initialPageType,
  initialDepth,
  initialMetadata,
  createdAt,
  updatedAt,
}: RichEditorProps) {
  // Zone accent resolution
  const zone = ZONES.find((z) => z.id === zoneId || z.slug === zoneId);
  const accentMain = zone?.main ?? '#3A3A3A';

  // State
  const [isDirty, setIsDirty] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [parentId, setParentId] = useState(initialParentId || '');
  const [pageType, setPageType] = useState(initialPageType || 'page');
  const [depth, setDepth] = useState(initialDepth || 0);
  const [hidden, setHidden] = useState(initialMetadata?.hidden === true);
  const [icon, setIcon] = useState(initialMetadata?.icon || '');
  const [description, setDescription] = useState(
    initialMetadata?.description || ''
  );
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Echoes-specific state
  const isEchoes = area === 'echos' || zoneId === 'echoes';
  const [echoesData, setEchoesData] = useState<EchoesData>(() =>
    parseEchoesData(initialMetadata || {})
  );

  // TipTap editor
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
      Placeholder.configure({ placeholder: '\u958B\u59CB\u5BEB\u4F5C...' }),
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

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    if (!isEchoes && !editor) return;
    setSaveStatus('saving');
    try {
      const content = isEchoes
        ? [{ id: 'content', type: 'rich_text', content: '' }]
        : [{ id: 'content', type: 'rich_text', content: editor!.getHTML() }];

      const metadata: Record<string, any> = {
        ...(hidden ? { hidden: true } : {}),
        ...(icon ? { icon } : {}),
        ...(description ? { description } : {}),
        ...(isEchoes ? serializeEchoesData(echoesData) : {}),
      };

      const res = await fetch(`${apiBase}/api/content/${area}/${pageSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
          parentId: parentId || null,
          pageType,
          depth,
          metadata,
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
  }, [
    editor,
    isDirty,
    isEchoes,
    echoesData,
    title,
    apiBase,
    area,
    pageSlug,
    parentId,
    pageType,
    depth,
    hidden,
    icon,
    description,
  ]);

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
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  if (!editor && !isEchoes) return null;

  // Toolbar helpers
  const toggleDropdown = (name: string) => {
    setActiveDropdown((prev) => (prev === name ? null : name));
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
    else
      editor
        .chain()
        .focus()
        .toggleHeading({ level: level as 1 | 2 | 3 })
        .run();
    setActiveDropdown(null);
  };

  const insertImage = () => {
    const url = window.prompt('\u8F38\u5165\u5716\u7247 URL');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  const charCount = editor ? editor.getText().length : 0;

  const statusLabel = {
    idle: '',
    saving: 'saving...',
    saved: 'saved',
    error: 'error',
  }[saveStatus];

  const saveButtonLabel = {
    idle: '\u5132\u5B58',
    saving: '\u5132\u5B58\u4E2D...',
    saved: '\u5DF2\u5132\u5B58',
    error: '\u5931\u6557',
  }[saveStatus];

  return (
    <div
      className="ned-app"
      style={
        { '--ned-accent': accentMain } as React.CSSProperties
      }
    >
      {/* Header */}
      <header className="ned-header">
        <a href="/admin" className="ned-header-area">$ admin / {area}</a>
        <div className="ned-header-sep" />
        <input
          className="ned-header-title"
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setIsDirty(true);
          }}
          placeholder="Page title..."
        />
        <span className="ned-header-status">
          {statusLabel || `${pageStatus} \u00b7 ${isDirty ? 'modified' : 'saved'}`}
        </span>
        <div className="ned-header-spacer" />
        <div className="ned-header-right">
          <span className="ned-shortcut-hint">Ctrl+S</span>
          <a
            href={`/${area}?page=${area}/${pageSlug}`}
            className="ned-btn-ghost"
            target="_blank"
            rel="noopener"
          >
            Preview
          </a>
          <button
            className={`ned-btn-save ${isDirty ? 'is-dirty' : ''}`}
            disabled={!isDirty || saveStatus === 'saving'}
            onClick={handleSave}
          >
            {saveButtonLabel}
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="ned-toolbar" ref={dropdownRef}>
        {!isEchoes && editor && (<>
        {/* Heading dropdown */}
        <div className="tb-group">
          <div className="tb-dropdown-wrap">
            <button
              className="tb-btn tb-dropdown-trigger"
              onClick={() => toggleDropdown('heading')}
            >
              {editor.isActive('heading', { level: 1 })
                ? 'H1'
                : editor.isActive('heading', { level: 2 })
                  ? 'H2'
                  : editor.isActive('heading', { level: 3 })
                    ? 'H3'
                    : '\u5167\u6587'}
              <span className="tb-caret">&#9662;</span>
            </button>
            {activeDropdown === 'heading' && (
              <div className="tb-dropdown">
                {HEADING_LEVELS.map((h) => (
                  <button
                    key={h.value}
                    className="tb-dropdown-item"
                    onClick={() => setHeading(h.value)}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="tb-sep" />

        {/* Basic formatting */}
        <div className="tb-group">
          <button
            className={`tb-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold (Ctrl+B)"
          >
            <strong>B</strong>
          </button>
          <button
            className={`tb-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic (Ctrl+I)"
          >
            <em>I</em>
          </button>
          <button
            className={`tb-btn ${editor.isActive('underline') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title="Underline (Ctrl+U)"
          >
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <button
            className={`tb-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          >
            <s>S</s>
          </button>
        </div>

        <div className="tb-sep" />

        {/* Text color */}
        <div className="tb-group">
          <div className="tb-dropdown-wrap">
            <button
              className="tb-btn"
              onClick={() => toggleDropdown('color')}
              title="Text color"
            >
              <span
                className="tb-color-preview"
                style={{
                  borderBottomColor:
                    editor.getAttributes('textStyle').color || 'var(--ink)',
                }}
              >
                A
              </span>
            </button>
            {activeDropdown === 'color' && (
              <div className="tb-dropdown tb-color-grid">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.value || 'default'}
                    className="tb-color-swatch"
                    style={{ background: c.value || 'var(--ink)' }}
                    onClick={() => setColor(c.value)}
                    title={c.label}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Highlight */}
          <div className="tb-dropdown-wrap">
            <button
              className="tb-btn"
              onClick={() => toggleDropdown('highlight')}
              title="Highlight"
            >
              <span
                className="tb-highlight-preview"
                style={{
                  background:
                    editor.getAttributes('highlight').color || 'transparent',
                }}
              >
                H
              </span>
            </button>
            {activeDropdown === 'highlight' && (
              <div className="tb-dropdown tb-color-grid">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.value || 'none'}
                    className="tb-color-swatch"
                    style={{ background: c.value || 'var(--hairline)' }}
                    onClick={() => setHighlight(c.value)}
                    title={c.label}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="tb-sep" />

        {/* Font family */}
        <div className="tb-group">
          <div className="tb-dropdown-wrap">
            <button
              className="tb-btn tb-dropdown-trigger"
              onClick={() => toggleDropdown('font')}
              title="Font"
            >
              Font <span className="tb-caret">&#9662;</span>
            </button>
            {activeDropdown === 'font' && (
              <div className="tb-dropdown">
                {FONT_FAMILIES.map((f) => (
                  <button
                    key={f.value || 'default'}
                    className="tb-dropdown-item"
                    style={{ fontFamily: f.value || 'inherit' }}
                    onClick={() => setFont(f.value)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="tb-sep" />

        {/* Alignment */}
        <div className="tb-group">
          <button
            className={`tb-btn ${editor.isActive({ textAlign: 'left' }) ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            title="Align left"
          >
            &#8676;
          </button>
          <button
            className={`tb-btn ${editor.isActive({ textAlign: 'center' }) ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            title="Align center"
          >
            &#8596;
          </button>
          <button
            className={`tb-btn ${editor.isActive({ textAlign: 'right' }) ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            title="Align right"
          >
            &#8677;
          </button>
        </div>

        <div className="tb-sep" />

        {/* Lists, blockquote */}
        <div className="tb-group">
          <button
            className={`tb-btn ${editor.isActive('bulletList') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet list"
          >
            &#8226;
          </button>
          <button
            className={`tb-btn ${editor.isActive('orderedList') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Ordered list"
          >
            1.
          </button>
          <button
            className={`tb-btn ${editor.isActive('blockquote') ? 'is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Blockquote"
          >
            &ldquo;
          </button>
        </div>

        <div className="tb-sep" />

        {/* Insert */}
        <div className="tb-group">
          <button
            className="tb-btn"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal rule"
          >
            &mdash;
          </button>
          <button
            className="tb-btn"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            title="Code block"
          >
            &lt;/&gt;
          </button>
          <button className="tb-btn" onClick={insertImage} title="Image">
            &#9634;
          </button>
        </div>
        </>)}

        <span className="ned-toolbar-right">
          {isEchoes ? 'song mode' : 'rich text'}{!isEchoes && ` \u00b7 ${charCount.toLocaleString()} chars`}
        </span>
      </div>

      {/* Body — 3 columns */}
      <div className="ned-body">
        {/* Left — Page Tree */}
        <aside className="ned-panel--tree">
          <EditorPageTree
            area={area}
            apiBase={apiBase}
            currentSlug={pageSlug}
            accent={accentMain}
          />
        </aside>

        {/* Middle — Editor */}
        <main className="ned-editor">
          <div className="ned-paper">
            <div className="ned-breadcrumb">
              {parentId ? `${area} / ${parentId.replace(/\//g, ' / ')}` : area}
            </div>
            {isEchoes ? (
              <EchoesEditorBody
                accent={accentMain}
                initialData={echoesData}
                onDataChange={setEchoesData}
                onDirty={() => setIsDirty(true)}
              />
            ) : (
              <EditorContent editor={editor} />
            )}
          </div>
        </main>

        {/* Right — Inspector */}
        <aside className="ned-panel--inspector">
          <EditorInspector
            pageType={pageType}
            onPageTypeChange={setPageType}
            parentId={parentId}
            onParentIdChange={setParentId}
            depth={depth}
            onDepthChange={setDepth}
            hidden={hidden}
            onHiddenChange={setHidden}
            icon={icon}
            onIconChange={setIcon}
            description={description}
            onDescriptionChange={setDescription}
            onDirty={() => setIsDirty(true)}
            accent={accentMain}
            pageStatus={pageStatus}
            createdAt={createdAt}
            updatedAt={updatedAt}
          />
        </aside>
      </div>
    </div>
  );
}
